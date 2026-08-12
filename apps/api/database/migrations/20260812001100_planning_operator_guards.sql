begin;

alter table roadops.work_variant_skill_requirements
  add column requirement_kind text not null default 'worker'
  check (requirement_kind in ('worker', 'equipment_operator'));

comment on column roadops.work_variant_skill_requirements.requirement_kind is
  'Human-approved worker role. equipment_operator is mandatory when an IQN variant uses equipment.';

alter table roadops.planning_blockers
  drop constraint if exists planning_blockers_source_ck;
alter table roadops.planning_blockers
  drop constraint if exists planning_blockers_source_check;
alter table roadops.planning_blockers
  add constraint planning_blockers_source_ck
  check (source in ('engine', 'validation', 'allocator'));

create or replace function roadops.put_allocator_blocker(
  p_run_id uuid,
  p_plan_item_id uuid,
  p_code text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signature bytea;
  run_division_id uuid;
begin
  select r.division_id into run_division_id
  from roadops.planning_runs r where r.id = p_run_id;
  if run_division_id is null then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if not roadops.has_permission('planning.write', run_division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot validate this division plan';
  end if;
  if p_plan_item_id is null or not exists (
    select 1 from roadops.plan_items pi
    where pi.id = p_plan_item_id and pi.planning_run_id = p_run_id
  ) then
    raise exception using errcode = '23514', message = 'Allocator blocker must reference a plan item in the run';
  end if;
  if p_code not in (
    'EQUIPMENT_UNIT_CONVERSION_REQUIRED',
    'EQUIPMENT_CAPACITY_INSUFFICIENT'
  ) then
    raise exception using errcode = '23514', message = 'Unsupported allocator blocker code';
  end if;

  signature := extensions.digest(
    convert_to(
      concat_ws('|', p_run_id::text, p_plan_item_id::text, p_code,
                coalesce(p_entity_type, ''), coalesce(p_entity_id::text, '')),
      'UTF8'
    ),
    'sha256'
  );
  insert into roadops.planning_blockers (
    planning_run_id, plan_item_id, blocker_code, entity_type, entity_id,
    details, deterministic_signature, source
  ) values (
    p_run_id, p_plan_item_id, p_code, p_entity_type, p_entity_id,
    coalesce(p_details, '{}'::jsonb), signature, 'allocator'
  )
  on conflict (planning_run_id, deterministic_signature) do update
    set details = excluded.details,
        detected_at = clock_timestamp(),
        resolved_at = null,
        source = 'allocator';
end
$function$;

create or replace function roadops.resolve_allocator_blocker(
  p_run_id uuid,
  p_plan_item_id uuid,
  p_code text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_division_id uuid;
begin
  select r.division_id into run_division_id
  from roadops.planning_runs r where r.id = p_run_id;
  if run_division_id is null then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if not roadops.has_permission('planning.write', run_division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot validate this division plan';
  end if;
  update roadops.planning_blockers b
  set resolved_at = clock_timestamp()
  where b.planning_run_id = p_run_id and b.plan_item_id = p_plan_item_id
    and b.blocker_code = p_code and b.entity_id = p_entity_id
    and b.source = 'allocator' and b.resolved_at is null;
end
$function$;

create or replace function roadops.add_equipment_operator_blockers(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row roadops.planning_runs%rowtype;
  item record;
begin
  select r.* into run_row
  from roadops.planning_runs r where r.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if run_row.status not in ('draft', 'evaluated') then
    raise exception using errcode = '55000', message = 'Only draft or evaluated plan can be validated';
  end if;
  if not roadops.has_permission('planning.write', run_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot evaluate this division plan';
  end if;

  update roadops.planning_blockers b
  set resolved_at = clock_timestamp()
  where b.planning_run_id = p_run_id
    and b.blocker_code = 'EQUIPMENT_OPERATOR_SKILL_MISSING'
    and b.source = 'engine' and b.resolved_at is null;

  for item in
    select pi.id, pi.work_variant_id,
           coalesce(
             (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date,
             run_row.as_of::date
           ) work_date
    from roadops.plan_items pi
    where pi.planning_run_id = p_run_id and pi.status <> 'cancelled'
      and exists (
        select 1 from roadops.plan_resource_requirements pr
        where pr.plan_item_id = pi.id and pr.resource_kind = 'equipment'
      )
    order by pi.id
  loop
    if not exists (
      select 1 from roadops.work_variant_skill_requirements sr
      where sr.work_variant_id = item.work_variant_id
        and sr.requirement_kind = 'equipment_operator'
        and sr.status = 'approved'
        and sr.effective_from <= item.work_date
        and (sr.effective_until is null or sr.effective_until > item.work_date)
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'EQUIPMENT_OPERATOR_SKILL_MISSING',
        'iqn_work_variant', item.work_variant_id,
        jsonb_build_object(
          'work_date', item.work_date,
          'message', 'Approved equipment-operator skill requirement is mandatory'
        )
      );
    end if;
  end loop;

  update roadops.plan_items pi
  set status = case
    when exists (
      select 1 from roadops.planning_blockers b
      where b.plan_item_id = pi.id and b.resolved_at is null
    ) then 'blocked' else 'ready' end
  where pi.planning_run_id = p_run_id and pi.status in ('candidate', 'blocked', 'ready');
end
$function$;

revoke all on function roadops.add_equipment_operator_blockers(uuid) from public;
revoke all on function roadops.put_allocator_blocker(uuid, uuid, text, text, uuid, jsonb) from public;
revoke all on function roadops.resolve_allocator_blocker(uuid, uuid, text, uuid) from public;
grant execute on function roadops.add_equipment_operator_blockers(uuid) to roadops_api;
grant execute on function roadops.put_allocator_blocker(uuid, uuid, text, text, uuid, jsonb) to roadops_api;
grant execute on function roadops.resolve_allocator_blocker(uuid, uuid, text, uuid) to roadops_api;

commit;
