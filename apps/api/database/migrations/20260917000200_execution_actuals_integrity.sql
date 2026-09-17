begin;

-- Actuals are recorded once against assigned resources; a zero is an explicit
-- non-use decision with a reason, never a fictitious charge or stock movement.
create table roadops.execution_nonuse_records (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  resource_kind text not null check (resource_kind in ('worker', 'material', 'equipment')),
  resource_id uuid not null,
  work_date date,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  request_id uuid,
  check ((resource_kind = 'worker') = (work_date is not null)),
  unique nulls not distinct (work_order_id, resource_kind, resource_id, work_date)
);
create index execution_nonuse_recorder_idx on roadops.execution_nonuse_records(recorded_by);
alter table roadops.execution_nonuse_records enable row level security;
alter table roadops.execution_nonuse_records force row level security;
create policy execution_nonuse_read on roadops.execution_nonuse_records
for select to roadops_api using (
  roadops.has_permission('execution.read', roadops.division_for_work_order(work_order_id))
  or roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id))
  or roadops.has_permission('execution.verify', roadops.division_for_work_order(work_order_id))
);
grant select on roadops.execution_nonuse_records to roadops_api;
create trigger execution_nonuse_no_truncate before truncate on roadops.execution_nonuse_records
for each statement execute function roadops.forbid_mutation();
create trigger execution_nonuse_audit after insert on roadops.execution_nonuse_records
for each row execute function roadops.capture_row_audit('execution_nonuse_records');

-- One authoritative duration calculation handles exclusive midnight endpoints,
-- late starts, cross-midnight reservations, and the actual elapsed interval.
create function roadops.execution_available_minutes(
  p_window tstzrange, p_started_at timestamptz, p_ended_at timestamptz, p_date date
) returns integer language sql immutable strict set search_path = '' as $function$
  select greatest(0, floor(extract(epoch from (
    least(upper(p_window), p_ended_at, ((p_date + 1)::timestamp at time zone 'Asia/Tashkent'))
    - greatest(lower(p_window), p_started_at, (p_date::timestamp at time zone 'Asia/Tashkent'))
  )) / 60))::integer
$function$;
revoke all on function roadops.execution_available_minutes(tstzrange,timestamptz,timestamptz,date) from public;
grant execute on function roadops.execution_available_minutes(tstzrange,timestamptz,timestamptz,date) to roadops_api;

create function roadops.record_unused_execution_resource(
  p_order_id uuid, p_kind text, p_resource_id uuid, p_work_date date, p_reason text
) returns void language plpgsql security definer set search_path = '' as $function$
declare
  order_row roadops.work_orders%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id=p_order_id for update;
  if order_row.id is null or actor_id is null
     or not roadops.has_permission('execution.manage', roadops.division_for_work_order(p_order_id)) then
    raise exception using errcode='42501', message='Cannot record unused resources for this order';
  end if;
  if order_row.status <> 'in_progress' or order_row.started_at is null then
    raise exception using errcode='55000', message='EXECUTION_ACTUALS_FROZEN';
  end if;
  if p_kind='worker' then
    if not exists (select 1 from roadops.work_assignments wa
      where wa.plan_item_id=order_row.plan_item_id and wa.worker_id=p_resource_id
        and wa.work_date=p_work_date and wa.status <> 'cancelled') then
      raise exception using errcode='23514', message='LABOR_WORKER_NOT_ASSIGNED';
    end if;
    if exists (select 1 from roadops.time_entries te where te.work_order_id=p_order_id
      and te.worker_id=p_resource_id and te.work_date=p_work_date) then
      raise exception using errcode='23514', message='UNUSED_RESOURCE_ALREADY_RECORDED';
    end if;
  elsif p_kind='material' then
    if exists (select 1 from roadops.work_order_material_usages u where u.material_reservation_id=p_resource_id) then
      raise exception using errcode='23514', message='UNUSED_RESOURCE_ALREADY_RECORDED';
    end if;
    update roadops.material_reservations set status='released'
      where id=p_resource_id and plan_item_id=order_row.plan_item_id and status='reserved';
    if not found then
      raise exception using errcode='23514', message='MATERIAL_RESERVATION_UNAVAILABLE';
    end if;
  elsif p_kind='equipment' then
    if exists (select 1 from roadops.equipment_usage_entries u where u.equipment_reservation_id=p_resource_id) then
      raise exception using errcode='23514', message='UNUSED_RESOURCE_ALREADY_RECORDED';
    end if;
    update roadops.equipment_reservations set status='cancelled'
      where id=p_resource_id and plan_item_id=order_row.plan_item_id and status in ('reserved','checked_out');
    if not found then
      raise exception using errcode='23514', message='EQUIPMENT_RESERVATION_UNAVAILABLE';
    end if;
  else
    raise exception using errcode='23514', message='Invalid non-use resource kind';
  end if;
  insert into roadops.execution_nonuse_records
    (work_order_id,resource_kind,resource_id,work_date,reason,recorded_by,request_id)
  values (p_order_id,p_kind,p_resource_id,p_work_date,btrim(p_reason),actor_id,roadops.current_request_id());
  insert into roadops.work_order_events
    (work_order_id,from_status,to_status,event_code,actor_user_id,note,details,request_id)
  values (p_order_id,order_row.status,order_row.status,'RESOURCE_NOT_USED',actor_id,btrim(p_reason),
    jsonb_build_object('kind',p_kind,'resourceId',p_resource_id,'workDate',p_work_date),roadops.current_request_id());
