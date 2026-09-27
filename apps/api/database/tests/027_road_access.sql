-- Synthetic source-backed closure. Dispatch, date change and cancellation keep
-- the same road, section, direction and lane in the register and YTP event.
begin;
create function pg_temp.cid(text) returns uuid language sql immutable as $$
  select md5('road-access-test:' || $1)::uuid
$$;
select roadops.complete_login('94000000-0000-0000-0000-000000000001',repeat('d1',32),repeat('d2',32),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day');
select set_config('roadops.actor_id','94000000-0000-0000-0000-000000000001',true);
select set_config('roadops.session_id',(select id::text from roadops.auth_sessions where token_hash=decode(repeat('d1',32),'hex')),true);
insert into roadops.import_batches(id,import_kind,source_filename,source_sha256,parser_version,state,completed_at)
values(pg_temp.cid('import'),'iqn_document','closure-test.docx',decode(repeat('d3',32),'hex'),'test','accepted',clock_timestamp());
insert into roadops.iqn_documents(id,import_batch_id,code,title,revision,document_kind,source_sha256,effective_from)
values(pg_temp.cid('document'),pg_temp.cid('import'),'CLOSURE-TEST','Synthetic closure norm','test','iqn_02',decode(repeat('d3',32),'hex'),'2026-01-01');
insert into roadops.iqn_work_items(id,document_id,source_sequence,raw_name,normalized_name,item_kind,source_location)
values(pg_temp.cid('work'),pg_temp.cid('document'),1,'Synthetic work','Synthetic work','task','{}');
insert into roadops.iqn_work_variants(id,work_item_id,variant_key,basis_quantity,basis_unit,formula_type,interpretation_status,planning_status,reviewed_at,reviewed_by,source_location)
values(pg_temp.cid('variant'),pg_temp.cid('work'),'test',1,'m2','linear','approved','automatic',clock_timestamp(),'94000000-0000-0000-0000-000000000001','{}');
insert into roadops.safety_schemes(id,division_id,code,name,instructions,effective_from,scheme_kind)
values(pg_temp.cid('scheme'),'91000000-0000-0000-0000-000000000001','CLOSURE-TEST','Partial closure','{}','2026-01-01','one_lane_closed');
insert into roadops.manual_work_requests(id,division_id,road_id,work_variant_id,safety_scheme_id,chainage_span,work_quantity,work_unit,requested_date,created_by,direction,lane_label)
values(pg_temp.cid('request'),'91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',pg_temp.cid('variant'),pg_temp.cid('scheme'),'[100,110)',2,'m2','2027-01-10','94000000-0000-0000-0000-000000000001',null,null);
insert into roadops.planning_runs(id,division_id,planning_window,as_of,algorithm_version,input_snapshot_hash,created_by)
values(pg_temp.cid('run'),'91000000-0000-0000-0000-000000000001','[2027-01-10,2027-01-12)',clock_timestamp(),'closure-test',decode(repeat('d4',32),'hex'),'94000000-0000-0000-0000-000000000001');
insert into roadops.plan_items(id,planning_run_id,manual_work_request_id,road_id,work_variant_id,safety_scheme_id,chainage_span,work_quantity,work_unit,scheduled_window)
values(pg_temp.cid('plan'),pg_temp.cid('run'),pg_temp.cid('request'),'92000000-0000-0000-0000-000000000001',pg_temp.cid('variant'),pg_temp.cid('scheme'),'[100,110)',2,'m2','[2027-01-10 08:00+05,2027-01-10 10:00+05)');
insert into roadops.work_orders(id,plan_item_id,order_number,issued_by)
values(pg_temp.cid('order'),pg_temp.cid('plan'),'CLOSURE-TEST','94000000-0000-0000-0000-000000000001');

do $missing_lane_blocks_dispatch$
begin
  begin
    update roadops.planning_runs set status='published',evaluated_at=clock_timestamp(),approved_at=clock_timestamp(),published_at=clock_timestamp(),approved_by=created_by,published_by=created_by where id=pg_temp.cid('run');
    raise exception 'A partial closure without its lane was published';
  exception when check_violation then
    if sqlerrm not like '%ROAD_ACCESS_DETAILS_REQUIRED%' then raise; end if;
  end;
end
$missing_lane_blocks_dispatch$;
update roadops.manual_work_requests set direction='FORWARD',lane_label='1-tasma' where id=pg_temp.cid('request');
update roadops.planning_runs set status='published',evaluated_at=clock_timestamp(),approved_at=clock_timestamp(),published_at=clock_timestamp(),approved_by=created_by,published_by=created_by where id=pg_temp.cid('run');

do $dispatch_payload$
declare body jsonb;
begin
  select payload into body from roadops.integration_outbox where aggregate_id=pg_temp.cid('plan') and event_kind='road_access.scheduled';
  if body->>'direction' <> 'FORWARD' or body->>'laneLabel' <> '1-tasma'
    or (body->>'chainageEndM')::numeric <> 110 or body->>'status' <> 'SCHEDULED'
    or (body->>'startsAt')::timestamptz <> timestamptz '2027-01-10 08:00+05' then
    raise exception 'Dispatch lost exact closure details: %',body;
  end if;
  if roadops.road_access_details(pg_temp.cid('plan'))->>'deliveryState' <> 'PENDING' then
    raise exception 'Queued YTP event was incorrectly represented as delivered';
  end if;
end
$dispatch_payload$;
update roadops.plan_items set scheduled_window='[2027-01-11 08:00+05,2027-01-11 10:00+05)' where id=pg_temp.cid('plan');
do $reschedule_payload$
declare body jsonb;
begin
  select payload into body from roadops.integration_outbox where aggregate_id=pg_temp.cid('plan') and payload->>'status'='RESCHEDULED';
  if body->>'laneLabel' <> '1-tasma' or (body->>'startsAt')::timestamptz <> timestamptz '2027-01-11 08:00+05' then
    raise exception 'Reschedule lost the lane or new day: %',body;
  end if;
end
$reschedule_payload$;
update roadops.plan_items set status='cancelled' where id=pg_temp.cid('plan');
do $cancellation_reopens$
declare body jsonb;
begin
  select payload into body from roadops.integration_outbox where aggregate_id=pg_temp.cid('plan') and payload->>'status'='CANCELLED';
  if body->>'roadAccess' <> 'OPEN' or body->>'laneLabel' <> '1-tasma' then
    raise exception 'Cancellation did not reopen the same lane: %',body;
  end if;
  if roadops.road_access_details(pg_temp.cid('plan'))->>'operationalState' <> 'CANCELLED' then
    raise exception 'Register failed to retain cancelled closure history';
  end if;
end
$cancellation_reopens$;
select set_config('roadops.actor_id','',true);
do $scope_boundary$
begin
  begin
    perform roadops.road_access_details(pg_temp.cid('plan'));
    raise exception 'Anonymous caller read closure details';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('roadops_api','roadops.road_access_payload(uuid)','EXECUTE') then
    raise exception 'API can bypass scoped closure reader';
  end if;
end
$scope_boundary$;
rollback;
