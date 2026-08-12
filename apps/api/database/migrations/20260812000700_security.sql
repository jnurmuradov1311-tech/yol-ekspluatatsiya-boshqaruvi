begin;

create or replace function roadops.division_for_road(
  p_road_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select rv.division_id
  from roadops.road_versions rv
  where rv.road_id = p_road_id
    and rv.valid_from <= p_at
    and (rv.valid_until is null or rv.valid_until > p_at)
  order by rv.valid_from desc limit 1
$function$;

create or replace function roadops.division_for_road_element(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_road(ev.road_id, statement_timestamp())
  from roadops.road_element_versions ev
  where ev.road_element_id = p_element_id and ev.valid_until is null
  order by ev.valid_from desc limit 1
$function$;

create or replace function roadops.division_for_worker(p_worker_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select wv.division_id
  from roadops.worker_versions wv
  where wv.worker_id = p_worker_id and wv.valid_until is null
  order by wv.valid_from desc limit 1
$function$;

create or replace function roadops.division_for_candidate(p_candidate_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_road(c.road_id, c.observed_at)
  from roadops.roadvision_candidates c where c.id = p_candidate_id
$function$;

create or replace function roadops.division_for_defect(p_defect_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_road(d.road_id, d.observed_at)
  from roadops.defect_cases d where d.id = p_defect_id
$function$;

create or replace function roadops.division_for_inspection(p_inspection_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select i.division_id from roadops.inspections i where i.id = p_inspection_id
$function$;

create or replace function roadops.division_for_annual_item(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select ap.division_id
  from roadops.annual_program_items api
  join roadops.annual_programs ap on ap.id = api.annual_program_id
  where api.id = p_item_id
$function$;

create or replace function roadops.division_for_annual_program(p_program_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select ap.division_id from roadops.annual_programs ap where ap.id = p_program_id
$function$;

create or replace function roadops.division_for_planning_run(p_run_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select pr.division_id from roadops.planning_runs pr where pr.id = p_run_id
$function$;

create or replace function roadops.division_for_plan_item(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select pr.division_id
  from roadops.plan_items pi
  join roadops.planning_runs pr on pr.id = pi.planning_run_id
  where pi.id = p_item_id
$function$;

create or replace function roadops.division_for_work_order(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_plan_item(wo.plan_item_id)
  from roadops.work_orders wo where wo.id = p_order_id
$function$;

create or replace function roadops.division_for_equipment(p_equipment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select e.division_id from roadops.equipment_units e where e.id = p_equipment_id
$function$;

create or replace function roadops.division_for_stock_location(p_location_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select s.division_id from roadops.stock_locations s where s.id = p_location_id
$function$;

create or replace function roadops.guard_direct_planning_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if pg_has_role(current_user, 'roadops_api', 'member') then
    if tg_op = 'INSERT' and tg_table_name = 'planning_runs'
       and (to_jsonb(new) ->> 'status') <> 'draft' then
      raise exception using errcode = '42501', message = 'Planning run must start as draft';
    elsif tg_op = 'INSERT' and tg_table_name = 'plan_items'
          and (to_jsonb(new) ->> 'status') <> 'candidate' then
      raise exception using errcode = '42501', message = 'Plan item must start as candidate';
    elsif tg_op = 'INSERT' and tg_table_name = 'inspections'
          and (to_jsonb(new) ->> 'status') <> 'draft' then
      raise exception using errcode = '42501', message = 'Inspection must start as draft';
    elsif tg_op = 'INSERT' and tg_table_name = 'inspection_observations'
          and (to_jsonb(new) ->> 'review_status') <> 'pending' then
      raise exception using errcode = '42501', message = 'Observation must start as pending';
    end if;
  end if;
  return new;
end
$function$;

create trigger planning_runs_direct_state_guard
before insert on roadops.planning_runs
for each row execute function roadops.guard_direct_planning_state();
create trigger plan_items_direct_state_guard
before insert on roadops.plan_items
for each row execute function roadops.guard_direct_planning_state();
create trigger inspections_direct_state_guard
before insert on roadops.inspections
for each row execute function roadops.guard_direct_planning_state();
create trigger inspection_observations_direct_state_guard
before insert on roadops.inspection_observations
for each row execute function roadops.guard_direct_planning_state();

do $enable_rls$
declare
  table_name text;
begin
  for table_name in
    select t.tablename from pg_catalog.pg_tables t where t.schemaname = 'roadops'
  loop
    execute format('alter table roadops.%I enable row level security', table_name);
    execute format('alter table roadops.%I force row level security', table_name);
    execute format(
      'create policy roadops_sync_all on roadops.%I for all to roadops_sync '
      'using (true) with check (true)', table_name
    );
    execute format(
      'create policy roadops_reporting_read on roadops.%I for select to roadops_reporting '
      'using (true)', table_name
    );
  end loop;
end
$enable_rls$;

revoke all on schema roadops from public;
revoke all on all tables in schema roadops from public;
revoke all on all sequences in schema roadops from public;
revoke all on all functions in schema roadops from public;
alter default privileges in schema roadops revoke all on tables from public;
alter default privileges in schema roadops revoke all on sequences from public;
alter default privileges in schema roadops revoke execute on functions from public;

do $optional_supabase_revokes$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema roadops from %I', role_name);
      execute format('revoke all on all tables in schema roadops from %I', role_name);
      execute format('revoke all on all sequences in schema roadops from %I', role_name);
      execute format('revoke all on all functions in schema roadops from %I', role_name);
      execute format('alter default privileges in schema roadops revoke all on tables from %I', role_name);
      execute format('alter default privileges in schema roadops revoke all on sequences from %I', role_name);
      execute format('alter default privileges in schema roadops revoke execute on functions from %I', role_name);
    end if;
  end loop;
end
$optional_supabase_revokes$;

grant usage on schema roadops to roadops_api, roadops_sync, roadops_reporting;
grant select on all tables in schema roadops to roadops_api;
grant usage, select on all sequences in schema roadops to roadops_api, roadops_sync;

grant insert, update on roadops.app_users, roadops.user_mfa_factors,
  roadops.roles, roadops.permissions,
  roadops.user_role_memberships, roadops.idempotency_keys to roadops_api;
grant update (setting_value, updated_by, updated_at)
  on roadops.system_settings to roadops_api;
grant update (
  csrf_token_hash, last_seen_at, expires_at, revoked_at, revocation_reason
) on roadops.auth_sessions to roadops_api;
grant insert on roadops.password_history to roadops_api;
grant insert, delete on roadops.role_permissions to roadops_api;
grant delete on roadops.idempotency_keys to roadops_api;

grant insert, update on roadops.integration_connections, roadops.dead_letter_events,
  roadops.sync_conflicts, roadops.integration_outbox to roadops_api;
grant insert, update on roadops.defect_types, roadops.defect_work_variant_crosswalks,
  roadops.import_issues, roadops.work_variant_skill_requirements to roadops_api;
grant update (
  formula_type, formula_parameters, interpretation_status, planning_status,
  interpretation_note, reviewed_at, reviewed_by
) on roadops.iqn_work_variants to roadops_api;
grant update (
  status, interpretation, approved_at, approved_by
) on roadops.iqn_norm_sets to roadops_api;
grant update on roadops.defect_cases to roadops_api;
grant insert on roadops.defect_case_events to roadops_api;
revoke update on roadops.defect_cases from roadops_api;
grant update (
  description, status, resolved_at, closed_at, row_version
) on roadops.defect_cases to roadops_api;
grant insert on roadops.inspections, roadops.inspection_observations,
  roadops.inspection_events to roadops_api;
grant update (
  inspection_number, division_id, road_id, inspection_started_at,
  inspection_completed_at, source_reference, row_version
) on roadops.inspections to roadops_api;
grant update (
  road_element_id, defect_type_id, chainage_span, observed_at, measured_quantity,
  measurement_unit, description, evidence, source_hash
) on roadops.inspection_observations to roadops_api;

grant insert, update on roadops.equipment_units, roadops.equipment_unavailability,
  roadops.materials, roadops.stock_locations, roadops.safety_schemes,
  roadops.annual_programs, roadops.annual_program_items to roadops_api;
grant insert on roadops.inventory_transactions to roadops_api;
grant insert on roadops.planning_runs, roadops.plan_items, roadops.planning_run_inputs to roadops_api;
grant update (
  annual_program_id, replaces_run_id, planning_window, as_of, algorithm_version,
  input_snapshot_hash, cancellation_reason, row_version
) on roadops.planning_runs to roadops_api;
grant update (
  defect_case_id, annual_program_item_id, road_id, work_variant_id, chainage_span,
  work_quantity, work_unit, formula_inputs, scheduled_window, safety_scheme_id,
  planner_note, row_version
) on roadops.plan_items to roadops_api;
grant insert, update on roadops.work_assignments, roadops.equipment_reservations,
  roadops.material_reservations, roadops.work_orders, roadops.time_entries,
  roadops.work_completion_records to roadops_api;
grant insert on roadops.work_order_events to roadops_api;

grant select, insert, update, delete on
  roadops.source_systems, roadops.integration_connections, roadops.sync_cursors,
  roadops.sync_runs, roadops.integration_inbox, roadops.integration_outbox,
  roadops.dead_letter_events, roadops.sync_conflicts,
  roadops.road_divisions, roadops.road_division_versions,
  roadops.road_division_profile_versions, roadops.roads, roadops.road_versions,
  roadops.road_elements, roadops.road_element_versions, roadops.workers,
  roadops.worker_versions, roadops.worker_qualification_versions,
  roadops.worker_availability, roadops.import_batches, roadops.import_raw_cells,
  roadops.import_issues, roadops.iqn_documents, roadops.iqn_sections,
  roadops.iqn_work_items, roadops.iqn_work_variants, roadops.iqn_resources,
  roadops.iqn_norm_sets, roadops.iqn_norm_lines,
  roadops.roadvision_attribute_staging, roadops.roadvision_attribute_catalog,
  roadops.roadvision_batches, roadops.roadvision_candidates,
  roadops.roadvision_candidate_events
to roadops_sync;

grant select on
  roadops.road_divisions, roadops.road_division_versions,
  roadops.road_division_profile_versions, roadops.roads, roadops.road_versions,
  roadops.road_elements, roadops.road_element_versions, roadops.workers,
  roadops.worker_versions, roadops.worker_qualification_versions,
  roadops.worker_availability, roadops.iqn_documents, roadops.iqn_sections,
  roadops.iqn_work_items, roadops.iqn_work_variants, roadops.iqn_resources,
  roadops.iqn_norm_sets, roadops.iqn_norm_lines,
  roadops.work_variant_skill_requirements, roadops.defect_types,
  roadops.defect_work_variant_crosswalks, roadops.roadvision_candidates,
  roadops.roadvision_candidate_verifications, roadops.inspections,
  roadops.inspection_observations, roadops.defect_cases,
  roadops.annual_programs, roadops.annual_program_items, roadops.planning_runs,
  roadops.plan_items, roadops.planning_blockers, roadops.plan_resource_requirements,
  roadops.work_assignments, roadops.work_orders, roadops.time_entries,
  roadops.work_completion_records, roadops.equipment_units, roadops.materials,
  roadops.stock_locations, roadops.inventory_transactions, roadops.audit_events,
  roadops.current_stock_balances
to roadops_reporting;

create policy app_users_api_read
on roadops.app_users for select to roadops_api
using (
  id = roadops.current_actor_id()
  or roadops.has_any_permission('users.read')
);
create policy system_settings_api_read
on roadops.system_settings for select to roadops_api
using (
  roadops.current_actor_id() is not null
  and (roadops.has_any_permission('master.read') or roadops.has_any_permission('system.all'))
);
create policy system_settings_api_update
on roadops.system_settings for update to roadops_api
using (roadops.has_any_permission('system.all'))
with check (
  roadops.has_any_permission('system.all')
  and updated_by = roadops.current_actor_id()
);
create policy app_users_api_write
on roadops.app_users for all to roadops_api
using (roadops.has_any_permission('users.manage'))
with check (roadops.has_any_permission('users.manage'));

create policy password_history_api
on roadops.password_history for all to roadops_api
using (user_id = roadops.current_actor_id() or roadops.has_any_permission('users.manage'))
with check (user_id = roadops.current_actor_id() or roadops.has_any_permission('users.manage'));
create policy mfa_factors_api
on roadops.user_mfa_factors for all to roadops_api
using (
  user_id = roadops.current_actor_id()
  or roadops.has_any_permission('users.manage')
)
with check (
  user_id = roadops.current_actor_id()
  or roadops.has_any_permission('users.manage')
);
create policy auth_sessions_api
on roadops.auth_sessions for all to roadops_api
using (
  user_id = roadops.current_actor_id()
  or roadops.has_any_permission('users.manage')
)
with check (
  user_id = roadops.current_actor_id()
  or roadops.has_any_permission('users.manage')
);
create policy login_attempts_api_read
on roadops.login_attempts for select to roadops_api
using (roadops.has_any_permission('users.manage'));
create policy login_attempts_api_insert
on roadops.login_attempts for insert to roadops_api with check (true);

create policy roles_api
on roadops.roles for all to roadops_api
using (roadops.current_actor_id() is not null)
with check (roadops.has_any_permission('users.manage'));
create policy permissions_api
on roadops.permissions for all to roadops_api
using (roadops.current_actor_id() is not null)
with check (roadops.has_any_permission('users.manage'));
create policy role_permissions_api
on roadops.role_permissions for all to roadops_api
using (roadops.current_actor_id() is not null)
with check (roadops.has_any_permission('users.manage'));
create policy memberships_api
on roadops.user_role_memberships for all to roadops_api
using (user_id = roadops.current_actor_id() or roadops.has_any_permission('users.read'))
with check (roadops.has_any_permission('users.manage'));
create policy idempotency_api
on roadops.idempotency_keys for all to roadops_api
using (actor_user_id = roadops.current_actor_id())
with check (actor_user_id = roadops.current_actor_id());

do $integration_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_systems','integration_connections','sync_cursors','sync_runs',
    'integration_inbox','integration_outbox','dead_letter_events','sync_conflicts'
  ] loop
    execute format(
      'create policy api_integration on roadops.%I for all to roadops_api '
      'using (roadops.has_any_permission(''integrations.read'') '
      'or roadops.has_any_permission(''integrations.manage'')) '
      'with check (roadops.has_any_permission(''integrations.manage''))', table_name
    );
  end loop;
end
$integration_policies$;

create policy divisions_api_read
on roadops.road_divisions for select to roadops_api
using (roadops.can_access_division(id));
create policy division_versions_api_read
on roadops.road_division_versions for select to roadops_api
using (roadops.can_access_division(division_id));
create policy division_profiles_api_read
on roadops.road_division_profile_versions for select to roadops_api
using (roadops.can_access_division(division_id));
create policy roads_api_read
on roadops.roads for select to roadops_api
using (roadops.can_access_division(roadops.division_for_road(id, statement_timestamp())));
create policy road_versions_api_read
on roadops.road_versions for select to roadops_api
using (roadops.can_access_division(division_id));
create policy road_elements_api_read
on roadops.road_elements for select to roadops_api
using (roadops.can_access_division(roadops.division_for_road_element(id)));
create policy road_element_versions_api_read
on roadops.road_element_versions for select to roadops_api
using (roadops.can_access_division(roadops.division_for_road(road_id, statement_timestamp())));
create policy workers_api_read
on roadops.workers for select to roadops_api
using (roadops.can_access_division(roadops.division_for_worker(id)));
create policy worker_versions_api_read
on roadops.worker_versions for select to roadops_api
using (roadops.can_access_division(division_id));
create policy worker_qualifications_api_read
on roadops.worker_qualification_versions for select to roadops_api
using (roadops.can_access_division(roadops.division_for_worker(worker_id)));
create policy worker_availability_api_read
on roadops.worker_availability for select to roadops_api
using (roadops.can_access_division(roadops.division_for_worker(worker_id)));

do $catalog_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'import_batches','import_raw_cells','import_issues','iqn_documents','iqn_sections',
    'iqn_work_items','iqn_work_variants','iqn_resources','iqn_norm_sets','iqn_norm_lines',
    'work_variant_skill_requirements','defect_types','defect_work_variant_crosswalks',
    'roadvision_attribute_staging',
    'roadvision_attribute_catalog'
  ] loop
    execute format(
      'create policy api_catalog on roadops.%I for all to roadops_api '
      'using (roadops.has_any_permission(''catalog.read'') '
      'or roadops.has_any_permission(''catalog.manage'')) '
      'with check (roadops.has_any_permission(''catalog.manage''))', table_name
    );
  end loop;
end
$catalog_policies$;

create policy roadvision_batches_api_read
on roadops.roadvision_batches for select to roadops_api
using (roadops.has_any_permission('defects.read'));
create policy roadvision_candidates_api_read
on roadops.roadvision_candidates for select to roadops_api
using (
  roadops.has_any_permission('defects.read')
  and (
    (road_id is not null
      and roadops.can_access_division(roadops.division_for_road(road_id, observed_at)))
    or (road_id is null and roadops.has_any_permission('integrations.manage'))
  )
);
create policy roadvision_verifications_api_read
on roadops.roadvision_candidate_verifications for select to roadops_api
using (roadops.can_access_division(roadops.division_for_candidate(candidate_id)));
create policy roadvision_events_api_read
on roadops.roadvision_candidate_events for select to roadops_api
using (roadops.can_access_division(roadops.division_for_candidate(candidate_id)));

create policy defect_cases_api
on roadops.defect_cases for all to roadops_api
using (
  roadops.can_access_division(roadops.division_for_road(road_id, observed_at))
  and roadops.has_any_permission('defects.read')
)
with check (
  roadops.can_access_division(roadops.division_for_road(road_id, observed_at))
  and (roadops.has_any_permission('defects.capture') or roadops.has_any_permission('defects.verify'))
);

create policy inspections_api
on roadops.inspections for all to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_any_permission('defects.read') or roadops.has_any_permission('defects.capture'))
)
with check (
  roadops.has_permission('defects.capture', division_id)
  and inspector_user_id = roadops.current_actor_id()
);
create policy inspection_observations_api
on roadops.inspection_observations for all to roadops_api
using (roadops.can_access_division(roadops.division_for_inspection(inspection_id)))
with check (
  roadops.has_permission('defects.capture', roadops.division_for_inspection(inspection_id))
  and exists (
    select 1 from roadops.inspections i
    where i.id = inspection_id and i.inspector_user_id = roadops.current_actor_id()
      and i.status in ('draft', 'returned')
  )
);
create policy inspection_events_api_read
on roadops.inspection_events for select to roadops_api
using (roadops.can_access_division(roadops.division_for_inspection(inspection_id)));
create policy inspection_events_api_create
on roadops.inspection_events for insert to roadops_api
with check (
  actor_user_id = roadops.current_actor_id()
  and from_status is null and to_status = 'draft'
  and event_code = 'manual_inspection_created'
  and roadops.has_permission(
    'defects.capture', roadops.division_for_inspection(inspection_id)
  )
  and exists (
    select 1
    from roadops.inspections i
    where i.id = inspection_id
      and i.inspector_user_id = roadops.current_actor_id()
      and i.status = 'draft'
  )
  and (
    observation_id is null
    or exists (
      select 1 from roadops.inspection_observations o
      where o.id = observation_id and o.inspection_id = inspection_id
    )
  )
);
create policy defect_case_events_api
on roadops.defect_case_events for all to roadops_api
using (roadops.can_access_division(roadops.division_for_defect(defect_case_id)))
with check (
  roadops.can_access_division(roadops.division_for_defect(defect_case_id))
  and (roadops.has_any_permission('defects.capture') or roadops.has_any_permission('defects.verify'))
);

create policy annual_programs_api
on roadops.annual_programs for all to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_any_permission('planning.read') or roadops.has_any_permission('planning.write'))
)
with check (roadops.has_permission('planning.write', division_id));
create policy annual_program_items_api
on roadops.annual_program_items for all to roadops_api
using (roadops.can_access_division(roadops.division_for_annual_item(id)))
with check (roadops.has_permission('planning.write', roadops.division_for_annual_program(annual_program_id)));
create policy planning_runs_api
on roadops.planning_runs for all to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_any_permission('planning.read') or roadops.has_any_permission('planning.write'))
)
with check (roadops.has_permission('planning.write', division_id));
create policy planning_run_inputs_api
on roadops.planning_run_inputs for all to roadops_api
using (roadops.can_access_division((select pr.division_id from roadops.planning_runs pr where pr.id = planning_run_id)))
with check (roadops.has_permission('planning.write', (select pr.division_id from roadops.planning_runs pr where pr.id = planning_run_id)));
create policy plan_items_api
on roadops.plan_items for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(id)))
with check (roadops.has_permission('planning.write', roadops.division_for_planning_run(planning_run_id)));
create policy planning_blockers_api_read
on roadops.planning_blockers for select to roadops_api
using (roadops.can_access_division((select pr.division_id from roadops.planning_runs pr where pr.id = planning_run_id)));
create policy plan_requirements_api_read
on roadops.plan_resource_requirements for select to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)));