end
$function$;
revoke all on function roadops.record_unused_execution_resource(uuid,text,uuid,date,text) from public;
grant execute on function roadops.record_unused_execution_resource(uuid,text,uuid,date,text) to roadops_api;

create function roadops.assert_execution_resource_coverage(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  plan_id uuid;
begin
  select wo.plan_item_id into plan_id from roadops.work_orders wo where wo.id=p_order_id;
  if not exists(select 1 from roadops.time_entries te where te.work_order_id=p_order_id) then
    raise exception using errcode='23514', message='LABOR_USAGE_COVERAGE_INCOMPLETE';
  end if;
  if exists (
    select 1 from roadops.work_assignments wa
    where wa.plan_item_id=plan_id and wa.status <> 'cancelled'
      and not exists (select 1 from roadops.time_entries te where te.work_order_id=p_order_id
        and te.worker_id=wa.worker_id and te.work_date=wa.work_date)
      and not exists (select 1 from roadops.execution_nonuse_records u where u.work_order_id=p_order_id
        and u.resource_kind='worker' and u.resource_id=wa.worker_id and u.work_date=wa.work_date)
  ) then
    raise exception using errcode='23514', message='LABOR_USAGE_COVERAGE_INCOMPLETE';
  end if;
  if exists (
    select 1 from roadops.material_reservations r where r.plan_item_id=plan_id and r.status <> 'cancelled'
      and not exists (select 1 from roadops.work_order_material_usages u where u.work_order_id=p_order_id and u.material_reservation_id=r.id)
      and not exists (select 1 from roadops.execution_nonuse_records u where u.work_order_id=p_order_id and u.resource_kind='material' and u.resource_id=r.id)
  ) then
    raise exception using errcode='23514', message='MATERIAL_USAGE_COVERAGE_INCOMPLETE';
  end if;
  if exists (
    select 1 from roadops.equipment_reservations r where r.plan_item_id=plan_id and r.status <> 'cancelled'
      and not exists (select 1 from roadops.equipment_usage_entries u where u.work_order_id=p_order_id and u.equipment_reservation_id=r.id)
      and not exists (select 1 from roadops.execution_nonuse_records u where u.work_order_id=p_order_id and u.resource_kind='equipment' and u.resource_id=r.id)
  ) then
    raise exception using errcode='23514', message='EQUIPMENT_USAGE_COVERAGE_INCOMPLETE';
  end if;
end
$function$;
revoke all on function roadops.assert_execution_resource_coverage(uuid) from public;
grant execute on function roadops.assert_execution_resource_coverage(uuid) to roadops_api;

-- Every returned submission remains inspectable with the exact actual rows,
-- original inventory issue IDs, reason and authenticated reviewer.
create table roadops.execution_completion_revisions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  revision integer not null check (revision > 0),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  snapshot_hash bytea not null check (octet_length(snapshot_hash)=32),
  returned_by uuid not null references roadops.app_users(id) on delete restrict,
  returned_at timestamptz not null default clock_timestamp(),
  transaction_id bigint not null default txid_current(),
  request_id uuid,
  unique(work_order_id,revision)
);
create index execution_completion_revisions_reviewer_idx on roadops.execution_completion_revisions(returned_by);
alter table roadops.execution_completion_revisions enable row level security;
alter table roadops.execution_completion_revisions force row level security;
create policy execution_completion_revisions_read on roadops.execution_completion_revisions
for select to roadops_api using (
  roadops.has_permission('execution.read',roadops.division_for_work_order(work_order_id))
);
grant select on roadops.execution_completion_revisions to roadops_api;
create trigger execution_revisions_append_only before update or delete on roadops.execution_completion_revisions
for each row execute function roadops.forbid_mutation();
create trigger execution_revisions_no_truncate before truncate on roadops.execution_completion_revisions
for each statement execute function roadops.forbid_mutation();
create trigger execution_revisions_audit after insert on roadops.execution_completion_revisions
for each row execute function roadops.capture_row_audit('execution_completion_revisions');

