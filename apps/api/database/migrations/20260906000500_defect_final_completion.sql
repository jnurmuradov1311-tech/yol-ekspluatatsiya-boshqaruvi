begin;

-- A multi-day defect stays open until every active published/approved linked
-- task is independently verified for its full planned quantity. The existing
-- defect row lock serializes concurrent final-day verifications.
create or replace function roadops.verify_work_order_completion(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  plan_row roadops.plan_items%rowtype;
  completion_row roadops.work_completion_records%rowtype;
  defect_row roadops.defect_cases%rowtype;
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  verification_time timestamptz := clock_timestamp();
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id = p_order_id for update;
  select pi.* into plan_row
  from roadops.plan_items pi where pi.id = order_row.plan_item_id for update;
  select cr.* into completion_row
  from roadops.work_completion_records cr where cr.work_order_id = p_order_id for update;
  if order_row.id is null or completion_row.id is null then
    raise exception using errcode = 'P0002', message = 'Completed work order or completion record not found';
  end if;
  division_id := roadops.division_for_work_order(p_order_id);
  if order_row.status <> 'completed' or order_row.completed_at is null then
    raise exception using errcode = '55000', message = 'Only completed work order can be verified';
  end if;
  if completion_row.verified_at is not null or order_row.verified_at is not null then
    raise exception using errcode = '55000', message = 'Work completion is already verified';
  end if;
  if plan_row.id is null
     or completion_row.work_unit is distinct from plan_row.work_unit
     or completion_row.completed_quantity > plan_row.work_quantity then
    raise exception using errcode = '23514',
      message = 'Completed quantity and unit must stay within the planned work quantity';
  end if;
  if exists (
    select 1
    from roadops.material_reservations reservation
    where reservation.plan_item_id = plan_row.id
      and reservation.status in ('reserved', 'issued')
      and (
        select count(*)
        from roadops.work_order_material_usages usage
        where usage.material_reservation_id = reservation.id
          and usage.work_order_id = p_order_id
      ) <> 1
  ) then
    raise exception using errcode = '23514',
      message = 'Every active material reservation must be recorded exactly once';
  end if;
  if exists (
    select 1
    from roadops.equipment_reservations reservation
    where reservation.plan_item_id = plan_row.id
      and reservation.status in ('reserved', 'checked_out', 'returned')
      and (
        select count(*)
        from roadops.equipment_usage_entries usage
        where usage.equipment_reservation_id = reservation.id
          and usage.work_order_id = p_order_id
      ) <> 1
  ) then
    raise exception using errcode = '23514',
      message = 'Every active equipment reservation must be recorded exactly once';
  end if;
  if actor_id is null or not roadops.has_permission('execution.verify', division_id)
     or actor_id = order_row.issued_by or actor_id = completion_row.recorded_by then
    raise exception using errcode = '42501',
      message = 'Work completion requires an independent authorized verifier';
  end if;
  if exists (
    select 1
    from roadops.time_entries entry
    where entry.work_order_id = p_order_id
      and (entry.approved_at is null or entry.approved_by is null)
  ) or exists (
    select 1
    from roadops.work_order_material_usages usage
    where usage.work_order_id = p_order_id and usage.status <> 'approved'
  ) or exists (
    select 1
    from roadops.equipment_usage_entries usage
    where usage.work_order_id = p_order_id and usage.status <> 'approved'
  ) then
    raise exception using errcode = '23514',
      message = 'Every actual labor and resource usage must be independently approved before verification';
  end if;

  update roadops.work_completion_records
  set verified_by = actor_id, verified_at = verification_time
  where id = completion_row.id;
  update roadops.work_orders
  set status = 'verified', verified_by = actor_id, verified_at = verification_time,
      row_version = row_version + 1
  where id = p_order_id;

  select dc.* into defect_row
  from roadops.plan_items pi
  join roadops.defect_cases dc
    on dc.id::text = coalesce(
      pi.defect_case_id::text,
      nullif(pi.formula_inputs #>> '{manualInput,sourceDefectId}', '')
    )
  where pi.id = plan_row.id
  for update of dc;
  if defect_row.id is not null and defect_row.status = 'cancelled' then
    raise exception using errcode = '55000',
      message = 'Cancelled source defect cannot be resolved by work verification';
  elsif defect_row.id is not null
        and defect_row.status in ('open', 'planned', 'in_progress')
        and not exists (
          select 1
          from roadops.plan_items sibling
          join roadops.planning_runs sibling_run on sibling_run.id = sibling.planning_run_id
          left join roadops.work_orders sibling_order on sibling_order.plan_item_id = sibling.id
          left join roadops.work_completion_records sibling_completion
            on sibling_completion.work_order_id = sibling_order.id
          where coalesce(
              sibling.defect_case_id::text,
              nullif(sibling.formula_inputs #>> '{manualInput,sourceDefectId}', '')
            ) = defect_row.id::text
            and sibling_run.status in ('approved', 'published')
            and sibling.status <> 'cancelled'
            and (
              sibling_order.id is null or sibling_order.status <> 'verified'
              or sibling_completion.verified_at is null
              or sibling_completion.completed_quantity < sibling.work_quantity
            )
        ) then
    update roadops.defect_cases
    set status = 'resolved', resolved_at = verification_time,
        row_version = row_version + 1
    where id = defect_row.id;
    insert into roadops.defect_case_events (
      defect_case_id, from_status, to_status, event_code,
      actor_user_id, occurred_at, details, request_id
    ) values (
      defect_row.id, defect_row.status, 'resolved', 'resolved_by_verified_work',
      actor_id, verification_time,
      jsonb_build_object(
        'work_order_id', p_order_id,
        'completion_record_id', completion_row.id,
        'plan_item_id', plan_row.id
      ),
      roadops.current_request_id()
    );
  end if;
  insert into roadops.work_order_events (
    work_order_id, from_status, to_status, event_code,
    actor_user_id, occurred_at, note, details, request_id
  ) values (
    p_order_id, 'completed', 'verified', 'WORK_COMPLETION_VERIFIED',
    actor_id, verification_time,
    nullif(pg_catalog.current_setting('roadops.verification_note', true), ''),
    jsonb_build_object('completion_record_id', completion_row.id),
    roadops.current_request_id()
  );
end
$function$;

revoke all on function roadops.verify_work_order_completion(uuid) from public;
grant execute on function roadops.verify_work_order_completion(uuid) to roadops_api;

commit;