create policy equipment_units_api
on roadops.equipment_units for all to roadops_api
using (roadops.can_access_division(division_id) and roadops.has_any_permission('resources.read'))
with check (roadops.has_permission('resources.manage', division_id));
create policy equipment_unavailability_api
on roadops.equipment_unavailability for all to roadops_api
using (roadops.can_access_division(roadops.division_for_equipment(equipment_unit_id)))
with check (roadops.has_permission('resources.manage', roadops.division_for_equipment(equipment_unit_id)));
create policy materials_api
on roadops.materials for all to roadops_api
using (roadops.has_any_permission('resources.read'))
with check (roadops.has_any_permission('resources.manage'));
create policy stock_locations_api
on roadops.stock_locations for all to roadops_api
using (roadops.can_access_division(division_id) and roadops.has_any_permission('resources.read'))
with check (roadops.has_permission('resources.manage', division_id));
create policy inventory_transactions_api
on roadops.inventory_transactions for all to roadops_api
using (roadops.can_access_division(roadops.division_for_stock_location(stock_location_id)))
with check (roadops.has_permission('resources.manage', roadops.division_for_stock_location(stock_location_id)));
create policy safety_schemes_api
on roadops.safety_schemes for all to roadops_api
using (roadops.can_access_division(division_id) and roadops.has_any_permission('resources.read'))
with check (
  roadops.has_permission('resources.manage', division_id)
  or roadops.has_permission('planning.write', division_id)
);