-- The exception is backed by an immutable same-transaction revision which API
-- roles cannot insert themselves, rather than a client-settable session flag.
create function roadops.execution_correction_authorized(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from roadops.execution_completion_revisions revision
    join roadops.work_orders wo on wo.id=revision.work_order_id
    where wo.id=p_order_id and wo.status='completed' and wo.verified_at is null
      and revision.transaction_id=txid_current()
      and revision.returned_by=roadops.current_actor_id()
      and roadops.has_permission('execution.verify',roadops.division_for_work_order(p_order_id))
  )
$function$;
revoke all on function roadops.execution_correction_authorized(uuid) from public;

create function roadops.return_work_order_completion(p_order_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  order_row roadops.work_orders%rowtype;
  actor_id uuid := roadops.current_actor_id();
  previous_snapshot jsonb;
  revision_id uuid := gen_random_uuid();
  revision_no integer;
  usage_row roadops.work_order_material_usages%rowtype;
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id=p_order_id for update;
  if order_row.id is null or actor_id is null
     or not roadops.has_permission('execution.verify',roadops.division_for_work_order(p_order_id)) then
    raise exception using errcode='42501',message='Cannot return this work completion';
  end if;
  if order_row.status <> 'completed' or order_row.verified_at is not null
     or not exists(select 1 from roadops.work_completion_records cr where cr.work_order_id=p_order_id) then
    raise exception using errcode='55000',message='WORK_ORDER_NOT_COMPLETED';
  end if;
  if exists (select 1 from roadops.work_completion_records cr where cr.work_order_id=p_order_id
       and (cr.recorded_by=actor_id or cr.verified_at is not null))
     or exists (select 1 from roadops.time_entries te where te.work_order_id=p_order_id and te.approved_at is not null)
     or exists (select 1 from roadops.work_order_material_usages u where u.work_order_id=p_order_id and u.status='approved')
     or exists (select 1 from roadops.equipment_usage_entries u where u.work_order_id=p_order_id and u.status='approved') then
    raise exception using errcode='42501',message='Only independently reviewed pending actuals may be returned';
  end if;
  select jsonb_build_object(
    'workOrder',to_jsonb(order_row),
    'completion',(select to_jsonb(cr) from roadops.work_completion_records cr where cr.work_order_id=p_order_id),
    'timeEntries',coalesce((select jsonb_agg(to_jsonb(te) order by te.id) from roadops.time_entries te where te.work_order_id=p_order_id),'[]'::jsonb),
    'materialUsages',coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from roadops.work_order_material_usages u where u.work_order_id=p_order_id),'[]'::jsonb),
    'equipmentUsages',coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from roadops.equipment_usage_entries u where u.work_order_id=p_order_id),'[]'::jsonb),
    'unusedResources',coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from roadops.execution_nonuse_records u where u.work_order_id=p_order_id),'[]'::jsonb)
  ) into previous_snapshot;
  select coalesce(max(r.revision),0)+1 into revision_no
    from roadops.execution_completion_revisions r where r.work_order_id=p_order_id;
  insert into roadops.execution_completion_revisions
    (id,work_order_id,revision,reason,snapshot,snapshot_hash,returned_by,request_id)
  values (revision_id,p_order_id,revision_no,btrim(p_reason),previous_snapshot,
    extensions.digest(convert_to(previous_snapshot::text,'UTF8'),'sha256'),actor_id,roadops.current_request_id());

  -- Reverse only the recorded consumption. The original stock transaction and
  -- its relation to the immutable snapshot are retained permanently.
  for usage_row in select u.* from roadops.work_order_material_usages u
      where u.work_order_id=p_order_id order by u.stock_location_id,u.material_id,u.id loop
    insert into roadops.inventory_transactions
      (stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,reference_id,note,recorded_by,request_id)
    values (usage_row.stock_location_id,usage_row.material_id,'return',usage_row.quantity,clock_timestamp(),
      'execution_completion_revision',revision_id,'Tuzatish uchun qaytarildi: ' || btrim(p_reason),actor_id,roadops.current_request_id());
  end loop;
  delete from roadops.time_entries where work_order_id=p_order_id;
  delete from roadops.work_order_material_usages where work_order_id=p_order_id;
  delete from roadops.equipment_usage_entries where work_order_id=p_order_id;
  delete from roadops.work_completion_records where work_order_id=p_order_id;
  update roadops.material_reservations set status='reserved'
    where plan_item_id=order_row.plan_item_id and status in ('issued','released');
  update roadops.equipment_reservations er set status='checked_out'
    where er.plan_item_id=order_row.plan_item_id and (er.status='returned'
      or exists(select 1 from roadops.execution_nonuse_records u where u.work_order_id=p_order_id
        and u.resource_kind='equipment' and u.resource_id=er.id));
  delete from roadops.execution_nonuse_records where work_order_id=p_order_id;
  update roadops.work_orders set status='in_progress',completed_at=null,row_version=row_version+1 where id=p_order_id;
  update roadops.plan_items set status='in_progress' where id=order_row.plan_item_id;
  update roadops.work_assignments set status='in_progress' where plan_item_id=order_row.plan_item_id and status='completed';
  insert into roadops.work_order_events(work_order_id,from_status,to_status,event_code,actor_user_id,note,details,request_id)
  values(p_order_id,'completed','in_progress','WORK_COMPLETION_RETURNED',actor_id,btrim(p_reason),
    jsonb_build_object('revisionId',revision_id,'revision',revision_no),roadops.current_request_id());
