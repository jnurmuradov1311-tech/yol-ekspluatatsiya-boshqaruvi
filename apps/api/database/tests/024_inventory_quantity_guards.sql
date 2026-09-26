-- Requires fixtures/test.sql. Uses synthetic source/catalog rows only here.
begin;

-- Helpers run only inside authorized table triggers / guarded owner functions.
-- A scoped backend caller must not use SECURITY DEFINER helpers to probe assets.
do $inventory_helper_privileges$
declare role_name text; signature text;
begin
  foreach role_name in array array['roadops_api','roadops_sync','roadops_reporting'] loop
    foreach signature in array array[
      'roadops.inventory_physical_quantity(uuid,numrange,text)',
      'roadops.inventory_work_capacity(uuid,uuid,numrange,timestamptz,uuid)',
      'roadops.assert_plan_inventory_quantity(roadops.plan_items)',
      'roadops.guard_inspection_inventory_quantity()',
      'roadops.guard_plan_inventory_quantity()',
      'roadops.guard_completion_inventory_quantity()'
    ] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'Private inventory helper exposed to role %: %',role_name,signature;
      end if;
    end loop;
  end loop;
end
$inventory_helper_privileges$;

do $annual_schedule$
begin
  if (select sum(occurrences) from roadops.annual_occurrence_months(365, array[1,2,3,4,5,6,7,8,9,10,11,12])) <> 365
     or (select count(*) from roadops.annual_occurrence_months(2, array[4,8])) <> 2
     or exists (select 1 from roadops.annual_occurrence_months(2, array[4,8]) where month_number not in (4,8)) then
    raise exception 'Annual schedule loses occurrences or uses an unapproved month';
  end if;
  if has_table_privilege('roadops_api', 'roadops.annual_programs', 'UPDATE')
     or has_table_privilege('roadops_api', 'roadops.annual_program_items', 'INSERT') then
    raise exception 'API can bypass guarded annual generation/approval';
  end if;
end
$annual_schedule$;

set local role roadops_sync;
insert into roadops.road_division_assignments
  (source_system_id, external_id, road_id, division_id, source_version, chainage_span, valid_from, payload_hash)
values ('90000000-0000-0000-0000-000000000001', 'ANNUAL-TEST-ASSIGNMENT',
        '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
        'v1', numrange(0,1000,'[)'), '2026-01-01', decode(repeat('b3',32), 'hex'));
insert into roadops.road_elements (id,source_system_id,external_id)
values ('96090000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','ANNUAL-SIGN');
insert into roadops.road_element_versions
  (id, road_element_id,road_id,source_version,element_type,chainage_point_m,valid_from,payload_hash)
values ('96090000-0000-0000-0000-000000000002','96090000-0000-0000-0000-000000000001',
        '92000000-0000-0000-0000-000000000001','v1','TEST-SIGN',10,
        '2026-01-01',decode(repeat('b4',32),'hex'));
insert into roadops.import_batches
  (id,import_kind,source_filename,source_sha256,parser_version,state,completed_at)
values ('96090000-0000-0000-0000-000000000003','iqn_document','annual-synthetic.docx',
        decode(repeat('b5',32),'hex'),'annual-test','accepted',clock_timestamp());
insert into roadops.iqn_documents
  (id,import_batch_id,code,title,revision,document_kind,source_sha256,effective_from)
values ('96090000-0000-0000-0000-000000000004','96090000-0000-0000-0000-000000000003',
        'ANNUAL-TEST','Synthetic annual norm','test','iqn_02',decode(repeat('b5',32),'hex'),'2026-01-01');
insert into roadops.iqn_work_items
  (id,document_id,source_sequence,raw_name,normalized_name,item_kind,source_location)
values ('96090000-0000-0000-0000-000000000005','96090000-0000-0000-0000-000000000004',
        1,'Synthetic sign wash','Synthetic sign wash','task','{}');
insert into roadops.iqn_work_variants
  (id,work_item_id,variant_key,basis_quantity,basis_unit,formula_type,interpretation_status,
   planning_status,reviewed_at,reviewed_by,source_location)
values ('96090000-0000-0000-0000-000000000006','96090000-0000-0000-0000-000000000005',
        'test',1,'dona','linear','approved','automatic',clock_timestamp(),
        '94000000-0000-0000-0000-000000000001','{}');
insert into roadops.iqn_resources
  (id,document_id,resource_kind,raw_name,normalized_name,unit,source_location)
values ('96090000-0000-0000-0000-000000000007','96090000-0000-0000-0000-000000000004',
        'labor','Labor','Labor','minute','{}');
insert into roadops.iqn_norm_sets
  (id,work_variant_id,norm_set_key,status,effective_from,source_location,approved_at,approved_by)
values ('96090000-0000-0000-0000-000000000008','96090000-0000-0000-0000-000000000006',
        'test','approved','2026-01-01','{}',clock_timestamp(),'94000000-0000-0000-0000-000000000001');
