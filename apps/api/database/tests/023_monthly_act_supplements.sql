-- Actual source → independently verified work → payroll → first act → supplement.
-- Synthetic business fixtures only; no trigger bypass, no production data.
begin;
create function pg_temp.sid(text) returns uuid language sql immutable as $$
  select md5('monthly-act-supplement-test:' || $1)::uuid
$$;
create function pg_temp.actor(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('roadops.actor_id',p_user::text,true);
  perform set_config('roadops.session_id',(select id::text from roadops.auth_sessions
    where user_id=p_user order by issued_at desc limit 1),true);
end $$;
insert into roadops.app_users(id,email,password_hash,full_name,status,mfa_required,email_verified_at)
values(pg_temp.sid('author'),'supplement-author@example.test',repeat('x',60),'Supplement author','active',false,clock_timestamp());
insert into roadops.user_role_memberships(user_id,role_id,valid_from,granted_by)
select pg_temp.sid('author'),id,'2026-01-01','94000000-0000-0000-0000-000000000001'
from roadops.roles where code='system_admin';
select roadops.complete_login('94000000-0000-0000-0000-000000000001',repeat('c1',32),repeat('c2',32),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select roadops.complete_login(pg_temp.sid('author'),repeat('c3',32),repeat('c4',32),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select pg_temp.actor('94000000-0000-0000-0000-000000000001');
select set_config('roadops.request_id',pg_temp.sid('request')::text,true);
insert into roadops.road_division_assignments(source_system_id,external_id,road_id,division_id,source_version,chainage_span,valid_from,payload_hash)
values('90000000-0000-0000-0000-000000000001','SUPPLEMENT-ROAD','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','v1','[0,1000)','2026-01-01',decode(repeat('c5',32),'hex'));
insert into roadops.worker_division_assignments(source_system_id,external_id,worker_id,division_id,source_version,valid_from,payload_hash)
values('90000000-0000-0000-0000-000000000001','SUPPLEMENT-WORKER','93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','v1','2026-01-01',decode(repeat('c5',32),'hex'));
insert into roadops.worker_qualification_versions(worker_id,source_version,qualification_code,qualification_name,valid_from,payload_hash)
values('93000000-0000-0000-0000-000000000001','v1','SUPPLEMENT-LABOR','Synthetic skill','2026-01-01',decode(repeat('c5',32),'hex'));
insert into roadops.worker_availability(worker_id,work_date,available_minutes,availability_code,source_version,payload_hash)
select '93000000-0000-0000-0000-000000000001',date '2026-08-09'+i,420,'available','v1',decode(repeat('c5',32),'hex') from generate_series(1,3) i;
insert into roadops.import_batches(id,import_kind,source_filename,source_sha256,parser_version,state,completed_at)
values(pg_temp.sid('import'),'iqn_document','supplement-synthetic.docx',decode(repeat('c6',32),'hex'),'test','accepted',clock_timestamp());
insert into roadops.iqn_documents(id,import_batch_id,code,title,revision,document_kind,source_sha256,effective_from)
values(pg_temp.sid('document'),pg_temp.sid('import'),'SUPPLEMENT-TEST','Synthetic test norm','test','iqn_02',decode(repeat('c6',32),'hex'),'2026-01-01');
insert into roadops.iqn_work_items(id,document_id,source_sequence,raw_name,normalized_name,item_kind,source_location)
values(pg_temp.sid('work'),pg_temp.sid('document'),1,'Synthetic work','Synthetic work','task','{}');
insert into roadops.iqn_work_variants(id,work_item_id,variant_key,basis_quantity,basis_unit,formula_type,interpretation_status,planning_status,reviewed_at,reviewed_by,source_location)
values(pg_temp.sid('variant'),pg_temp.sid('work'),'test',1,'dona','linear','approved','automatic',clock_timestamp(),'94000000-0000-0000-0000-000000000001','{}');
insert into roadops.iqn_resources(id,document_id,resource_kind,raw_name,normalized_name,unit,source_location)
values(pg_temp.sid('resource'),pg_temp.sid('document'),'labor','Labor','Labor','minute','{}');
insert into roadops.iqn_norm_sets(id,work_variant_id,norm_set_key,status,effective_from,source_location,approved_at,approved_by)
values(pg_temp.sid('norm-set'),pg_temp.sid('variant'),'test','approved','2026-01-01','{}',clock_timestamp(),'94000000-0000-0000-0000-000000000001');
insert into roadops.iqn_norm_lines(id,norm_set_id,source_line_number,resource_id,minutes_per_basis,unit,source_location)
values(pg_temp.sid('norm-line'),pg_temp.sid('norm-set'),1,pg_temp.sid('resource'),10,'minute','{}');
insert into roadops.work_variant_skill_requirements(id,work_variant_id,qualification_code,worker_count,status,effective_from,rationale,created_by,approved_by,approved_at)
values(pg_temp.sid('skill'),pg_temp.sid('variant'),'SUPPLEMENT-LABOR',1,'approved','2026-01-01','Synthetic staffing',pg_temp.sid('author'),'94000000-0000-0000-0000-000000000001',clock_timestamp());
insert into roadops.annual_programs(id,division_id,program_year,iqn_document_id,created_by)
values(pg_temp.sid('annual'),'91000000-0000-0000-0000-000000000001',2026,pg_temp.sid('document'),pg_temp.sid('author'));
insert into roadops.annual_program_items(id,annual_program_id,road_id,work_variant_id,planned_quantity,work_unit,planned_period)
values(pg_temp.sid('annual-item'),pg_temp.sid('annual'),'92000000-0000-0000-0000-000000000001',pg_temp.sid('variant'),10,'dona','[2026-08-01,2026-09-01)');
insert into roadops.planning_runs(id,division_id,annual_program_id,planning_window,as_of,algorithm_version,input_snapshot_hash,created_by)
values(pg_temp.sid('run'),'91000000-0000-0000-0000-000000000001',pg_temp.sid('annual'),'[2026-08-01,2026-09-01)',clock_timestamp(),'test',decode(repeat('c7',32),'hex'),pg_temp.sid('author'));
insert into roadops.cost_rate_versions(id,division_id,rate_kind,worker_id,schedule_code,rate_basis,pricing_unit,rate_amount_uzs,effective_period,version_no,status,source_reference,created_by,created_at,approved_by,approved_at)
values(pg_temp.sid('rate'),'91000000-0000-0000-0000-000000000001','labor','93000000-0000-0000-0000-000000000001','TEST','monthly_salary','month',600,'[2026-08-01,2026-09-01)',1,'approved','Synthetic tariff',pg_temp.sid('author'),'2026-01-01','94000000-0000-0000-0000-000000000001',clock_timestamp());
insert into roadops.monthly_work_time_norms(id,division_id,work_month,schedule_code,working_days,norm_minutes,version_no,status,source_reference,created_by,created_at,approved_by,approved_at)
values(pg_temp.sid('time-norm'),'91000000-0000-0000-0000-000000000001','2026-08-01','TEST',1,60,1,'approved','Synthetic time norm',pg_temp.sid('author'),'2026-01-01','94000000-0000-0000-0000-000000000001',clock_timestamp());

-- Establish source work with genuine assignment, actual-time and completion guards.
create function pg_temp.make_work(n integer) returns void language plpgsql as $$
declare d date := date '2026-08-09'+n; started timestamptz := (d+time '08:00') at time zone 'Asia/Tashkent';
begin
  insert into roadops.plan_items(id,planning_run_id,annual_program_item_id,road_id,work_variant_id,chainage_span,work_quantity,work_unit,scheduled_window)
  values(pg_temp.sid('plan-'||n),pg_temp.sid('run'),pg_temp.sid('annual-item'),'92000000-0000-0000-0000-000000000001',pg_temp.sid('variant'),'[10,11)',1,'dona',tstzrange(started,started+interval '1 hour','[)'));
  insert into roadops.plan_resource_requirements(id,plan_item_id,norm_line_id,resource_kind,resource_code,required_quantity,unit,required_minutes,calculation,calculated_at)
  values(pg_temp.sid('requirement-'||n),pg_temp.sid('plan-'||n),pg_temp.sid('norm-line'),'labor','TEST',1,'minute',60,'{}',clock_timestamp());
  insert into roadops.work_assignments(plan_item_id,labor_requirement_id,skill_requirement_id,worker_id,work_date,scheduled_window,planned_minutes,assigned_by)
  values(pg_temp.sid('plan-'||n),pg_temp.sid('requirement-'||n),pg_temp.sid('skill'),'93000000-0000-0000-0000-000000000001',d,tstzrange(started,started+interval '1 hour','[)'),60,pg_temp.sid('author'));
  insert into roadops.work_orders(id,plan_item_id,order_number,status,issued_by,issued_at,accepted_at,started_at)
  values(pg_temp.sid('order-'||n),pg_temp.sid('plan-'||n),'SUPPLEMENT-ORDER-'||n,'in_progress',pg_temp.sid('author'),started-interval '1 hour',started-interval '30 minutes',started);
  insert into roadops.time_entries(id,work_order_id,worker_id,work_date,actual_minutes,started_at,ended_at,recorded_by,recorded_at)
  values(pg_temp.sid('time-'||n),pg_temp.sid('order-'||n),'93000000-0000-0000-0000-000000000001',d,60,started,started+interval '1 hour',pg_temp.sid('author'),started+interval '1 hour');
  insert into roadops.work_completion_records(id,work_order_id,completed_quantity,work_unit,recorded_by,recorded_at)
  values(pg_temp.sid('completion-'||n),pg_temp.sid('order-'||n),1,'dona',pg_temp.sid('author'),started+interval '1 hour');
  update roadops.work_orders set status='completed',completed_at=started+interval '1 hour' where id=pg_temp.sid('order-'||n);
  perform roadops.approve_time_entry(pg_temp.sid('time-'||n));
  perform roadops.verify_work_order_completion(pg_temp.sid('order-'||n));
end $$;

create function pg_temp.make_payroll(n integer, fixed_meal numeric default 10) returns void language plpgsql as $$
declare parts jsonb; allocations jsonb := '[]'; worker jsonb; total numeric := 600*n+fixed_meal; i integer; meal numeric;
begin
  for i in 1..n loop
    meal := case when i=1 then fixed_meal else 0 end;
    parts := jsonb_build_object('baseWageAmountUzs',600,'bonusAmountUzs',0,'trafficAllowanceAmountUzs',0,'travelAllowanceAmountUzs',0,'seniorityAmountUzs',0,'additionalAmountUzs',0,'mealAmountUzs',meal,'holidayAmountUzs',0,'oneTimeAmountUzs',0,'terminationAmountUzs',0,'sickLeaveAmountUzs',0,'leaveAmountUzs',0,'materialAidAmountUzs',0);
    allocations := allocations || jsonb_build_array(jsonb_build_object('timeEntryId',pg_temp.sid('time-'||i),'workOrderId',pg_temp.sid('order-'||i),'workDate',date '2026-08-09'+i,'actualMinutes',60,'rateId',pg_temp.sid('rate'),'normId',pg_temp.sid('time-norm'),'components',parts,'grossAmountUzs',600+meal,'employerSocialAmountUzs',0,'employerCostAmountUzs',600+meal));
  end loop;
  worker := parts || jsonb_build_object('baseWageAmountUzs',600*n,'mealAmountUzs',fixed_meal,'workerId','93000000-0000-0000-0000-000000000001','coefficient',1,'actualMinutes',60*n,'sourceAllocations',allocations,'grossAmountUzs',total,'employerSocialAmountUzs',0,'employerCostAmountUzs',total);
  insert into roadops.payroll_snapshots(id,division_id,work_month,policy_reference,snapshot,created_by)
  values(pg_temp.sid('payroll-'||n||'-'||fixed_meal),'91000000-0000-0000-0000-000000000001','2026-08-01','Synthetic payroll',jsonb_build_object('id',pg_temp.sid('payroll-'||n||'-'||fixed_meal),'divisionId','91000000-0000-0000-0000-000000000001','period','2026-08','policyReference','Synthetic payroll','currency','UZS','state','PREVIEW','paymentInitiated',false,'calculationVersion','payroll-source-allocation-v2','rows',jsonb_build_array(worker),'totals',jsonb_build_object('grossAmountUzs',total,'employerCostAmountUzs',total)),'94000000-0000-0000-0000-000000000001');
end $$;

create function pg_temp.add_act_item(act_no integer, source_no integer) returns void language plpgsql as $$
begin
  insert into roadops.monthly_completion_act_items(id,act_id,work_order_id,completion_record_id,iqn_norm_set_id_snapshot,iqn_labor_norm_line_ids_snapshot,iqn_basis_quantity_snapshot,iqn_basis_unit_snapshot,iqn_labor_minutes_per_basis_snapshot,iqn_labor_minutes_per_unit_snapshot,iqn_total_labor_minutes_snapshot)
  values(pg_temp.sid('item-'||act_no||'-'||source_no),pg_temp.sid('act-'||act_no),pg_temp.sid('order-'||source_no),pg_temp.sid('completion-'||source_no),pg_temp.sid('norm-set'),array[pg_temp.sid('norm-line')],1,'dona',10,10,10);
  insert into roadops.monthly_completion_act_cost_lines(act_item_id,line_kind,time_entry_id,cost_rate_version_id,monthly_work_time_norm_id)
  values(pg_temp.sid('item-'||act_no||'-'||source_no),'labor',pg_temp.sid('time-'||source_no),pg_temp.sid('rate'),pg_temp.sid('time-norm'));
end $$;

select pg_temp.make_work(1);
select pg_temp.make_payroll(1);
insert into roadops.monthly_completion_acts(id,division_id,act_number,act_month,created_by)
values(pg_temp.sid('act-1'),'91000000-0000-0000-0000-000000000001','SUPPLEMENT-ACT-1','2026-08-01','94000000-0000-0000-0000-000000000001');
select pg_temp.add_act_item(1,1);
select roadops.submit_monthly_completion_act(pg_temp.sid('act-1'));
create temp table first_act_hash as select snapshot_hash from roadops.monthly_completion_acts where id=pg_temp.sid('act-1');
-- Late same-month verification must be possible even while the first act awaits approval.
select pg_temp.make_work(2);
select pg_temp.make_payroll(2);
insert into roadops.monthly_completion_acts(id,division_id,act_number,act_month,created_by)
values(pg_temp.sid('act-2'),'91000000-0000-0000-0000-000000000001','SUPPLEMENT-ACT-2','2026-08-01','94000000-0000-0000-0000-000000000001');
select pg_temp.add_act_item(2,2);

do $guards$
begin
  begin
    insert into roadops.monthly_completion_acts(division_id,act_number,act_month,created_by)
    values('91000000-0000-0000-0000-000000000001','DUPLICATE-DRAFT','2026-08-01','94000000-0000-0000-0000-000000000001');
    raise exception 'Two drafts were allowed for one month';
  exception when unique_violation then null; end;
  begin
    perform pg_temp.add_act_item(2,1);
    raise exception 'A completed source was billed twice';
  exception when unique_violation then null; end;
  begin
    perform pg_temp.make_payroll(2,11);
    raise exception 'A frozen source allocation was changed';
  exception when check_violation then
    if sqlerrm <> 'PAYROLL_POSTED_ALLOCATION_CHANGED' then raise; end if;
  end;
  begin
    perform roadops.submit_monthly_completion_act(pg_temp.sid('act-2'));
    raise exception 'Supplement submitted before preceding act approval';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MONTHLY_ACT_PREVIOUS_SUPPLEMENT_NOT_APPROVED' then raise; end if;
  end;
  begin
    update roadops.monthly_completion_acts set supplement_no=7 where id=pg_temp.sid('act-2');
    raise exception 'Supplement identity was mutable';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'MONTHLY_ACT_IDENTITY_IMMUTABLE' then raise; end if;
  end;
end $guards$;

-- Approve frozen source 1 despite subsequently verified source 2 and newer payroll.
select pg_temp.actor(pg_temp.sid('author'));
select roadops.approve_monthly_completion_act(pg_temp.sid('act-1'));
select pg_temp.actor('94000000-0000-0000-0000-000000000001');
-- An unbilled third source cannot disappear behind the approved first act.
-- The caught failure rolls the entire temporary source and payroll back.
do $new_work_completeness$
begin
  perform pg_temp.make_work(3);
  perform pg_temp.make_payroll(3);
  delete from roadops.monthly_completion_act_cost_lines where act_item_id=pg_temp.sid('item-2-2');
  insert into roadops.monthly_completion_act_cost_lines(act_item_id,line_kind,time_entry_id,cost_rate_version_id,monthly_work_time_norm_id)
  values(pg_temp.sid('item-2-2'),'labor',pg_temp.sid('time-2'),pg_temp.sid('rate'),pg_temp.sid('time-norm'));
  perform roadops.submit_monthly_completion_act(pg_temp.sid('act-2'));
  raise exception 'Supplement omitted newly verified work';
exception when check_violation then
  if sqlerrm <> 'MONTHLY_ACT_VERIFIED_WORK_MISSING' then raise; end if;
end $new_work_completeness$;
select roadops.submit_monthly_completion_act(pg_temp.sid('act-2'));
select pg_temp.actor(pg_temp.sid('author'));
select roadops.approve_monthly_completion_act(pg_temp.sid('act-2'));
do $totals$
begin
  if (select array_agg(supplement_no order by supplement_no) from roadops.monthly_completion_acts where act_month='2026-08-01') <> array[1,2]
    or (select sum(total_amount_uzs) from roadops.monthly_completion_acts where act_month='2026-08-01') <> 1210
    or (select sum(payroll_extra_amount_uzs) from roadops.monthly_completion_act_cost_lines) <> 10
    or (select count(distinct work_order_id) from roadops.monthly_completion_act_items) <> 2 then
    raise exception 'Supplement lost or duplicated verified work or monthly fixed payroll';
  end if;
  if not exists(select 1 from roadops.monthly_completion_act_items where act_id=pg_temp.sid('act-2') and year_to_date_quantity_snapshot=2 and year_to_date_amount_uzs_snapshot=1210 and annual_planned_quantity_snapshot=10) then
    raise exception 'Supplement annual totals duplicated or lost a verified source';
  end if;
  if (select snapshot_hash from roadops.monthly_completion_acts where id=pg_temp.sid('act-1')) is distinct from (select snapshot_hash from first_act_hash)
    or roadops.monthly_completion_act_snapshot_hash(pg_temp.sid('act-1')) is distinct from (select snapshot_hash from first_act_hash) then
    raise exception 'Supplement changed first frozen act hash';
  end if;
end $totals$;
rollback;