create policy work_assignments_api
on roadops.work_assignments for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (
  roadops.has_permission('planning.write', roadops.division_for_plan_item(plan_item_id))
  or roadops.has_permission('execution.manage', roadops.division_for_plan_item(plan_item_id))
);
create policy equipment_reservations_api
on roadops.equipment_reservations for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (
  roadops.has_permission('planning.write', roadops.division_for_plan_item(plan_item_id))
  or roadops.has_permission('resources.manage', roadops.division_for_plan_item(plan_item_id))
);
create policy material_reservations_api
on roadops.material_reservations for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (
  roadops.has_permission('planning.write', roadops.division_for_plan_item(plan_item_id))
  or roadops.has_permission('resources.manage', roadops.division_for_plan_item(plan_item_id))
);
create policy work_orders_api
on roadops.work_orders for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (roadops.has_permission('execution.manage', roadops.division_for_plan_item(plan_item_id)));
create policy work_order_events_api
on roadops.work_order_events for all to roadops_api
using (roadops.can_access_division(roadops.division_for_work_order(work_order_id)))
with check (roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id)));
create policy time_entries_api
on roadops.time_entries for all to roadops_api
using (roadops.can_access_division(roadops.division_for_work_order(work_order_id)))
with check (
  roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id))
  or (
    roadops.has_permission('time.write', roadops.division_for_work_order(work_order_id))
    and worker_id = (select u.worker_id from roadops.app_users u where u.id = roadops.current_actor_id())
    and recorded_by = roadops.current_actor_id()
  )
);
create policy completion_records_api
on roadops.work_completion_records for all to roadops_api
using (roadops.can_access_division(roadops.division_for_work_order(work_order_id)))
with check (roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id)));

