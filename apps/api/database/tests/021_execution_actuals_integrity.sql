begin;

-- Exercise the real shared duration function: the end of a reservation is
-- exclusive, late starts reduce capacity, and midnight divides daily hours.
do $test$
begin
  if roadops.execution_available_minutes('[2026-09-16 22:00+05,2026-09-17 02:00+05)',
      '2026-09-16 22:30+05','2026-09-17 01:30+05','2026-09-16') <> 90
     or roadops.execution_available_minutes('[2026-09-16 22:00+05,2026-09-17 02:00+05)',
      '2026-09-16 22:30+05','2026-09-17 01:30+05','2026-09-17') <> 90 then
    raise exception 'Overnight machine duration did not split into actual local dates';
  end if;
  if roadops.execution_available_minutes('[2026-09-16 22:00+05,2026-09-17 00:00+05)',
      '2026-09-16 22:00+05','2026-09-17 03:00+05','2026-09-17') <> 0 then
    raise exception 'Exclusive midnight end leaked time into the next day';
  end if;
  if roadops.execution_available_minutes('[2026-09-16 09:00+05,2026-09-16 16:00+05)',
      '2026-09-16 10:00+05','2026-09-16 10:20:59+05','2026-09-16') <> 20 then
    raise exception 'Late start/elapsed time did not cap actual labor minutes';
  end if;
  if roadops.execution_available_minutes('[2026-09-16 09:00+05,2026-09-16 16:00+05)',
      '2026-09-16 10:00+05','2026-09-16 17:00+05','2026-09-16') <> 360 then
    raise exception 'Completion beyond reservation changed scheduled capacity';
  end if;
end
$test$;

-- Real ledger mutations verify decimal precision, overspend rollback and
-- immutability without disabling any production trigger or security policy.
insert into roadops.materials(id,code,name,unit) values
  ('97000000-0000-4000-8000-000000000001','EXEC-STOCK-TEST','Stock integrity test','kg');
insert into roadops.stock_locations(id,division_id,code,name) values
  ('97000000-0000-4000-8000-000000000002','91000000-0000-0000-0000-000000000001','EXEC-TEST','Test stock');
insert into roadops.inventory_transactions(id,stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,recorded_by)
values ('97000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000002',
  '97000000-0000-4000-8000-000000000001','opening',0.300000,clock_timestamp(),'test',
  '94000000-0000-0000-0000-000000000001');
do $test$
begin
  begin
    insert into roadops.inventory_transactions(stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,recorded_by)
    values ('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001',
      'issue',-0.300001,clock_timestamp(),'test','94000000-0000-0000-0000-000000000001');
    raise exception 'Stock overspend unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm not like '%INSUFFICIENT_MATERIAL_STOCK%' then raise; end if;
  end;
end
$test$;
insert into roadops.inventory_transactions(stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,recorded_by)
values ('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001',
  'issue',-0.300000,clock_timestamp(),'test','94000000-0000-0000-0000-000000000001');
do $test$
begin
  if (select sum(quantity_delta) from roadops.inventory_transactions
      where stock_location_id='97000000-0000-4000-8000-000000000002') <> 0 then
    raise exception 'Exact decimal stock was not consumed once';
  end if;
  begin
    update roadops.inventory_transactions set quantity_delta=100
      where id='97000000-0000-4000-8000-000000000003';
    raise exception 'Stock history mutation unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$test$;

do $test$
declare
  definition text;
begin
  if has_table_privilege('roadops_api','roadops.execution_nonuse_records','INSERT')
     or has_table_privilege('roadops_api','roadops.execution_nonuse_records','UPDATE')
     or has_table_privilege('roadops_api','roadops.execution_nonuse_records','DELETE') then
    raise exception 'Unused resource journal must only be written through authorized workflow';
  end if;
  select pg_get_functiondef('roadops.record_unused_execution_resource(uuid,text,uuid,date,text)'::regprocedure) into definition;
  if position('execution.manage' in definition)=0 or position('RESOURCE_NOT_USED' in definition)=0
     or position('status=''released''' in definition)=0 then
    raise exception 'Unused resource release lacks authorization, stock release or audit event';
  end if;
  select pg_get_functiondef('roadops.guard_execution_actual_mutation()'::regprocedure) into definition;
  if position('for update' in definition)=0 or position('EXECUTION_ACTUALS_FROZEN' in definition)=0 then
    raise exception 'Execution actuals can race with final verification';
  end if;
  select pg_get_functiondef('roadops.validate_execution_labor_window()'::regprocedure) into definition;
  if position('pg_advisory_xact_lock' in definition)=0 or position('LABOR_DAILY_LIMIT_EXCEEDED' in definition)=0 then
    raise exception 'Concurrent worker actuals lack serialized daily guard';
  end if;
