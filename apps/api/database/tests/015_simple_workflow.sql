-- Isolated fixtures only. Runtime checks for staff gating, durable idempotent
-- decisions, and privilege boundaries; all changes roll back.
begin;
select roadops.complete_login('94000000-0000-0000-0000-000000000001', repeat('a1',32), repeat('a2',32),
  clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select set_config('roadops.actor_id','94000000-0000-0000-0000-000000000001',true);
select set_config('roadops.session_id',(select id::text from roadops.auth_sessions where token_hash=decode(repeat('a1',32),'hex')),true);

set local role roadops_api;
insert into roadops.planning_runs(id,division_id,planning_window,as_of,algorithm_version,input_snapshot_hash,created_by)
  values('96150000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
    daterange(current_date,current_date+1,'[)'),clock_timestamp(),'workflow-test',decode(repeat('ab',32),'hex'),
    '94000000-0000-0000-0000-000000000001');
select * from roadops.rebuild_plan_blockers('96150000-0000-0000-0000-000000000001');
do $staff_gate$
begin
  if roadops.plan_workers_ready('96150000-0000-0000-0000-000000000001') then
    raise exception 'Empty or unstaffed work was reported ready';
  end if;
  if roadops.sync_plan_resource_requisition('96150000-0000-0000-0000-000000000001') is not null
    or exists(select 1 from roadops.resource_requisitions where planning_run_id='96150000-0000-0000-0000-000000000001') then
    raise exception 'Unstaffed draft advanced to chief-engineer request';
  end if;
  begin
    perform roadops.approve_planning_run('96150000-0000-0000-0000-000000000001');
    raise exception 'Unstaffed plan was approved';
  exception when check_violation or insufficient_privilege then null;
  end;
end
$staff_gate$;
reset role;

-- A shortage retry must discard stale allocation failures, while preserving
-- the genuine plan/normalization blockers recalculation has to resolve.
insert into roadops.planning_blockers(planning_run_id,blocker_code,deterministic_signature,source)
  values('96150000-0000-0000-0000-000000000001','EQUIPMENT_CAPACITY_INSUFFICIENT',decode(repeat('b1',32),'hex'),'allocator');
set local role roadops_api;
select roadops.reset_draft_resource_allocations('96150000-0000-0000-0000-000000000001');
do $retry_allocator$
begin
  if exists(select 1 from roadops.planning_blockers where planning_run_id='96150000-0000-0000-0000-000000000001'
    and blocker_code='EQUIPMENT_CAPACITY_INSUFFICIENT' and resolved_at is null) then
    raise exception 'Stale equipment shortage will block staff and prevent rechecking new stock';
  end if;
  if not exists(select 1 from roadops.planning_blockers where planning_run_id='96150000-0000-0000-0000-000000000001'
    and blocker_code='PLAN_EMPTY' and resolved_at is null) then
    raise exception 'Resource reset improperly cleared non-allocator validation blockers';
  end if;
end
$retry_allocator$;
reset role;

-- Trusted fixture for a requisition that reached the engineer; API has no
-- INSERT/UPDATE privilege to fabricate the request or overwrite a decision.
insert into roadops.resource_requisitions(id,planning_run_id,division_id,shortages,requested_by)
  values('96150000-0000-0000-0000-000000000002','96150000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001','[{"resourceKind":"MATERIAL","missingQuantity":"10","unit":"kg"}]',
    '94000000-0000-0000-0000-000000000001');
set local role roadops_api;
do $request_decision$
declare before_reservations bigint; before_stock bigint;
begin
  select count(*) into before_reservations from roadops.material_reservations;
  select count(*) into before_stock from roadops.inventory_transactions;
  perform roadops.decide_resource_requisition('96150000-0000-0000-0000-000000000002','approved','Obtain missing material');
  perform roadops.decide_resource_requisition('96150000-0000-0000-0000-000000000002','approved','Obtain missing material');
  if not exists(select 1 from roadops.resource_requisitions where id='96150000-0000-0000-0000-000000000002'
    and status='approved' and decided_by=roadops.current_actor_id() and decided_at is not null) then
    raise exception 'Requisition decision was not persisted idempotently';
  end if;
  if before_reservations <> (select count(*) from roadops.material_reservations)
     or before_stock <> (select count(*) from roadops.inventory_transactions)
     or roadops.plan_workers_ready('96150000-0000-0000-0000-000000000001') then
    raise exception 'Requisition approval fabricated stock or bypassed staff gating';
  end if;
  if has_table_privilege('roadops_api','roadops.resource_requisitions','INSERT')
     or has_table_privilege('roadops_api','roadops.resource_requisitions','UPDATE') then
    raise exception 'Direct API writes bypass requisition workflows';
  end if;
end
$request_decision$;
reset role;

do $closure_contract$
declare definition text;
begin
  select pg_get_functiondef('roadops.queue_work_road_access()'::regprocedure) into definition;
  if position('road_access.scheduled' in definition)=0
     or position('shoulder_work' in definition)=0
     or position('startsAt' in definition)=0
     or position('endsAt' in definition)=0 then
    raise exception 'Published closure event lost its road access/time contract';
  end if;
  select pg_get_functiondef('roadops.queue_work_road_access_change()'::regprocedure) into definition;
  if position('RESCHEDULED' in definition)=0 or position('COMPLETED' in definition)=0 or position('OPEN' in definition)=0 then
    raise exception 'Closure lifecycle does not reopen or update the road';
  end if;
  if not exists(select 1 from roadops.audit_events where entity_type='resource_requisition') then
    raise exception 'Requisition decision has no audit trail';
  end if;
end
$closure_contract$;

select set_config('roadops.actor_id','',true);
set local role roadops_api;
do $no_actor$
begin
  perform roadops.decide_resource_requisition('96150000-0000-0000-0000-000000000002','rejected','No');
  raise exception 'Anonymous actor decided a requisition';
exception when insufficient_privilege then null;
end
$no_actor$;
reset role;
rollback;
