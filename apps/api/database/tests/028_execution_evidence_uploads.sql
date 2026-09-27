begin;
-- Exercise the actual trigger function with a small isolated completion-shaped
-- record. No production integrity trigger or role is disabled for this test.
create temporary table capture_evidence_test(work_order_id uuid,evidence jsonb);
create trigger evidence_ref_guard before insert on capture_evidence_test
for each row execute function roadops.guard_completion_evidence_refs();
insert into capture_evidence_test values('98028000-0000-4000-8000-000000000001','[]');
insert into capture_evidence_test values('98028000-0000-4000-8000-000000000001','["https://legacy.example.invalid/file.pdf"]');
do $references$
begin
  begin
    insert into capture_evidence_test values('98028000-0000-4000-8000-000000000001',
      '["/api/v1/work-orders/98028000-0000-4000-8000-000000000099/evidence/98028000-0000-4000-8000-000000000002.png"]');
    raise exception 'Another work order private evidence was accepted';
  exception when check_violation then if sqlerrm<>'EXECUTION_EVIDENCE_WRONG_ORDER' then raise; end if; end;
  begin
    insert into capture_evidence_test values('98028000-0000-4000-8000-000000000001',
      '["/api/v1/work-orders/98028000-0000-4000-8000-000000000001/evidence/98028000-0000-4000-8000-000000000002.png"]');
    raise exception 'Unregistered private file was accepted';
  exception when check_violation then if sqlerrm<>'EXECUTION_EVIDENCE_WRONG_ORDER' then raise; end if; end;
  begin
    insert into capture_evidence_test values('98028000-0000-4000-8000-000000000001',
      '["/api/v1/work-orders/98028000-0000-4000-8000-000000000001/evidence/../../secret.png"]');
    raise exception 'Arbitrary local file path was accepted';
  exception when check_violation then if sqlerrm<>'EXECUTION_EVIDENCE_WRONG_ORDER' then raise; end if; end;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='roadops' and c.relname='work_order_evidence' and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception 'Private evidence RLS is not forced';
  end if;
  if has_table_privilege('roadops_api','roadops.work_order_evidence','UPDATE')
    or has_table_privilege('roadops_api','roadops.work_order_evidence','DELETE')
    or has_function_privilege('roadops_api','roadops.guard_completion_evidence_refs()','EXECUTE') then
    raise exception 'Private evidence or its binding can be modified directly';
  end if;
end
$references$;
rollback;