end
$function$;
revoke all on function roadops.return_work_order_completion(uuid,text) from public;
grant execute on function roadops.return_work_order_completion(uuid,text) to roadops_api;

-- Lock the parent before recording or approving child rows, so verification and
-- a concurrent late INSERT cannot both commit against the same work order.
create function roadops.guard_execution_actual_mutation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  order_row roadops.work_orders%rowtype;
  old_data jsonb;
  new_data jsonb;
begin
  if tg_op='DELETE' then
    if roadops.execution_correction_authorized(old.work_order_id) then return old; end if;
    raise exception using errcode='55000', message='EXECUTION_ACTUALS_FROZEN';
  end if;
  select wo.* into order_row from roadops.work_orders wo where wo.id=new.work_order_id for update;
  if tg_op='UPDATE' then
    old_data := to_jsonb(old)-array['approved_at','approved_by','verified_at','verified_by','status'];
    new_data := to_jsonb(new)-array['approved_at','approved_by','verified_at','verified_by','status'];
    if old_data is distinct from new_data or order_row.status <> 'completed' then
      raise exception using errcode='55000', message='EXECUTION_ACTUALS_FROZEN';
    end if;
    return new;
  end if;
  if order_row.status <> 'in_progress' or order_row.started_at is null
     or (to_jsonb(new)->>'approved_at') is not null
     or (to_jsonb(new)->>'approved_by') is not null
     or (to_jsonb(new)->>'verified_at') is not null
     or (to_jsonb(new)->>'verified_by') is not null then
    raise exception using errcode='55000', message='EXECUTION_ACTUALS_FROZEN';
  end if;
  return new;
end
$function$;
create trigger time_entries_actual_mutation before insert or update or delete on roadops.time_entries
for each row execute function roadops.guard_execution_actual_mutation();
create trigger material_usage_actual_mutation before insert or update or delete on roadops.work_order_material_usages
for each row execute function roadops.guard_execution_actual_mutation();
create trigger equipment_usage_actual_mutation before insert or update or delete on roadops.equipment_usage_entries
for each row execute function roadops.guard_execution_actual_mutation();
create trigger completion_actual_mutation before insert or update or delete on roadops.work_completion_records
for each row execute function roadops.guard_execution_actual_mutation();
create trigger nonuse_actual_mutation before insert or update or delete on roadops.execution_nonuse_records
for each row execute function roadops.guard_execution_actual_mutation();
revoke all on function roadops.guard_execution_actual_mutation() from public;

create function roadops.validate_execution_labor_window()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  order_row roadops.work_orders%rowtype;
  available_minutes integer;
  previous_minutes integer;
