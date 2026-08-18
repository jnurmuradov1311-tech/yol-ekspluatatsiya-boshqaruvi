-- Run after migrations and fixtures/test.sql. The transaction is rolled back.
begin;

do $test$
begin
  if not has_function_privilege(
    'roadops_api', 'roadops.admin_organization_hierarchy()', 'EXECUTE'
  ) then
    raise exception 'API role cannot execute the guarded organization hierarchy';
  end if;
  if has_function_privilege(
    'roadops_sync', 'roadops.admin_organization_hierarchy()', 'EXECUTE'
  ) then
    raise exception 'Sync role unexpectedly received the admin hierarchy function';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'roadops'
      and relation.relname = 'organization_units'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'Organization identities must use FORCE ROW LEVEL SECURITY';
  end if;
end
$test$;

set local role roadops_sync;

insert into roadops.organization_units (
  id, source_system_id, external_id, organization_level
) values
  ('95000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'TEST-REPUBLIC', 'REPUBLIC'),
  ('95000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'TEST-REGION', 'REGION'),
  ('95000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'TEST-ENTERPRISE', 'ENTERPRISE');

insert into roadops.organization_unit_versions (
  id, organization_unit_id, source_version, code, name, valid_from, payload_hash
) values
  ('95100000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001',
   'org-test-v1-republic', 'UZ', 'Test Republic', '2026-01-01 00:00:00+05', decode(repeat('a1', 32), 'hex')),
  ('95100000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000002',
   'org-test-v1-region', 'TST-REG', 'Test Region', '2026-01-01 00:00:00+05', decode(repeat('a2', 32), 'hex')),
  ('95100000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000003',
   'org-test-v1-enterprise', 'TST-ENT', 'Test Enterprise', '2026-01-01 00:00:00+05', decode(repeat('a3', 32), 'hex'));

insert into roadops.organization_parent_assignments (
  id, source_system_id, external_id,
  child_organization_unit_id, parent_organization_unit_id,
  source_version, valid_from, payload_hash
) values (
  '95200000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001', 'TEST-REGION-PARENT',
  '95000000-0000-0000-0000-000000000002',
  '95000000-0000-0000-0000-000000000001',
  'org-parent-v1-region', '2026-01-01 00:00:00+05', decode(repeat('b1', 32), 'hex')
);

insert into roadops.organization_parent_assignments (
  id, source_system_id, external_id,
  child_organization_unit_id, parent_organization_unit_id,
  source_version, valid_from, payload_hash
) values (
  '95200000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000001', 'TEST-ENTERPRISE-PARENT',
  '95000000-0000-0000-0000-000000000003',
  '95000000-0000-0000-0000-000000000002',
  'org-parent-v1-enterprise', '2026-01-01 00:00:00+05', decode(repeat('b2', 32), 'hex')
);

insert into roadops.division_enterprise_assignments (
  id, source_system_id, external_id, division_id, enterprise_organization_unit_id,
  source_version, valid_from, payload_hash
) values (
  '95300000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001', 'TEST-DIVISION-ENTERPRISE',
  '91000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000003',
  'division-enterprise-v1', '2026-01-01 00:00:00+05', decode(repeat('c1', 32), 'hex')
);

do $test$
begin
  begin
    insert into roadops.organization_parent_assignments (
      source_system_id, external_id,
      child_organization_unit_id, parent_organization_unit_id,
      source_version, valid_from, payload_hash
    ) values (
      '90000000-0000-0000-0000-000000000001', 'TEST-OVERLAPPING-PARENT',
      '95000000-0000-0000-0000-000000000003',
      '95000000-0000-0000-0000-000000000002',
      'overlapping-parent-must-fail', '2026-06-01 00:00:00+05', decode(repeat('d1', 32), 'hex')
    );
    raise exception 'Overlapping effective organization parent was accepted';
  exception when exclusion_violation then
    null;
  end;

  begin
    insert into roadops.division_enterprise_assignments (
      source_system_id, external_id, division_id, enterprise_organization_unit_id,
      source_version, valid_from, payload_hash
    ) values (
      '90000000-0000-0000-0000-000000000001', 'TEST-OVERLAPPING-ENTERPRISE',
      '91000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000003',
      'overlapping-enterprise-must-fail', '2026-06-01 00:00:00+05', decode(repeat('d2', 32), 'hex')
    );
    raise exception 'Overlapping effective division Enterprise was accepted';
  exception when exclusion_violation then
    null;
  end;

  begin
    insert into roadops.organization_parent_assignments (
      source_system_id, external_id,
      child_organization_unit_id, parent_organization_unit_id,
      source_version, valid_from, payload_hash
    ) values (
      '90000000-0000-0000-0000-000000000001', 'TEST-CYCLE',
      '95000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000003',
      'cycle-must-fail', '2026-01-01 00:00:00+05', decode(repeat('d3', 32), 'hex')
    );
    raise exception 'Invalid/cyclic hierarchy edge was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update roadops.organization_unit_versions
    set name = 'Rewritten history must fail'
    where id = '95100000-0000-0000-0000-000000000003';
    raise exception 'Organization version history was rewritten';
  exception when check_violation then
    null;
  end;

  update roadops.organization_unit_versions
  set valid_until = statement_timestamp() + interval '1 year'
  where id = '95100000-0000-0000-0000-000000000003';
  begin
    update roadops.organization_unit_versions
    set valid_until = statement_timestamp() + interval '6 months'
    where id = '95100000-0000-0000-0000-000000000003';
    raise exception 'Closed organization version was closed a second time';
  exception when check_violation then
    null;
  end;

  update roadops.division_enterprise_assignments
  set valid_until = statement_timestamp() + interval '1 year'
  where id = '95300000-0000-0000-0000-000000000001';
  begin
    update roadops.division_enterprise_assignments
    set valid_until = statement_timestamp() + interval '6 months'
    where id = '95300000-0000-0000-0000-000000000001';
    raise exception 'Closed Division -> Enterprise assignment was closed a second time';
  exception when check_violation then
    null;
  end;

  begin
    delete from roadops.organization_parent_assignments
    where id = '95200000-0000-0000-0000-000000000002';
    raise exception 'Source-owned hierarchy history was deleted';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from roadops.organization_unit_versions
    where id = '95100000-0000-0000-0000-000000000003';
    raise exception 'Source-owned organization version history was deleted';
  exception when sqlstate '55000' then
    null;
  end;
end
$test$;

reset role;

set local role roadops_api;
select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000001', true
);

do $test$
declare
  snapshot record;
begin
  select * into snapshot from roadops.admin_organization_hierarchy();

  if snapshot.official_network_length_km <> 42371
     or snapshot.synchronized_republic_count <> 1
     or snapshot.synchronized_region_count <> 1
     or snapshot.synchronized_enterprise_count <> 1
     or snapshot.synchronized_division_count <> 1
     or snapshot.unlinked_node_count <> 0
     or not snapshot.hierarchy_complete then
    raise exception 'Authoritative organization hierarchy summary is incorrect';
  end if;
  if snapshot.hierarchy_tree #>> '{0,officialNetworkLengthKm}' <> '42371'
     or snapshot.hierarchy_tree #>> '{0,children,0,children,0,children,0,level}' <> 'DIVISION' then
    raise exception 'Republic baseline or four-level organization tree is incorrect';
  end if;
end
$test$;

reset role;

set local role roadops_sync;
insert into roadops.organization_units (
  id, source_system_id, external_id, organization_level
) values (
  '95000000-0000-0000-0000-000000000004',
  '90000000-0000-0000-0000-000000000001',
  'TEST-REGION-WITHOUT-VERSION', 'REGION'
);
reset role;

set local role roadops_api;
select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000001', true
);

do $test$
declare
  snapshot record;
begin
  select * into snapshot from roadops.admin_organization_hierarchy();
  if snapshot.hierarchy_complete
     or snapshot.unlinked_node_count <> 1
     or snapshot.unlinked_nodes #>> '{0,reason}'
       <> 'ORGANIZATION_VERSION_MISSING_OR_INEFFECTIVE' then
    raise exception 'Active identity without an effective version was hidden from hierarchy completeness';
  end if;
end
$test$;

reset role;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '95400000-0000-0000-0000-000000000001', 'division-hierarchy-test@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Division Hierarchy Test User', 'active', false, clock_timestamp()
);
insert into roadops.user_role_memberships (
  id, user_id, role_id, division_id, valid_from
)
select '95400000-0000-0000-0000-000000000002',
       '95400000-0000-0000-0000-000000000001', role.id,
       '91000000-0000-0000-0000-000000000001',
       '2026-01-01 00:00:00+05'
from roadops.roles role
where role.code = 'division_manager';

set local role roadops_api;
select set_config(
  'roadops.actor_id', '95400000-0000-0000-0000-000000000001', true
);

do $test$
declare
  visible_count integer;
begin
  select count(*) into visible_count from roadops.organization_units;
  if visible_count <> 0 then
    raise exception 'National organization identities leaked through RLS';
  end if;

  begin
    perform * from roadops.admin_organization_hierarchy();
    raise exception 'Division actor unexpectedly executed the organization hierarchy';
  exception when insufficient_privilege then
    null;
  end;
end
$test$;

rollback;