create policy audit_events_api_read
on roadops.audit_events for select to roadops_api
using (roadops.has_any_permission('audit.read'));

grant execute on function roadops.lookup_login_identity(text) to roadops_api;
grant execute on function roadops.bootstrap_first_admin(text, text, text, uuid) to roadops_api;
grant execute on function roadops.complete_initial_totp_enrollment(uuid, text, bytea, bigint, uuid) to roadops_api;
grant execute on function roadops.consume_totp_counter(uuid, uuid, bigint) to roadops_api;
grant execute on function roadops.record_login_failure(text, text, inet, text, uuid) to roadops_api;
grant execute on function roadops.complete_login(
  uuid, text, text, timestamptz, timestamptz, uuid, bigint, inet, text, uuid
) to roadops_api;
grant execute on function roadops.authenticate_session(text) to roadops_api;
grant execute on function roadops.logout_session(uuid, inet, text, uuid) to roadops_api;
grant execute on function roadops.match_roadvision_candidate(uuid, uuid, uuid, uuid, numrange) to roadops_api;
grant execute on function roadops.verify_roadvision_candidate(uuid, text, numeric, text, text) to roadops_api;
grant execute on function roadops.submit_inspection(uuid) to roadops_api;
grant execute on function roadops.return_inspection(uuid, text) to roadops_api;
grant execute on function roadops.review_inspection_observation(uuid, text, text) to roadops_api;
grant execute on function roadops.rebuild_plan_blockers(uuid) to roadops_api;
grant execute on function roadops.approve_planning_run(uuid) to roadops_api;
grant execute on function roadops.publish_planning_run(uuid) to roadops_api;
grant execute on function roadops.dashboard_summary(uuid) to roadops_api;
grant execute on function roadops.current_actor_id(), roadops.current_session_id(),
  roadops.current_request_id(), roadops.has_permission(text, uuid),
  roadops.has_any_permission(text), roadops.can_access_division(uuid)