insert into roadops.iqn_norm_lines
  (norm_set_id,source_line_number,resource_id,minutes_per_basis,unit,source_location)
values ('96090000-0000-0000-0000-000000000008',1,'96090000-0000-0000-0000-000000000007',10,'minute','{}');
reset role;

select roadops.complete_login('94000000-0000-0000-0000-000000000001',repeat('b6',32),repeat('b7',32),
                             clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select set_config('roadops.actor_id','94000000-0000-0000-0000-000000000001',true);
select set_config('roadops.session_id',(select id::text from roadops.auth_sessions where token_hash=decode(repeat('b6',32),'hex')),true);
select set_config('roadops.request_id','96090000-0000-0000-0000-000000000010',true);
set local role roadops_api;

do $missing_rule$
begin
  perform roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2026);
  raise exception 'Generator invented a missing inventory-to-IQN mapping';
exception when check_violation then
  if sqlerrm <> 'ANNUAL_APPROVED_RULES_OR_INVENTORY_MISSING' then raise; end if;
end
$missing_rule$;

insert into roadops.annual_maintenance_rules
  (work_variant_id,element_type,quantity_method,inventory_unit,conversion_factor,annual_occurrences,
   allowed_months,source_reference,scheduling_note,effective_from,created_by)
values ('96090000-0000-0000-0000-000000000006','TEST-SIGN','count','dona',1,4,
        array[4,8],'Synthetic test recurrence: four annually','Two April and two August test days',
        '2026-01-01','94000000-0000-0000-0000-000000000001');
select roadops.approve_annual_maintenance_rule(id) from roadops.annual_maintenance_rules where element_type='TEST-SIGN';


-- The approved recurrence permits two separate April dates for the one sign.
select roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2026);
select roadops.approve_annual_program(id) from roadops.annual_programs where program_year=2026;
reset role;

create function pg_temp.inventory_test_id(text) returns uuid language sql immutable as $$
  select md5('inventory-quantity-test:'||$1)::uuid
$$;

insert into roadops.planning_runs
  (id,division_id,planning_window,as_of,algorithm_version,input_snapshot_hash,created_by)
values(pg_temp.inventory_test_id('run'),'91000000-0000-0000-0000-000000000001','[2026-04-01,2026-09-01)',
       clock_timestamp(),'inventory-test',decode(repeat('cd',32),'hex'),'94000000-0000-0000-0000-000000000001');

create function pg_temp.add_inventory_plan(label text,work_day date,quantity numeric,location numrange default '[10,11)'::numrange)
returns void language plpgsql as $$
declare item_id uuid;
begin
  select id into item_id from roadops.annual_program_items
  where work_variant_id='96090000-0000-0000-0000-000000000006' and planned_period @> work_day;
  insert into roadops.plan_items
    (id,planning_run_id,annual_program_item_id,road_id,work_variant_id,chainage_span,work_quantity,work_unit,scheduled_window)
  values(pg_temp.inventory_test_id(label),pg_temp.inventory_test_id('run'),item_id,
    '92000000-0000-0000-0000-000000000001','96090000-0000-0000-0000-000000000006',location,quantity,'dona',
    tstzrange((work_day+time '08:00') at time zone 'Asia/Tashkent',(work_day+time '09:00') at time zone 'Asia/Tashkent','[)'));
end $$;

do $physical_and_recurring_limits$
begin
  begin
    perform pg_temp.add_inventory_plan('too-many','2026-04-01',2);
    raise exception 'Two signs were planned against one physical sign on one day';
  exception when check_violation then
    if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if;
  end;
  begin
    perform pg_temp.add_inventory_plan('wrong-section','2026-04-01',1,'[20,21)');
    raise exception 'Inventory from another section was accepted';
  exception when check_violation then
    if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if;
  end;
  begin
    perform pg_temp.add_inventory_plan('fractional-count','2026-04-01',0.5);
    raise exception 'Fractional counted asset was accepted';
  exception when check_violation then
    if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if;
  end;
  perform pg_temp.add_inventory_plan('first','2026-04-01',1);
  begin
    perform pg_temp.add_inventory_plan('duplicate-cycle','2026-04-01',1);
    raise exception 'The same physical count was reserved twice on one day';
  exception when check_violation then
    if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if;
  end;
  perform pg_temp.add_inventory_plan('next-cycle','2026-04-02',1);
  begin
    perform pg_temp.add_inventory_plan('exceeds-month','2026-04-03',1);
    raise exception 'Separate days exceeded the approved monthly occurrences';
  exception when check_violation then
    if sqlerrm<>'ANNUAL_QUANTITY_EXCEEDED' then raise; end if;
  end;
  if (select sum(work_quantity) from roadops.plan_items where planning_run_id=pg_temp.inventory_test_id('run'))<>2 then
    raise exception 'Rejected attempts changed the retained plan total';
  end if;
