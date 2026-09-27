-- Requires fixtures/test.sql. Verifies scoped guide writes, immutable metadata,
-- read access for field workers and denial of access across divisions.
begin;
set local role roadops_sync;
insert into roadops.road_divisions (id, source_system_id, external_id)
values ('96280000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','GUIDE-OTHER-DIV');
insert into roadops.import_batches (id,import_kind,source_filename,source_sha256,parser_version,state,completed_at)
values ('96280000-0000-0000-0000-000000000002','iqn_document','guide-synthetic.docx',decode(repeat('c8',32),'hex'),'guide-test','accepted',clock_timestamp());
insert into roadops.iqn_documents (id,import_batch_id,code,title,revision,document_kind,source_sha256,effective_from)
values ('96280000-0000-0000-0000-000000000003','96280000-0000-0000-0000-000000000002','GUIDE-TEST','Synthetic guide work','test','iqn_02',decode(repeat('c8',32),'hex'),'2026-01-01');
insert into roadops.iqn_work_items (id,document_id,source_sequence,raw_name,normalized_name,item_kind,source_location)
values ('96280000-0000-0000-0000-000000000004','96280000-0000-0000-0000-000000000003',1,'Synthetic work','Synthetic work','task','{}');
insert into roadops.iqn_work_variants (id,work_item_id,variant_key,formula_type,source_location)
values ('96280000-0000-0000-0000-000000000005','96280000-0000-0000-0000-000000000004','guide','manual_resolution_required','{}');
reset role;
insert into roadops.app_users (id,email,password_hash,full_name,status,mfa_required)
values
 ('96280000-0000-0000-0000-000000000006','guide-planner@test.invalid',repeat('x',30),'Guide Planner','active',false),
 ('96280000-0000-0000-0000-000000000007','guide-worker@test.invalid',repeat('x',30),'Guide Worker','active',false),
 ('96280000-0000-0000-0000-000000000008','guide-outsider@test.invalid',repeat('x',30),'Guide Outsider','active',false);
insert into roadops.user_role_memberships (user_id,role_id,division_id,valid_from)
select u.id,r.id,case when u.email='guide-outsider@test.invalid' then '96280000-0000-0000-0000-000000000001'::uuid
 else '91000000-0000-0000-0000-000000000001'::uuid end,'2026-01-01'
from roadops.app_users u join roadops.roles r on r.code=case when u.email='guide-planner@test.invalid' then 'planner' else 'worker' end
where u.id in ('96280000-0000-0000-0000-000000000006','96280000-0000-0000-0000-000000000007','96280000-0000-0000-0000-000000000008');
set local role roadops_api;
select set_config('roadops.actor_id','96280000-0000-0000-0000-000000000006',true);
insert into roadops.work_guides
  (id,division_id,work_variant_id,title,kind,source_type,external_url,request_key,request_hash)
values ('96280000-0000-0000-0000-000000000009','91000000-0000-0000-0000-000000000001',
  '96280000-0000-0000-0000-000000000005','Ish tartibi','DOCUMENT','LINK','https://example.com/guide.pdf','guide-first-001',repeat('c',64));
do $metadata_guard$
begin
  if has_table_privilege('roadops_api','roadops.work_guides','DELETE')
    or has_column_privilege('roadops_api','roadops.work_guides','storage_path','UPDATE') then
    raise exception 'API can delete or rewrite guide history';
  end if;
  begin
    insert into roadops.work_guides (division_id,work_variant_id,title,kind,source_type,external_url,request_key,request_hash)
    values ('96280000-0000-0000-0000-000000000001','96280000-0000-0000-0000-000000000005',
      'Forbidden','DOCUMENT','LINK','https://example.com/guide.pdf','guide-foreign-001',repeat('c',64));
    raise exception 'Planner wrote into another division';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into roadops.work_guides (division_id,work_variant_id,title,kind,source_type,request_key,request_hash)
    values ('91000000-0000-0000-0000-000000000001','96280000-0000-0000-0000-000000000005',
      'Empty file','DOCUMENT','FILE','guide-no-bytes-001',repeat('c',64));
    raise exception 'File with no storage metadata was accepted';
  exception when check_violation then null;
  end;
end
$metadata_guard$;
select set_config('roadops.actor_id','96280000-0000-0000-0000-000000000007',true);
do $worker_access$
begin
  if (select count(*) from roadops.work_guides) <> 1 then
    raise exception 'Assigned worker cannot read work instructions';
  end if;
  begin
    insert into roadops.work_guides (division_id,work_variant_id,title,kind,source_type,external_url,request_key,request_hash)
    values ('91000000-0000-0000-0000-000000000001','96280000-0000-0000-0000-000000000005',
      'Forbidden','DOCUMENT','LINK','https://example.com/guide.pdf','guide-worker-001',repeat('c',64));
    raise exception 'Worker was able to change work instructions';
  exception when insufficient_privilege then null;
  end;
  update roadops.work_guides set deleted_at=clock_timestamp(),deleted_by=roadops.current_actor_id();
  if found then raise exception 'Worker archived work instructions'; end if;
end
$worker_access$;
select set_config('roadops.actor_id','96280000-0000-0000-0000-000000000008',true);
do $other_division$
begin
  if exists (select 1 from roadops.work_guides) then raise exception 'Other division can read private guide metadata'; end if;
end
$other_division$;
select set_config('roadops.actor_id','96280000-0000-0000-0000-000000000006',true);
update roadops.work_guides set deleted_at=clock_timestamp(),deleted_by=roadops.current_actor_id()
where id='96280000-0000-0000-0000-000000000009';
do $archive_guard$
begin
  if exists (select 1 from roadops.work_guides where deleted_at is null) then raise exception 'Archived guide remains active'; end if;
  begin
    update roadops.work_guides set deleted_at=null,deleted_by=null where id='96280000-0000-0000-0000-000000000009';
    raise exception 'Archived guide could be silently restored';
  exception when insufficient_privilege then null;
  end;
end
$archive_guard$;
reset role;
do $audit_history$
begin
  if (select count(*) from roadops.audit_events where entity_type='work_guides' and entity_id='96280000-0000-0000-0000-000000000009') <> 2 then
    raise exception 'Guide upload/archive audit events are missing';
  end if;
end
$audit_history$;
rollback;