begin
  if tg_op='UPDATE' then return new; end if;
  select wo.* into order_row from roadops.work_orders wo where wo.id=new.work_order_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.worker_id::text || ':' || new.work_date::text, 20260917));
  select coalesce(sum(roadops.execution_available_minutes(wa.scheduled_window,order_row.started_at,
      coalesce(order_row.completed_at,clock_timestamp()),new.work_date)),0)::integer into available_minutes
  from roadops.work_assignments wa where wa.plan_item_id=order_row.plan_item_id
    and wa.worker_id=new.worker_id and wa.work_date=new.work_date and wa.status <> 'cancelled';
  select coalesce(sum(te.actual_minutes),0)::integer into previous_minutes
  from roadops.time_entries te where te.work_order_id=new.work_order_id
    and te.worker_id=new.worker_id and te.work_date=new.work_date;
  if exists (select 1 from roadops.time_entries te where te.worker_id=new.worker_id
    and te.work_date=new.work_date and (
      (te.work_order_id=new.work_order_id and (te.started_at is null or new.started_at is null))
      or (te.started_at is not null and new.started_at is not null
        and tstzrange(te.started_at,te.ended_at,'[)') && tstzrange(new.started_at,new.ended_at,'[)'))
    )) then
    raise exception using errcode='23514', message='LABOR_USAGE_EXCEEDS_WORK_WINDOW';
  end if;
  if previous_minutes+new.actual_minutes > available_minutes
     or (new.started_at is not null and (new.started_at < order_row.started_at
       or new.ended_at > clock_timestamp()
       or new.actual_minutes > extract(epoch from (new.ended_at-new.started_at))/60
       or not exists (select 1 from roadops.work_assignments wa where wa.plan_item_id=order_row.plan_item_id
         and wa.worker_id=new.worker_id and wa.work_date=new.work_date and wa.status <> 'cancelled'
         and wa.scheduled_window @> tstzrange(new.started_at,new.ended_at,'[)')))) then
    raise exception using errcode='23514', message='LABOR_USAGE_EXCEEDS_WORK_WINDOW';
  end if;
  if exists(select 1 from roadops.execution_nonuse_records u where u.work_order_id=new.work_order_id
    and u.resource_kind='worker' and u.resource_id=new.worker_id and u.work_date=new.work_date) then
    raise exception using errcode='23514', message='UNUSED_RESOURCE_ALREADY_RECORDED';
  end if;
  select coalesce(sum(te.actual_minutes),0)::integer into previous_minutes
  from roadops.time_entries te where te.worker_id=new.worker_id and te.work_date=new.work_date;
  if previous_minutes+new.actual_minutes > 420 then
    raise exception using errcode='23514', message='LABOR_DAILY_LIMIT_EXCEEDED';
  end if;
  return new;
end
$function$;
create trigger time_entries_work_window before insert or update on roadops.time_entries
for each row execute function roadops.validate_execution_labor_window();
revoke all on function roadops.validate_execution_labor_window() from public;

create function roadops.validate_execution_equipment_window()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  order_row roadops.work_orders%rowtype;
  reservation_row roadops.equipment_reservations%rowtype;
begin
  if tg_op='UPDATE' then return new; end if;
  select wo.* into order_row from roadops.work_orders wo where wo.id=new.work_order_id for update;
  select er.* into reservation_row from roadops.equipment_reservations er where er.id=new.equipment_reservation_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.equipment_unit_id::text || ':' || new.usage_date::text, 20260918));
  if new.actual_machine_minutes > roadops.execution_available_minutes(reservation_row.reserved_window,
      order_row.started_at,coalesce(order_row.completed_at,clock_timestamp()),new.usage_date)
     or (new.started_at is not null and (not reservation_row.reserved_window @> tstzrange(new.started_at,new.ended_at,'[)')
       or new.ended_at > clock_timestamp())) then
    raise exception using errcode='23514', message='EQUIPMENT_USAGE_EXCEEDS_WORK_WINDOW';
  end if;
  if exists(select 1 from roadops.equipment_usage_entries u
    join roadops.equipment_reservations r on r.id=u.equipment_reservation_id
    where u.equipment_unit_id=new.equipment_unit_id and u.usage_date=new.usage_date
      and r.reserved_window && reservation_row.reserved_window) then
    raise exception using errcode='23514', message='EQUIPMENT_USAGE_OVERLAP';
  end if;
  return new;
end
$function$;
create trigger equipment_usage_work_window before insert or update on roadops.equipment_usage_entries
for each row execute function roadops.validate_execution_equipment_window();
revoke all on function roadops.validate_execution_equipment_window() from public;