end
$physical_and_recurring_limits$;

-- Completion is checked independently of the UI and rechecks inherited plan.
insert into roadops.work_orders
  (id,plan_item_id,order_number,status,issued_by,issued_at,accepted_at,started_at)
values(pg_temp.inventory_test_id('order'),pg_temp.inventory_test_id('first'),'INVENTORY-ORDER','in_progress',
  '94000000-0000-0000-0000-000000000001','2026-04-01 07:00+05','2026-04-01 07:30+05','2026-04-01 08:00+05');
do $completion_limit$
begin
  begin
    insert into roadops.work_completion_records(work_order_id,completed_quantity,work_unit,recorded_by)
    values(pg_temp.inventory_test_id('order'),10,'dona','94000000-0000-0000-0000-000000000001');
    raise exception 'Completion accepted ten cleaned signs for one planned sign';
  exception when check_violation then
    if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if;
  end;
  insert into roadops.work_completion_records(work_order_id,completed_quantity,work_unit,recorded_by)
  values(pg_temp.inventory_test_id('order'),1,'dona','94000000-0000-0000-0000-000000000001');
end
$completion_limit$;

insert into roadops.inspections
  (id,inspection_number,division_id,road_id,inspection_started_at,inspector_user_id)
values(pg_temp.inventory_test_id('inspection'),'INVENTORY-INSPECTION','91000000-0000-0000-0000-000000000001',
       '92000000-0000-0000-0000-000000000001','2026-04-01 12:00+05','94000000-0000-0000-0000-000000000001');
create function pg_temp.add_inventory_observation(label text,quantity numeric,asset uuid,location numrange default '[10,11)'::numrange)
returns void language sql as $$
  insert into roadops.inspection_observations
    (inspection_id,road_element_id,defect_type_id,chainage_span,observed_at,measured_quantity,measurement_unit,source_hash)
  select pg_temp.inventory_test_id('inspection'),asset,id,location,'2026-04-01 12:00+05',quantity,'unit',extensions.digest(label,'sha256')
  from roadops.defect_types where code='manual.unclassified.unit' and active_until is null
$$;
do $observation_limit$
begin
  begin
    perform pg_temp.add_inventory_observation('missing',1,null);
    raise exception 'Count observation without an inventory asset was accepted';
  exception when check_violation then if sqlerrm<>'INVENTORY_ASSET_REQUIRED' then raise; end if; end;
  begin
    perform pg_temp.add_inventory_observation('ten',10,'96090000-0000-0000-0000-000000000001');
    raise exception 'Ten observations were accepted for one inventory asset';
  exception when check_violation then if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if; end;
  begin
    perform pg_temp.add_inventory_observation('outside',1,'96090000-0000-0000-0000-000000000001','[20,21)');
    raise exception 'Observation accepted an asset from another section';
  exception when check_violation then if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if; end;
  perform pg_temp.add_inventory_observation('one',1,'96090000-0000-0000-0000-000000000001');
end
$observation_limit$;

-- Explicit measures from the imported YTP properties envelope scale to the
-- selected section. Missing dimensions fail closed instead of becoming zero.
insert into roadops.road_elements(id,source_system_id,external_id)
values(pg_temp.inventory_test_id('pavement'),'90000000-0000-0000-0000-000000000001','INVENTORY-PAVEMENT');
insert into roadops.road_element_versions
  (id,road_element_id,road_id,source_version,element_type,chainage_span,attributes,valid_from,payload_hash)
values(pg_temp.inventory_test_id('pavement-version'),pg_temp.inventory_test_id('pavement'),
       '92000000-0000-0000-0000-000000000001','v1','PAVEMENT','[0,100)',
       '{"properties":{"areaM2":800,"volumeM3":80}}','2026-01-01',decode(repeat('ce',32),'hex'));
do $measure_limit$
begin
  if roadops.inventory_physical_quantity(pg_temp.inventory_test_id('pavement-version'),'[0,10)','m2')<>80
    or roadops.inventory_physical_quantity(pg_temp.inventory_test_id('pavement-version'),'[0,10)','m3')<>8
    or roadops.inventory_physical_quantity(pg_temp.inventory_test_id('pavement-version'),'[0,10)','km')<>0.01
    or roadops.inventory_physical_quantity('96090000-0000-0000-0000-000000000002','[10,11)','m2') is not null then
    raise exception 'Source dimension, subsection conversion or missing-measure handling is incorrect';
  end if;
end
$measure_limit$;

-- A generated draft with any unmapped inventory remains unapprovable.
select roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2027);
do $coverage_limit$
begin
  begin
    perform roadops.approve_annual_program((select id from roadops.annual_programs where program_year=2027));
    raise exception 'Incomplete inventory coverage was approved';
  exception when check_violation then
    if sqlerrm<>'ANNUAL_INVENTORY_COVERAGE_INCOMPLETE' then raise; end if;
  end;
end
$coverage_limit$;
rollback;
