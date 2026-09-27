begin;
create table roadops.work_order_evidence (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null,
  extension text not null check (extension in ('jpg','png','pdf')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references roadops.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(work_order_id,created_by,sha256),
  check(storage_path='execution-evidence/'||id::text||'.'||extension),
  check ((extension='jpg' and content_type='image/jpeg')
    or (extension='png' and content_type='image/png')
    or (extension='pdf' and content_type='application/pdf'))
);
create index work_order_evidence_order_idx on roadops.work_order_evidence(work_order_id,created_at);
alter table roadops.work_order_evidence enable row level security;
alter table roadops.work_order_evidence force row level security;
create policy work_order_evidence_read on roadops.work_order_evidence for select to roadops_api
using(roadops.has_permission('execution.read',roadops.division_for_work_order(work_order_id))
  or roadops.has_permission('execution.manage',roadops.division_for_work_order(work_order_id)));
create policy work_order_evidence_insert on roadops.work_order_evidence for insert to roadops_api
with check(created_by=roadops.current_actor_id()
  and roadops.has_permission('execution.manage',roadops.division_for_work_order(work_order_id))
  and exists(select 1 from roadops.work_orders wo where wo.id=work_order_id
    and wo.status in ('issued','accepted','in_progress','paused')));
grant select,insert on roadops.work_order_evidence to roadops_api;
create trigger work_order_evidence_audit after insert on roadops.work_order_evidence
for each row execute function roadops.capture_row_audit('work_order_evidence');

-- Even a direct write cannot attach another order's private evidence URL.
create function roadops.guard_completion_evidence_refs()
returns trigger language plpgsql security definer set search_path='' as $function$
declare reference jsonb; link text; parts text[];
begin
  if jsonb_typeof(new.evidence)<>'array' then
    raise exception using errcode='23514',message='EXECUTION_EVIDENCE_INVALID';
  end if;
  for reference in select value from jsonb_array_elements(new.evidence) loop
    link:=reference#>>'{}';
    if jsonb_typeof(reference)='string' and link like '/%' then
      parts:=regexp_match(link,'^/api/v1/work-orders/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/evidence/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(jpg|png|pdf)$');
      if parts is null or parts[1]<>new.work_order_id::text or not exists (
        select 1 from roadops.work_order_evidence e
        where e.id=parts[2]::uuid and e.work_order_id=new.work_order_id and e.extension=parts[3]) then
        raise exception using errcode='23514',message='EXECUTION_EVIDENCE_WRONG_ORDER';
      end if;
    end if;
  end loop;
  return new;
end
$function$;
revoke all on function roadops.guard_completion_evidence_refs() from public,roadops_api,roadops_sync,roadops_reporting;
create trigger work_completion_records_evidence_refs before insert or update of work_order_id,evidence
on roadops.work_completion_records for each row execute function roadops.guard_completion_evidence_refs();
comment on table roadops.work_order_evidence is 'Private immutable work-order evidence, uploaded and checksummed by the server; authenticated scoped content route only.';
commit;