create function roadops.guard_execution_completion_transition()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if (old.started_at is not null and new.started_at is distinct from old.started_at)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at
       and not (new.completed_at is null and roadops.execution_correction_authorized(old.id)))
     or new.plan_item_id is distinct from old.plan_item_id then
    raise exception using errcode='55000', message='EXECUTION_ACTUALS_FROZEN';
  end if;
  if new.status is distinct from old.status then
    if (old.status='issued' and new.status not in ('accepted','in_progress','cancelled'))
       or (old.status='accepted' and new.status not in ('in_progress','cancelled'))
       or (old.status='in_progress' and new.status not in ('paused','completed'))
       or (old.status='paused' and new.status not in ('in_progress','cancelled'))
       or (old.status='completed' and new.status <> 'verified'
         and not (new.status='in_progress' and roadops.execution_correction_authorized(old.id)))
       or old.status in ('verified','cancelled') then
      raise exception using errcode='55000', message='Invalid work order lifecycle transition';
    end if;
    if new.status in ('completed','verified') then
      if not exists (select 1 from roadops.work_completion_records cr
        join roadops.plan_items pi on pi.id=new.plan_item_id
        where cr.work_order_id=new.id and cr.work_unit=pi.work_unit
          and cr.completed_quantity <= pi.work_quantity) then
        raise exception using errcode='23514', message='Valid work completion record required';
      end if;
      perform roadops.assert_execution_resource_coverage(new.id);
    end if;
  end if;
  return new;
end
$function$;
create trigger work_orders_execution_transition before update on roadops.work_orders
for each row execute function roadops.guard_execution_completion_transition();
revoke all on function roadops.guard_execution_completion_transition() from public;

-- Warehouse debit paths share the same stock lock as execution. Decimal numeric
-- sums remain exact; immutable compensating entries are required for corrections.
create function roadops.guard_inventory_nonnegative_balance()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  balance numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode='55000', message='Inventory ledger is append-only';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.stock_location_id::text || ':' || new.material_id::text,20260818));
  select coalesce(sum(tx.quantity_delta),0) into balance from roadops.inventory_transactions tx
    where tx.stock_location_id=new.stock_location_id and tx.material_id=new.material_id;
  if balance+new.quantity_delta < 0 then
    raise exception using errcode='23514', message='INSUFFICIENT_MATERIAL_STOCK';
  end if;
  return new;
end
$function$;
create trigger inventory_transactions_nonnegative before insert or update or delete on roadops.inventory_transactions
for each row execute function roadops.guard_inventory_nonnegative_balance();
revoke all on function roadops.guard_inventory_nonnegative_balance() from public;

-- Dispatch and acceptance may be done by the same chief; execution evidence
-- must still be independently recorded by another actor.
create or replace function roadops.guard_independent_completion_verification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  order_id uuid;
  author_id uuid;
begin
  if tg_table_name = 'work_orders' then
    if new.status <> 'verified' or old.status = 'verified' then
      return new;
    end if;
    order_id := new.id;
    select cr.recorded_by into author_id from roadops.work_completion_records cr where cr.work_order_id=new.id;
    if old.status <> 'completed' or new.verified_at is null
       or new.verified_by is distinct from actor_id then
      raise exception using errcode = '23514',
        message = 'Work order verification must be an authenticated completed-to-verified transition';
    end if;
    if not exists (
      select 1 from roadops.work_completion_records cr
      where cr.work_order_id = new.id and cr.verified_at is not null
        and cr.verified_by = actor_id and cr.recorded_by <> actor_id
    ) then
      raise exception using errcode = '23514',
        message = 'Work completion record must be independently verified first';
    end if;
  else
    if new.verified_at is null or old.verified_at is not null then
      return new;
    end if;
    order_id := new.work_order_id;
    author_id := new.recorded_by;
    if new.verified_by is distinct from actor_id then
      raise exception using errcode = '23514',
        message = 'Completion verifier must be the authenticated actor';
    end if;
    if not exists (
      select 1 from roadops.work_orders wo
      where wo.id = new.work_order_id and wo.status = 'completed'
    ) then
      raise exception using errcode = '23514',
        message = 'Only a completed work order record can be verified';
    end if;
  end if;
  division_id := roadops.division_for_work_order(order_id);
  if actor_id is null or actor_id = author_id
     or not roadops.has_permission('execution.verify', division_id) then
    raise exception using errcode = '42501',
      message = 'Completion must be verified by an independent authorized actor';
  end if;
  return new;
end
$function$;

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
     or actor_id = completion_row.recorded_by then
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


commit;
