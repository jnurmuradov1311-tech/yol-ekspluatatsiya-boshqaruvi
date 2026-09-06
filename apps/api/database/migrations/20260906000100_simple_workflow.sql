begin;

insert into roadops.permissions(code,description) values
  ('resources.requisition.approve','Decide chief-engineer material and equipment requisitions') on conflict(code) do nothing;
insert into roadops.roles(code,name,description,is_system) values
  ('chief_engineer','Bosh muhandis','Division-scoped resource requisition decisions',true) on conflict(code) do nothing;
insert into roadops.role_permissions(role_id,permission_id)
  select r.id,p.id from roadops.roles r cross join roadops.permissions p
  where (r.code='chief_engineer' and p.code in ('master.read','planning.read','resources.read','resources.manage','resources.requisition.approve'))
     or (r.code='system_admin' and p.code='resources.requisition.approve') on conflict do nothing;

-- Durable chief-engineer inbox. Approval is an instruction to obtain resources,
-- never a substitute for physical stock or the planner's reservations.
create table roadops.resource_requisitions (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null unique references roadops.planning_runs(id) on delete restrict,
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  recipient_role text not null default 'CHIEF_ENGINEER' check (recipient_role = 'CHIEF_ENGINEER'),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','fulfilled','cancelled')),
  shortages jsonb not null check (jsonb_typeof(shortages) = 'array'),
  requested_by uuid not null references roadops.app_users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references roadops.app_users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  fulfilled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((decided_by is null) = (decided_at is null)),
  check (status <> 'fulfilled' or fulfilled_at is not null)
);
create index resource_requisitions_division_status_idx
  on roadops.resource_requisitions(division_id,status,requested_at);
create index resource_requisitions_requested_by_idx on roadops.resource_requisitions(requested_by);
create index resource_requisitions_decided_by_idx on roadops.resource_requisitions(decided_by);
create trigger resource_requisitions_set_updated_at before update on roadops.resource_requisitions
  for each row execute function roadops.set_updated_at();
create trigger resource_requisitions_audit after insert or update or delete on roadops.resource_requisitions
  for each row execute function roadops.capture_row_audit('resource_requisition');
alter table roadops.resource_requisitions enable row level security;
alter table roadops.resource_requisitions force row level security;
create policy resource_requisitions_read on roadops.resource_requisitions for select to roadops_api
  using (roadops.can_access_division(division_id)
    and (roadops.has_permission('planning.read',division_id) or roadops.has_permission('planning.approve',division_id)));
grant select on roadops.resource_requisitions to roadops_api;

