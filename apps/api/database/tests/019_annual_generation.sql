-- Requires fixtures/test.sql. Uses synthetic source/catalog rows only here.
begin;

do $annual_schedule$
begin
  if (select sum(occurrences) from roadops.annual_occurrence_months(365, array[1,2,3,4,5,6,7,8,9,10,11,12])) <> 365
     or (select count(*) from roadops.annual_occurrence_months(2, array[4,10])) <> 2
     or exists (select 1 from roadops.annual_occurrence_months(2, array[4,10]) where month_number not in (4,10)) then
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
  perform roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2027);
  raise exception 'Generator invented a missing inventory-to-IQN mapping';
exception when check_violation then
  if sqlerrm <> 'ANNUAL_APPROVED_RULES_OR_INVENTORY_MISSING' then raise; end if;
end
$missing_rule$;

insert into roadops.annual_maintenance_rules
  (work_variant_id,element_type,quantity_method,inventory_unit,conversion_factor,annual_occurrences,
   allowed_months,source_reference,scheduling_note,effective_from,created_by)
values ('96090000-0000-0000-0000-000000000006','TEST-SIGN','count','dona',1,2,
        array[4,10],'Synthetic test recurrence: twice annually','April and October test schedule',
        '2026-01-01','94000000-0000-0000-0000-000000000001');
select roadops.approve_annual_maintenance_rule(id) from roadops.annual_maintenance_rules where element_type='TEST-SIGN';

do $annual_generation$
declare result jsonb; repeated jsonb; generated_id uuid;
begin
  result := roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2027);
  generated_id := (result->>'programId')::uuid;
  if result->>'state' <> 'DRAFT' or (result->>'lineCount')::int <> 2
     or (result#>>'{coverage,mappedElements}')::int <> 1 then
    raise exception 'Annual generator did not produce two source-backed monthly rows';
  end if;
  if (select sum(planned_quantity) from roadops.annual_program_items where annual_program_id=generated_id) <> 2
     or exists (select 1 from roadops.annual_program_items where annual_program_id=generated_id
                and extract(month from lower(planned_period)) not in (4,10)) then
    raise exception 'Annual quantity or monthly distribution is wrong';
  end if;
  if (select count(distinct basis.group_key)
      from roadops.annual_program_items item
      cross join lateral roadops.annual_completion_basis(item.id) basis
      where item.annual_program_id=generated_id) <> 1
     or exists (
       select 1 from roadops.annual_program_items item
       cross join lateral roadops.annual_completion_basis(item.id) basis
       where item.annual_program_id=generated_id and basis.annual_quantity <> 2
     ) then
    raise exception 'Monthly act annual denominator or YTD key lost a recurrence slice';
  end if;
  repeated := roadops.generate_annual_program('91000000-0000-0000-0000-000000000001',2027);
  if repeated->>'programId' <> result->>'programId' or repeated->>'reused' <> 'false'
     or (select count(*) from roadops.annual_program_items where annual_program_id=generated_id) <> 2 then
    raise exception 'Regeneration duplicated annual quantities';
  end if;
  perform roadops.approve_annual_program(generated_id);
  if not exists (select 1 from roadops.annual_programs where id=generated_id and status='approved'
                  and approved_by=roadops.current_actor_id()) then
    raise exception 'Annual approval did not persist authenticated actor';
  end if;
end
$annual_generation$;
reset role;
rollback;