to roadops_api;
grant execute on function
  roadops.division_for_road(uuid, timestamptz),
  roadops.division_for_road_element(uuid), roadops.division_for_worker(uuid),
  roadops.division_for_candidate(uuid), roadops.division_for_defect(uuid),
  roadops.division_for_inspection(uuid), roadops.division_for_annual_item(uuid),
  roadops.division_for_annual_program(uuid), roadops.division_for_planning_run(uuid),
  roadops.division_for_plan_item(uuid), roadops.division_for_work_order(uuid),
  roadops.division_for_equipment(uuid), roadops.division_for_stock_location(uuid)
to roadops_api;

do $helper_function_revoke$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'roadops.division_for_road(uuid,timestamp with time zone)',
    'roadops.division_for_road_element(uuid)', 'roadops.division_for_worker(uuid)',
    'roadops.division_for_candidate(uuid)', 'roadops.division_for_defect(uuid)',
    'roadops.division_for_inspection(uuid)',
    'roadops.division_for_annual_item(uuid)', 'roadops.division_for_plan_item(uuid)',
    'roadops.division_for_annual_program(uuid)', 'roadops.division_for_planning_run(uuid)',
    'roadops.division_for_work_order(uuid)', 'roadops.division_for_equipment(uuid)',
    'roadops.division_for_stock_location(uuid)', 'roadops.guard_direct_planning_state()'
  ] loop
    execute 'revoke all on function ' || function_signature || ' from public';
  end loop;
end
$helper_function_revoke$;

notify pgrst, 'reload schema';

commit;