create or replace function roadops.plan_workers_ready(p_run_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select roadops.can_access_division(run.division_id)
    and exists (select 1 from roadops.plan_items pi where pi.planning_run_id=run.id and pi.status <> 'cancelled')
    and not exists (
      select 1 from roadops.plan_items pi where pi.planning_run_id=run.id and pi.status <> 'cancelled'
        and (
          coalesce((select sum(r.required_minutes) from roadops.plan_resource_requirements r
            where r.plan_item_id=pi.id and r.resource_kind='labor'),0) <= 0
          or coalesce((select sum(a.planned_minutes) from roadops.work_assignments a
            where a.plan_item_id=pi.id and a.status <> 'cancelled'),0)
            < coalesce((select sum(r.required_minutes) from roadops.plan_resource_requirements r
              where r.plan_item_id=pi.id and r.resource_kind='labor'),0)
          or exists (select 1 from roadops.work_variant_skill_requirements skill
            where skill.work_variant_id=pi.work_variant_id and skill.status='approved'
              and skill.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
              and (skill.effective_until is null or skill.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
              and skill.worker_count > (select count(distinct a.worker_id) from roadops.work_assignments a
                where a.plan_item_id=pi.id and a.skill_requirement_id=skill.id and a.status <> 'cancelled'))
        )
    )
    and not exists (select 1 from roadops.planning_blockers b where b.planning_run_id=run.id
      and b.resolved_at is null and b.blocker_code in (
        'LABOR_ASSIGNMENT_INCOMPLETE','WORK_TEMPLATE_CREW_INCOMPLETE','SAFETY_STAFF_SHORTAGE',
        'EQUIPMENT_OPERATOR_MISSING','EQUIPMENT_OPERATOR_UNAVAILABLE','EQUIPMENT_OPERATOR_SHORTAGE',
        'EQUIPMENT_OPERATOR_ASSIGNMENT_INCOMPLETE','EQUIPMENT_OPERATOR_SKILL_MISSING',
        'WORKER_NOT_ELIGIBLE','WORKER_UNAVAILABLE','WORKER_CAPACITY_EXCEEDED'
      ))
  from roadops.planning_runs run where run.id=p_run_id
$function$;

create or replace function roadops.plan_resource_shortages(p_run_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  with requested as (
    select pi.id plan_item_id, r.resource_kind, nl.resource_id, r.resource_code, r.unit,
           sum(r.required_quantity)::numeric required_quantity
    from roadops.plan_resource_requirements r
    join roadops.plan_items pi on pi.id=r.plan_item_id
    join roadops.planning_runs run on run.id=pi.planning_run_id
    join roadops.iqn_norm_lines nl on nl.id=r.norm_line_id
    where run.id=p_run_id and roadops.can_access_division(run.division_id)
      and pi.status <> 'cancelled' and r.resource_kind in ('material','equipment')
    group by pi.id,r.resource_kind,nl.resource_id,r.resource_code,r.unit
  ), missing as (
    select req.*, case req.resource_kind when 'material' then coalesce((
      select sum(res.quantity) from roadops.material_reservations res
      join roadops.materials m on m.id=res.material_id
      where res.plan_item_id=req.plan_item_id and m.iqn_resource_id=req.resource_id
        and m.unit=req.unit and res.status in ('reserved','issued')
    ),0) else coalesce((
      select sum(res.allocated_quantity) from roadops.equipment_reservations res
      join roadops.equipment_units eq on eq.id=res.equipment_unit_id
      where res.plan_item_id=req.plan_item_id and eq.iqn_resource_id=req.resource_id
        and res.unit=req.unit and res.status in ('reserved','checked_out')
    ),0) end reserved_quantity from requested req
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'planItemId',plan_item_id,'resourceKind',upper(resource_kind),'resourceId',resource_id,
    'resourceCode',resource_code,'resourceName',(select r.normalized_name from roadops.iqn_resources r where r.id=missing.resource_id),'unit',unit,'requiredQuantity',required_quantity::text,
    'reservedQuantity',reserved_quantity::text,'missingQuantity',(required_quantity-reserved_quantity)::text
  ) order by plan_item_id,resource_kind,resource_code,unit), '[]'::jsonb)
  from missing where required_quantity>reserved_quantity
$function$;

create or replace function roadops.sync_plan_resource_requisition(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare run roadops.planning_runs%rowtype; missing jsonb; result uuid;
begin
  select * into run from roadops.planning_runs where id=p_run_id for update;
  if not found or not roadops.has_permission('planning.write',run.division_id) then
    raise exception using errcode='42501',message='Cannot request resources for this plan';
  end if;
  if run.status not in ('draft','evaluated') then
    raise exception using errcode='55000',message='Only an unapproved plan may request resources';
  end if;
  if not coalesce(roadops.plan_workers_ready(p_run_id),false) then
    return null; -- staff shortage prevents moving to the requisition step
  end if;
  missing := roadops.plan_resource_shortages(p_run_id);
  if missing='[]'::jsonb then
    update roadops.resource_requisitions set status='fulfilled',fulfilled_at=clock_timestamp(),shortages=missing
      where planning_run_id=p_run_id and status <> 'fulfilled';
    select id into result from roadops.resource_requisitions where planning_run_id=p_run_id;
    return result;
  end if;
  insert into roadops.resource_requisitions(planning_run_id,division_id,shortages,requested_by)
    values(p_run_id,run.division_id,missing,roadops.current_actor_id())
    on conflict(planning_run_id) do update set shortages=excluded.shortages,
      status=case when roadops.resource_requisitions.status='fulfilled' then 'submitted' else roadops.resource_requisitions.status end,
      fulfilled_at=null
    returning id into result;
  return result;
end
$function$;

create or replace function roadops.decide_resource_requisition(p_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path = '' as $function$
declare item roadops.resource_requisitions%rowtype;
begin
  select * into item from roadops.resource_requisitions where id=p_id for update;
  if not found or not roadops.has_permission('resources.requisition.approve',item.division_id) then
    raise exception using errcode='42501',message='Only the responsible chief engineer may decide this requisition';
  end if;
  if p_decision not in ('approved','rejected') or coalesce(length(btrim(p_note)),0)=0 then
    raise exception using errcode='23514',message='Requisition decision and note are required';
  end if;
  if item.status=p_decision and item.decided_by=roadops.current_actor_id() and item.decision_note=p_note then return; end if;
  if item.status <> 'submitted' then
    raise exception using errcode='55000',message='Requisition is already decided';
  end if;
  update roadops.resource_requisitions set status=p_decision,decided_by=roadops.current_actor_id(),
    decided_at=clock_timestamp(),decision_note=p_note where id=p_id;
end
$function$;

-- Called in the same locked transaction as re-allocation. Published/approved
-- assignments and issued material are never cleared by this endpoint.
create or replace function roadops.reset_draft_resource_allocations(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare run roadops.planning_runs%rowtype;
begin
  select * into run from roadops.planning_runs where id=p_run_id for update;
  if not found or not roadops.has_permission('planning.write',run.division_id) then
    raise exception using errcode='42501',message='Cannot recheck this plan';
  end if;
  if run.status not in ('draft','evaluated') or exists (
    select 1 from roadops.plan_items pi join roadops.work_orders wo on wo.plan_item_id=pi.id
      where pi.planning_run_id=p_run_id
  ) then raise exception using errcode='55000',message='Only unpublished draft resources can be recalculated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(run.division_id::text,20260812));
  if exists(select 1 from roadops.material_reservations r join roadops.plan_items pi on pi.id=r.plan_item_id
    where pi.planning_run_id=p_run_id and r.status='issued')
    or exists(select 1 from roadops.equipment_reservations r join roadops.plan_items pi on pi.id=r.plan_item_id
    where pi.planning_run_id=p_run_id and r.status='checked_out') then
    raise exception using errcode='55000',message='Issued resources cannot be reset';
  end if;
  -- These two blockers describe the allocations being cleared. Re-run their
  -- owning equipment allocator in the same transaction; retaining stale ones
  -- would prevent labor allocation and deadlock every shortage retry.
  update roadops.planning_blockers set resolved_at=clock_timestamp()
    where planning_run_id=p_run_id and source='allocator' and resolved_at is null
      and blocker_code in ('EQUIPMENT_CAPACITY_INSUFFICIENT','EQUIPMENT_UNIT_CONVERSION_REQUIRED');
  delete from roadops.safety_staff_assignments a using roadops.plan_items pi where a.plan_item_id=pi.id and pi.planning_run_id=p_run_id;
  delete from roadops.safety_resource_reservations a using roadops.plan_items pi where a.plan_item_id=pi.id and pi.planning_run_id=p_run_id;
  delete from roadops.work_assignments a using roadops.plan_items pi where a.plan_item_id=pi.id and pi.planning_run_id=p_run_id;
  delete from roadops.equipment_reservations a using roadops.plan_items pi where a.plan_item_id=pi.id and pi.planning_run_id=p_run_id;
  delete from roadops.material_reservations a using roadops.plan_items pi where a.plan_item_id=pi.id and pi.planning_run_id=p_run_id;
end
$function$;

create or replace function roadops.cancel_own_draft_plan(p_run_id uuid,p_division_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare run roadops.planning_runs%rowtype;
begin
  select * into run from roadops.planning_runs where id=p_run_id for update;
  if not found or run.created_by <> roadops.current_actor_id() or run.division_id <> p_division_id
     or not roadops.has_permission('planning.write',run.division_id) then
    raise exception using errcode='42501',message='Only the creator can replace their own division draft';
  end if;
  if run.status='cancelled' then return; end if;
  perform roadops.reset_draft_resource_allocations(p_run_id);
  update roadops.manual_work_requests request set status='cancelled'
    where id in (select manual_work_request_id from roadops.plan_items where planning_run_id=p_run_id);
  update roadops.plan_items set status='cancelled' where planning_run_id=p_run_id;
  update roadops.planning_runs set status='cancelled',cancellation_reason='Replaced by a recalculated draft' where id=p_run_id;
  update roadops.resource_requisitions set status='cancelled' where planning_run_id=p_run_id;
end
$function$;

-- The minute ledger may never claim more attendance than the real shift window.
-- NOT VALID preserves historical imports; the guard applies to every new write.
alter table roadops.work_assignments add constraint work_assignments_minutes_fit_window
  check (planned_minutes <= floor(extract(epoch from (upper(scheduled_window)-lower(scheduled_window))) / 60)) not valid;
alter table roadops.safety_staff_assignments add constraint safety_staff_minutes_fit_window
  check (planned_minutes <= floor(extract(epoch from (upper(scheduled_window)-lower(scheduled_window))) / 60)) not valid;

-- New closure event carries the exact road section and dates. The existing
-- configured YTP outbox publisher delivers it with retries/idempotency.
create or replace function roadops.queue_work_road_access()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare item record; body jsonb;
begin
  if new.status <> 'published' or old.status='published' then return new; end if;
  for item in select pi.*,ss.scheme_kind from roadops.plan_items pi
    join roadops.safety_schemes ss on ss.id=pi.safety_scheme_id
    where pi.planning_run_id=new.id and pi.status <> 'cancelled'
      and ss.scheme_kind <> 'shoulder_work'
  loop
    body := jsonb_build_object('planningRunId',new.id,'planItemId',item.id,
      'roadId',item.road_id,'divisionId',new.division_id,
      'chainageStartM',lower(item.chainage_span)::text,'chainageEndM',upper(item.chainage_span)::text,
      'startsAt',lower(item.scheduled_window),'endsAt',upper(item.scheduled_window),
      'roadAccess',case when item.scheme_kind='full_closure_permit' then 'CLOSED' else 'PARTIAL' end,
      'permitReference',item.permit_reference,'status','SCHEDULED');
    insert into roadops.integration_outbox(destination_code,event_kind,aggregate_type,aggregate_id,payload,payload_hash)
      values('road_repair','road_access.scheduled','plan_item',item.id,body,
        extensions.digest(convert_to(body::text,'UTF8'),'sha256')) on conflict do nothing;
  end loop;
  return new;
end
$function$;
create trigger planning_runs_queue_road_access after update of status on roadops.planning_runs
  for each row execute function roadops.queue_work_road_access();

create or replace function roadops.queue_work_road_access_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare item record; body jsonb; event_status text; access_status text;
begin
  if tg_table_name='work_orders' then
    if new.status is not distinct from old.status or new.status not in ('in_progress','completed','cancelled') then return new; end if;
    select pi.*,ss.scheme_kind,run.division_id,run.status run_status into item
      from roadops.plan_items pi join roadops.safety_schemes ss on ss.id=pi.safety_scheme_id
      join roadops.planning_runs run on run.id=pi.planning_run_id where pi.id=new.plan_item_id;
    event_status:=upper(new.status);
  else
    if new.scheduled_window is not distinct from old.scheduled_window
       and new.status is distinct from 'cancelled' then return new; end if;
    select pi.*,ss.scheme_kind,run.division_id,run.status run_status into item
      from roadops.plan_items pi join roadops.safety_schemes ss on ss.id=pi.safety_scheme_id
      join roadops.planning_runs run on run.id=pi.planning_run_id where pi.id=new.id;
    event_status:=case when new.status='cancelled' then 'CANCELLED' else 'RESCHEDULED' end;
  end if;
  if item.id is null or item.scheme_kind='shoulder_work' or item.run_status <> 'published' then return new; end if;
  access_status:=case when event_status in ('COMPLETED','CANCELLED') then 'OPEN'
    when item.scheme_kind='full_closure_permit' then 'CLOSED' else 'PARTIAL' end;
  body:=jsonb_build_object('planningRunId',item.planning_run_id,'planItemId',item.id,
    'roadId',item.road_id,'divisionId',item.division_id,
    'chainageStartM',lower(item.chainage_span)::text,'chainageEndM',upper(item.chainage_span)::text,
    'startsAt',lower(item.scheduled_window),'endsAt',upper(item.scheduled_window),
    'roadAccess',access_status,'permitReference',item.permit_reference,'status',event_status);
  insert into roadops.integration_outbox(destination_code,event_kind,aggregate_type,aggregate_id,payload,payload_hash)
    values('road_repair','road_access.updated','plan_item',item.id,body,
      extensions.digest(convert_to(body::text,'UTF8'),'sha256')) on conflict do nothing;
  return new;
end
$function$;
create trigger work_orders_queue_road_access_change after update of status on roadops.work_orders
  for each row execute function roadops.queue_work_road_access_change();
create trigger plan_items_queue_road_access_change after update of scheduled_window,status on roadops.plan_items
  for each row execute function roadops.queue_work_road_access_change();
revoke all on function roadops.queue_work_road_access_change() from public;

revoke all on function roadops.plan_workers_ready(uuid),roadops.plan_resource_shortages(uuid),
  roadops.sync_plan_resource_requisition(uuid),roadops.decide_resource_requisition(uuid,text,text),
  roadops.reset_draft_resource_allocations(uuid),roadops.cancel_own_draft_plan(uuid,uuid),roadops.queue_work_road_access() from public;
grant execute on function roadops.plan_workers_ready(uuid),roadops.plan_resource_shortages(uuid),
  roadops.sync_plan_resource_requisition(uuid),roadops.decide_resource_requisition(uuid,text,text),
  roadops.reset_draft_resource_allocations(uuid),roadops.cancel_own_draft_plan(uuid,uuid) to roadops_api;

commit;