end
$test$;
-- The actual return/resubmit workflow is exercised using legitimate isolated
-- fixtures. All production foreign keys, RLS and triggers remain enabled.
do $flow$
declare
  chief uuid := '94000000-0000-0000-0000-000000000001';
  division uuid := '91000000-0000-0000-0000-000000000001';
  road uuid := '92000000-0000-0000-0000-000000000001';
  worker uuid := '93000000-0000-0000-0000-000000000001';
  foreman uuid := gen_random_uuid(); batch uuid := gen_random_uuid(); doc uuid := gen_random_uuid();
  item uuid := gen_random_uuid(); variant uuid := gen_random_uuid(); normset uuid := gen_random_uuid();
  labor_resource uuid := gen_random_uuid(); material_resource uuid := gen_random_uuid();
  labor_line uuid := gen_random_uuid(); material_line uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); program_item uuid := gen_random_uuid(); run uuid := gen_random_uuid(); plan uuid := gen_random_uuid();
  labor_requirement uuid := gen_random_uuid(); material_requirement uuid := gen_random_uuid(); skill uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid(); material uuid := gen_random_uuid(); location uuid := gen_random_uuid(); reservation uuid := gen_random_uuid();
  usage_id uuid := gen_random_uuid(); transaction_id uuid := gen_random_uuid();
  equipment_resource uuid := gen_random_uuid(); equipment_line uuid := gen_random_uuid();
  equipment_requirement uuid := gen_random_uuid(); equipment uuid := gen_random_uuid(); equipment_reservation uuid := gen_random_uuid();
  saved_revision uuid; original_hash bytea; request uuid := gen_random_uuid();
