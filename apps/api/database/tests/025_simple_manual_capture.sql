-- Requires fixtures/test.sql. No IQN norm is invented by capture.
begin;
set local role roadops_sync;
insert into roadops.road_division_assignments
  (source_system_id,external_id,road_id,division_id,source_version,chainage_span,valid_from,payload_hash)
values ('90000000-0000-0000-0000-000000000001','SIMPLE-CAPTURE-ZONE',
  '92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'v1','[0,1000)','2026-01-01',decode(repeat('c1',32),'hex'));
insert into roadops.road_elements(id,source_system_id,external_id) values
  ('97028000-0000-4000-8000-000000000001','90000000-0000-0000-0000-000000000001','CAPTURE-SIGN-A'),
  ('97028000-0000-4000-8000-000000000002','90000000-0000-0000-0000-000000000001','CAPTURE-SIGN-B'),
  ('97028000-0000-4000-8000-000000000003','90000000-0000-0000-0000-000000000001','CAPTURE-SIGN-C');
insert into roadops.road_element_versions
  (road_element_id,road_id,source_version,element_type,chainage_point_m,valid_from,payload_hash)
values
  ('97028000-0000-4000-8000-000000000001','92000000-0000-0000-0000-000000000001','v1','road_sign',100,'2026-01-01',decode(repeat('c2',32),'hex')),
  ('97028000-0000-4000-8000-000000000002','92000000-0000-0000-0000-000000000001','v1','road_sign',300,'2026-01-01',decode(repeat('c3',32),'hex')),
  ('97028000-0000-4000-8000-000000000003','92000000-0000-0000-0000-000000000001','v1','road_sign',300,'2026-01-01',decode(repeat('c4',32),'hex'));
reset role;
insert into roadops.app_users(id,email,password_hash,full_name,status,mfa_required,email_verified_at)
values ('97028000-0000-4000-8000-000000000010','capture-foreman@test.invalid',
  extensions.crypt('test-only-password',extensions.gen_salt('bf',4)),'Capture foreman','active',false,clock_timestamp());
insert into roadops.inspections
  (id,inspection_number,division_id,road_id,inspection_started_at,inspector_user_id,source_reference)
values ('97028000-0000-4000-8000-000000000020','SIMPLE-CAPTURE',
  '91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',
  '2026-04-01 12:00+05','97028000-0000-4000-8000-000000000010','manual-web-v2');
create function pg_temp.capture_observation(p_id uuid,p_start numeric,p_quantity numeric)
returns void language sql as $$
  insert into roadops.inspection_observations
    (id,inspection_id,defect_type_id,chainage_span,observed_at,measured_quantity,measurement_unit,source_hash)
  select p_id,'97028000-0000-4000-8000-000000000020',id,numrange(p_start,p_start+1,'[)'),
    '2026-04-01 12:00+05',p_quantity,'unit',extensions.digest(p_id::text,'sha256')
  from roadops.defect_types where code='field.sign.damaged' and active_until is null
$$;
select pg_temp.capture_observation('97028000-0000-4000-8000-000000000021',100,1);
select pg_temp.capture_observation('97028000-0000-4000-8000-000000000022',200,1);
select pg_temp.capture_observation('97028000-0000-4000-8000-000000000023',300,1);
do $capture$
begin
  if (select road_element_id from roadops.inspection_observations where id='97028000-0000-4000-8000-000000000021')
    is distinct from '97028000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Unique compatible asset was not matched automatically';
  end if;
  if exists(select 1 from roadops.inspection_observations
    where id in ('97028000-0000-4000-8000-000000000022','97028000-0000-4000-8000-000000000023')
      and (road_element_id is not null or inventory_resolution<>'REVIEW_REQUIRED')) then
    raise exception 'Unknown/ambiguous inventory was silently chosen';
  end if;
  begin
    perform pg_temp.capture_observation('97028000-0000-4000-8000-000000000024',100,10);
    raise exception 'Ten signs accepted where only one exists';
  exception when check_violation then if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if; end;
  begin
    perform pg_temp.capture_observation('97028000-0000-4000-8000-000000000025',100,0.5);
    raise exception 'Fractional sign accepted';
  exception when check_violation then if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if; end;
end
$capture$;
update roadops.inspections set status='submitted',submitted_at=clock_timestamp()
where id='97028000-0000-4000-8000-000000000020';
select roadops.complete_login('94000000-0000-0000-0000-000000000001',repeat('c5',32),repeat('c6',32),
  clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select set_config('roadops.actor_id','94000000-0000-0000-0000-000000000001',true);
select set_config('roadops.session_id',(select id::text from roadops.auth_sessions where token_hash=decode(repeat('c5',32),'hex')),true);
select set_config('roadops.request_id','97028000-0000-4000-8000-000000000030',true);
set local role roadops_api;
do $review$
begin
  begin
    perform roadops.review_inspection_observation('97028000-0000-4000-8000-000000000022','approved',null);
    raise exception 'Unresolved observation entered planning as an approved defect';
  exception when check_violation then if sqlerrm<>'INVENTORY_REVIEW_REQUIRED' then raise; end if; end;
  begin
    perform roadops.resolve_inspection_inventory('97028000-0000-4000-8000-000000000023',
      '97028000-0000-4000-8000-000000000001');
    raise exception 'Reviewer selected an asset from a different section';
  exception when check_violation then if sqlerrm<>'INVENTORY_QUANTITY_EXCEEDED' then raise; end if; end;
  perform roadops.resolve_inspection_inventory('97028000-0000-4000-8000-000000000023',
    '97028000-0000-4000-8000-000000000002');
  perform roadops.review_inspection_observation('97028000-0000-4000-8000-000000000023','approved','Joylashuv tekshirildi');
  if not exists(select 1 from roadops.defect_cases
    where inspection_observation_id='97028000-0000-4000-8000-000000000023'
      and road_element_id='97028000-0000-4000-8000-000000000002') then
    raise exception 'Reviewed source lost the resolved physical asset';
  end if;
  if has_function_privilege('roadops_api','roadops.inspection_element_type_matches(text,text)','EXECUTE') then
    raise exception 'Private inventory helper was exposed';
  end if;
end
$review$;
reset role;
rollback;
