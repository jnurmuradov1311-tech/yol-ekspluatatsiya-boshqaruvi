-- Requires fixtures/test.sql. No source employee data is embedded here.
begin;

select roadops.complete_login('94000000-0000-0000-0000-000000000001', repeat('c1',32), repeat('c2',32),
                             clock_timestamp() + interval '1 hour', clock_timestamp() + interval '1 day');
select set_config('roadops.actor_id', '94000000-0000-0000-0000-000000000001', true);
select set_config('roadops.session_id', (select id::text from roadops.auth_sessions
                                        where token_hash=decode(repeat('c1',32),'hex')), true);
select set_config('roadops.request_id', '96060000-0000-0000-0000-000000000018', true);

set local role roadops_api;
do $snapshot_test$
declare
  saved_id uuid := gen_random_uuid();
  source_snapshot jsonb;
  invalid_id uuid;
begin
  source_snapshot := jsonb_build_object(
    'id', saved_id, 'divisionId', '91000000-0000-0000-0000-000000000001',
    'period', '2026-09', 'policyReference', 'TEST calculation policy',
    'currency', 'UZS', 'state', 'PREVIEW', 'paymentInitiated', false,
    'rows', jsonb_build_array(jsonb_build_object('workerId','test-worker','payableAmountUzs',null)),
    'totals', jsonb_build_object('payableAmountUzs',null)
  );
  insert into roadops.payroll_snapshots (id,division_id,work_month,policy_reference,snapshot,created_by)
  values (saved_id, '91000000-0000-0000-0000-000000000001', '2026-09-01',
          'TEST calculation policy', source_snapshot, roadops.current_actor_id());
  if not exists (select 1 from roadops.payroll_snapshots where id=saved_id
                 and snapshot=source_snapshot and octet_length(snapshot_hash)=32) then
    raise exception 'Payroll preview or generated provenance hash was not persisted';
  end if;
  begin
    update roadops.payroll_snapshots set policy_reference='changed' where id=saved_id;
    raise exception 'API could modify a saved payroll preview';
  exception when insufficient_privilege or sqlstate '55000' then null;
  end;
  invalid_id := gen_random_uuid();
  begin
    insert into roadops.payroll_snapshots (id,division_id,work_month,policy_reference,snapshot,created_by)
    values (invalid_id, '91000000-0000-0000-0000-000000000001', '2026-09-01',
            'TEST calculation policy', source_snapshot || jsonb_build_object('id',invalid_id,'state',null), roadops.current_actor_id());
    raise exception 'Null preview state bypassed the payroll snapshot constraint';
  exception when check_violation then null;
  end;
  invalid_id := gen_random_uuid();
  begin
    insert into roadops.payroll_snapshots (id,division_id,work_month,policy_reference,snapshot,created_by)
    values (invalid_id, '91000000-0000-0000-0000-000000000001', '2026-09-01',
            'TEST calculation policy', source_snapshot || jsonb_build_object('id',invalid_id,'paymentInitiated',true), roadops.current_actor_id());
    raise exception 'Payroll preview accepted a payment instruction';
  exception when check_violation then null;
  end;
end
$snapshot_test$;
reset role;

do $immutable_and_audited$
begin
  if not exists (select 1 from roadops.audit_events
                 where entity_type='payroll_snapshots' and after_data->>'policy_reference'='TEST calculation policy') then
    raise exception 'Payroll preview lost its audit history';
  end if;
  begin
    update roadops.payroll_snapshots set policy_reference='changed by owner'
    where policy_reference='TEST calculation policy';
    raise exception 'Saved payroll preview remained mutable';
  exception when sqlstate '55000' then null;
  end;
end
$immutable_and_audited$;

select set_config('roadops.actor_id', '', true);
set local role roadops_api;
do $scope_test$
begin
  if exists (select 1 from roadops.payroll_snapshots) then
    raise exception 'Unauthenticated actor could read private payroll history';
  end if;
end
$scope_test$;
reset role;

rollback;