begin
  insert into roadops.app_users(id,email,password_hash,full_name,status,mfa_required,email_verified_at)
    values(foreman,'execution-foreman@test.invalid',extensions.crypt('execution-test-only',extensions.gen_salt('bf',4)),'Foreman fixture','active',false,clock_timestamp());
  insert into roadops.import_batches(id,import_kind,source_filename,source_sha256,parser_version)
    values(batch,'iqn_document','test-execution.docx',decode(repeat('ad',32),'hex'),'execution-test');
  insert into roadops.iqn_documents(id,import_batch_id,code,title,revision,document_kind,source_sha256,effective_from)
    values(doc,batch,'EXEC-TEST','Test source','1','iqn_02',decode(repeat('ad',32),'hex'),'2026-01-01');
  insert into roadops.iqn_work_items(id,document_id,source_sequence,raw_name,normalized_name,item_kind,source_location)
    values(item,doc,1,'Test','Test','task','{}');
  insert into roadops.iqn_work_variants(id,work_item_id,variant_key,formula_type,source_location)
    values(variant,item,'test','linear','{}');
  insert into roadops.iqn_norm_sets(id,work_variant_id,norm_set_key,effective_from,source_location)
    values(normset,variant,'test','2026-01-01','{}');
  insert into roadops.iqn_resources(id,document_id,resource_kind,raw_name,normalized_name,unit,source_location) values
    (labor_resource,doc,'labor','Worker','Worker','minute','{}'),(material_resource,doc,'material','Material','Material','kg','{}'),
    (equipment_resource,doc,'equipment','Mechanism','Mechanism','hour','{}');
  insert into roadops.iqn_norm_lines(id,norm_set_id,source_line_number,resource_id,quantity_per_basis,unit,source_location) values
    (labor_line,normset,1,labor_resource,1,'minute','{}'),(material_line,normset,2,material_resource,1,'kg','{}'),
    (equipment_line,normset,3,equipment_resource,1,'hour','{}');
  insert into roadops.annual_programs(id,division_id,program_year,iqn_document_id,created_by)
    values(program,division,2026,doc,chief);
  insert into roadops.annual_program_items(id,annual_program_id,road_id,work_variant_id,planned_quantity,work_unit,planned_period)
    values(program_item,program,road,variant,10,'m2','[2026-01-01,2027-01-01)');
  insert into roadops.planning_runs(id,division_id,planning_window,as_of,algorithm_version,input_snapshot_hash,created_by)
    values(run,division,'[2026-09-16,2026-09-17)','2026-09-16 08:00+05','test',decode(repeat('ad',32),'hex'),chief);
  insert into roadops.plan_items(id,planning_run_id,annual_program_item_id,road_id,work_variant_id,chainage_span,work_quantity,work_unit,scheduled_window)
    values(plan,run,program_item,road,variant,'[0,1)',10,'m2','[2026-09-16 09:00+05,2026-09-16 11:00+05)');
  insert into roadops.plan_resource_requirements(id,plan_item_id,norm_line_id,resource_kind,resource_code,required_quantity,unit,required_minutes,calculation,calculated_at) values
    (labor_requirement,plan,labor_line,'labor','worker',60,'minute',60,'{}',clock_timestamp()),
    (material_requirement,plan,material_line,'material','material',5,'kg',null,'{}',clock_timestamp()),
    (equipment_requirement,plan,equipment_line,'equipment','equipment',1,'hour',60,'{}',clock_timestamp());
  insert into roadops.work_variant_skill_requirements(id,work_variant_id,qualification_code,worker_count,status,effective_from,rationale,created_by,approved_by,approved_at)
    values(skill,variant,'execution_test',1,'approved','2026-01-01','test',foreman,chief,clock_timestamp());
  insert into roadops.worker_division_assignments(source_system_id,external_id,worker_id,division_id,source_version,valid_from,payload_hash)
    values('90000000-0000-0000-0000-000000000001','execution_test',worker,division,'1','2026-01-01',decode(repeat('ad',32),'hex'));
  insert into roadops.worker_qualification_versions(worker_id,source_version,qualification_code,qualification_name,valid_from,payload_hash)
    values(worker,'1','execution_test','Test','2026-01-01',decode(repeat('ad',32),'hex'));
  insert into roadops.worker_availability(worker_id,work_date,available_minutes,availability_code,source_version,payload_hash)
    values(worker,'2026-09-16',420,'available','execution-test',decode(repeat('ad',32),'hex'));
  insert into roadops.work_assignments(plan_item_id,labor_requirement_id,skill_requirement_id,worker_id,work_date,scheduled_window,planned_minutes,assigned_by)
    values(plan,labor_requirement,skill,worker,'2026-09-16','[2026-09-16 09:00+05,2026-09-16 11:00+05)',60,chief);
  insert into roadops.work_orders(id,plan_item_id,order_number,status,issued_by,issued_at,accepted_at,started_at)
    values(order_id,plan,'EXEC-RETURN-TEST','in_progress',chief,'2026-09-16 08:00+05','2026-09-16 09:00+05','2026-09-16 09:00+05');
  insert into roadops.materials(id,code,name,unit,iqn_resource_id) values(material,'EXEC-RETURN','Test material','kg',material_resource);
  insert into roadops.stock_locations(id,division_id,code,name) values(location,division,'EXEC-RETURN','Test warehouse');
  insert into roadops.inventory_transactions(stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,recorded_by)
    values(location,material,'opening',10,'2026-09-16 08:00+05','test',chief);
  insert into roadops.material_reservations(id,plan_item_id,material_requirement_id,stock_location_id,material_id,quantity,reserved_by)
    values(reservation,plan,material_requirement,location,material,5,chief);
  insert into roadops.inventory_transactions(id,stock_location_id,material_id,transaction_kind,quantity_delta,occurred_at,reference_type,reference_id,recorded_by)
    values(transaction_id,location,material,'issue',-3,'2026-09-16 10:00+05','work_order_material_usage',usage_id,foreman);
  insert into roadops.work_order_material_usages(id,work_order_id,material_reservation_id,inventory_transaction_id,stock_location_id,material_id,quantity,unit,used_at,recorded_by)
    values(usage_id,order_id,reservation,transaction_id,location,material,3,'kg','2026-09-16 10:00+05',foreman);
  update roadops.material_reservations set status='issued' where id=reservation;
  insert into roadops.equipment_units(id,division_id,inventory_code,name,iqn_resource_id,effective_from)
    values(equipment,division,'EXEC-RETURN-MACHINE','Test mechanism',equipment_resource,'2026-01-01');
  insert into roadops.equipment_reservations(id,plan_item_id,equipment_requirement_id,equipment_unit_id,reserved_window,allocated_quantity,unit,reserved_by)
    values(equipment_reservation,plan,equipment_requirement,equipment,'[2026-09-16 09:00+05,2026-09-16 11:00+05)',1,'hour',chief);
  begin
    insert into roadops.equipment_usage_entries(work_order_id,equipment_reservation_id,equipment_unit_id,usage_date,actual_machine_minutes,recorded_by)
      values(order_id,equipment_reservation,equipment,'2026-09-16',121,foreman);
    raise exception 'Machine actuals exceeded assigned duration';
  exception when check_violation then
    if sqlerrm not in ('EQUIPMENT_USAGE_EXCEEDS_WORK_WINDOW','Equipment usage must exactly reference an available reservation for the work order') then raise; end if;
  end;
  insert into roadops.equipment_usage_entries(work_order_id,equipment_reservation_id,equipment_unit_id,usage_date,actual_machine_minutes,recorded_by)
    values(order_id,equipment_reservation,equipment,'2026-09-16',60,foreman);
  update roadops.equipment_reservations set status='returned' where id=equipment_reservation;
  begin
    insert into roadops.time_entries(work_order_id,worker_id,work_date,actual_minutes,recorded_by)
      values(order_id,worker,'2026-09-16',121,foreman);
    raise exception 'Worker time beyond two-hour schedule accepted';
  exception when check_violation then
    if sqlerrm <> 'LABOR_USAGE_EXCEEDS_WORK_WINDOW' then raise; end if;
  end;
  insert into roadops.time_entries(work_order_id,worker_id,work_date,actual_minutes,recorded_by)
    values(order_id,worker,'2026-09-16',60,foreman);
  insert into roadops.work_completion_records(work_order_id,completed_quantity,work_unit,recorded_by)
    values(order_id,8,'m2',foreman);
  update roadops.work_orders set status='completed',completed_at=clock_timestamp() where id=order_id;
  perform roadops.complete_login(chief,repeat('c7',32),repeat('c8',32),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
  perform set_config('roadops.actor_id',chief::text,true);
  perform set_config('roadops.session_id',(select id::text from roadops.auth_sessions where token_hash=decode(repeat('c7',32),'hex')),true);
  perform set_config('roadops.request_id',request::text,true);
  perform roadops.return_work_order_completion(order_id,'Sarfni qayta tekshiring');
  select id,snapshot_hash into saved_revision,original_hash from roadops.execution_completion_revisions where work_order_id=order_id;
  if saved_revision is null
    or (select snapshot #>> '{materialUsages,0,quantity}' from roadops.execution_completion_revisions where id=saved_revision)::numeric <> 3
    or (select sum(quantity_delta) from roadops.inventory_transactions where stock_location_id=location) <> 10
    or exists(select 1 from roadops.time_entries where work_order_id=order_id)
    or (select status from roadops.work_orders where id=order_id) <> 'in_progress'
    or (select status from roadops.material_reservations where id=reservation) <> 'reserved'
    or (select status from roadops.equipment_reservations where id=equipment_reservation) <> 'checked_out'
    or (select snapshot #>> '{equipmentUsages,0,actual_machine_minutes}' from roadops.execution_completion_revisions where id=saved_revision)::integer <> 60 then
    raise exception 'Return did not preserve revision, reverse stock exactly and reopen cleanly';
  end if;
  begin
    update roadops.execution_completion_revisions set reason='Overwrite' where id=saved_revision;
    raise exception 'Prior completion revision was mutable';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform roadops.record_unused_execution_resource(order_id,'material',reservation,null,'Material talab qilinmadi');
  perform roadops.record_unused_execution_resource(order_id,'equipment',equipment_reservation,null,'Mexanizm ishlatilmadi');
  insert into roadops.time_entries(work_order_id,worker_id,work_date,actual_minutes,recorded_by)
    values(order_id,worker,'2026-09-16',30,foreman);
  insert into roadops.work_completion_records(work_order_id,completed_quantity,work_unit,recorded_by)
    values(order_id,6,'m2',foreman);
  update roadops.work_orders set status='completed',completed_at=clock_timestamp() where id=order_id;
  perform roadops.approve_time_entry((select id from roadops.time_entries where work_order_id=order_id));
  perform roadops.verify_work_order_completion(order_id);
  if (select status from roadops.work_orders where id=order_id) <> 'verified'
    or (select snapshot_hash from roadops.execution_completion_revisions where id=saved_revision) <> original_hash
    or (select sum(quantity_delta) from roadops.inventory_transactions where stock_location_id=location) <> 10 then
    raise exception 'Chief could not verify corrected foreman work or original history/stock changed';
  end if;
  begin
    perform roadops.return_work_order_completion(order_id,'Verified work cannot change');
    raise exception 'Verified work was returned';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'WORK_ORDER_NOT_COMPLETED' then raise; end if;
  end;
  begin
    insert into roadops.time_entries(work_order_id,worker_id,work_date,actual_minutes,recorded_by)
      values(order_id,worker,'2026-09-16',1,foreman);
    raise exception 'Time could be inserted after final verification';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'EXECUTION_ACTUALS_FROZEN' then raise; end if;
  end;
  set constraints all immediate;
end
$flow$;

rollback;
