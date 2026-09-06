begin;

-- Source transcription, not a substitute for the authenticated IQN publication
-- process. Issuance below requires the matching, published IQN 03 document.
create table roadops.worker_equipment_norms (
  code text primary key,
  name text not null,
  service_months smallint not null check (service_months > 0),
  source_reference text not null,
  source_sha256 bytea not null check (octet_length(source_sha256) = 32),
  allocation_scope text not null check (allocation_scope in ('employee', 'department_pool')),
  department_quantity integer check (department_quantity > 0),
  eligible_occupation_codes text[] not null check (cardinality(eligible_occupation_codes) > 0),
  check ((allocation_scope = 'department_pool') = (department_quantity is not null))
);

insert into roadops.worker_equipment_norms
  (code, name, service_months, source_reference, source_sha256,
   allocation_scope, department_quantity, eligible_occupation_codes)
values
  ('iqn03-t3-r1', 'Maxsus kostyum-shim', 12, 'IQN 03-24, 8-bo‘lim, 3-jadval, 1-qator, 16-bet',
   decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
   'employee', null, array['mashinist','haydovchi','yol_ishchisi','yol_ustasi','energetik','mexanik','hht_muhandisi']),
  ('iqn03-t3-r2', 'Qo‘lqop', 1, 'IQN 03-24, 8-bo‘lim, 3-jadval, 2-qator, 16-bet',
   decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
   'employee', null, array['mashinist','haydovchi','yol_ishchisi','yol_ustasi','energetik','mexanik','ytb_boshligi']),
  ('iqn03-t3-r3', 'Maxsus poyabzal', 12, 'IQN 03-24, 8-bo‘lim, 3-jadval, 3-qator, 16-bet',
   decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
   'employee', null, array['mashinist','haydovchi','yol_ishchisi','yol_ustasi','energetik','mexanik','ytb_boshligi']),
  ('iqn03-t3-r4', 'Ogohlantiruvchi nimcha', 6, 'IQN 03-24, 8-bo‘lim, 3-jadval, 4-qator, 16-bet',
   decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
   'employee', null, array['mashinist','haydovchi','yol_ishchisi','yol_ustasi','energetik','mexanik','hht_muhandisi','ytb_boshligi']),
  ('iqn03-t3-r18', 'Ketmon', 24, 'IQN 03-24, 8-bo‘lim, 3-jadval, 18-qator, 16-bet; * izoh, 17-bet: bo‘limga o‘rtacha 4 dona',
   decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
   'department_pool', 4, array['yol_ishchisi']);

-- Identifiers are application mappings to cited source rows, not official IQN codes.
alter table roadops.materials add column worker_equipment_norm_code text
  references roadops.worker_equipment_norms(code) on delete restrict;
create index materials_worker_equipment_norm_idx
  on roadops.materials(worker_equipment_norm_code) where worker_equipment_norm_code is not null;
insert into roadops.materials (code, name, unit, worker_equipment_norm_code)
select 'PPE-' || upper(code), name,
       case when code in ('iqn03-t3-r2','iqn03-t3-r3') then 'juft' else 'dona' end, code
from roadops.worker_equipment_norms;

create table roadops.worker_equipment_issues (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  material_id uuid not null references roadops.materials(id) on delete restrict,
  stock_location_id uuid not null references roadops.stock_locations(id) on delete restrict,
  norm_code text not null references roadops.worker_equipment_norms(code) on delete restrict,
  iqn_document_id uuid not null references roadops.iqn_documents(id) on delete restrict,
  occupation_code text not null,
  quantity integer not null check (quantity > 0),
  issued_on date not null,
  service_months smallint not null check (service_months > 0),
  expires_on date generated always as ((issued_on + make_interval(months => service_months::integer))::date) stored,
  source_reference text not null,
  allocation_scope text not null check (allocation_scope in ('employee','department_pool')),
  issued_by uuid not null references roadops.app_users(id) on delete restrict,
  note text,
  request_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index worker_equipment_issues_worker_idx
  on roadops.worker_equipment_issues(worker_id, issued_on desc, id);
create index worker_equipment_issues_division_expiry_idx
  on roadops.worker_equipment_issues(division_id, expires_on);
create index worker_equipment_issues_material_idx on roadops.worker_equipment_issues(material_id);
create index worker_equipment_issues_stock_idx on roadops.worker_equipment_issues(stock_location_id);
create index worker_equipment_issues_norm_idx on roadops.worker_equipment_issues(norm_code);
create index worker_equipment_issues_document_idx on roadops.worker_equipment_issues(iqn_document_id);
create index worker_equipment_issues_actor_idx on roadops.worker_equipment_issues(issued_by);

create trigger worker_equipment_issues_immutable before update or delete
on roadops.worker_equipment_issues for each row execute function roadops.forbid_mutation();
create trigger worker_equipment_issues_no_truncate before truncate
on roadops.worker_equipment_issues execute function roadops.forbid_mutation();
create trigger worker_equipment_issues_audit after insert
on roadops.worker_equipment_issues for each row execute function roadops.capture_row_audit('worker_equipment_issues');
create trigger worker_equipment_norms_immutable before update or delete
on roadops.worker_equipment_norms for each row execute function roadops.forbid_mutation();
create trigger worker_equipment_norms_no_truncate before truncate
on roadops.worker_equipment_norms execute function roadops.forbid_mutation();

-- Inventory changes and reservations share a lock, so an employee issue cannot
-- race another issue or consume material already promised to a work order.
create function roadops.lock_inventory_pair()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare old_key text; new_key text;
begin
  if tg_op <> 'INSERT' then
    old_key := old.stock_location_id::text || ':' || old.material_id::text;
  end if;
  if tg_op <> 'DELETE' then
    new_key := new.stock_location_id::text || ':' || new.material_id::text;
  end if;
  if old_key is not null and new_key is not null and old_key > new_key then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new_key, 32024));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old_key, 32024));
  else
    if old_key is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old_key, 32024));
    end if;
    if new_key is not null and new_key is distinct from old_key then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new_key, 32024));
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;
create trigger inventory_transactions_pair_lock before insert
on roadops.inventory_transactions for each row execute function roadops.lock_inventory_pair();
create trigger material_reservations_pair_lock before insert or update or delete
on roadops.material_reservations for each row execute function roadops.lock_inventory_pair();

create function roadops.check_stock_after_inventory_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  perform roadops.check_material_reservation(new.stock_location_id, new.material_id);
  return new;
end
$function$;
create constraint trigger inventory_transactions_available_stock
after insert on roadops.inventory_transactions deferrable initially deferred
for each row execute function roadops.check_stock_after_inventory_change();

create function roadops.worker_equipment_published_document(p_norm_code text, p_on_date date)
returns uuid language sql stable security definer set search_path = '' as $function$
  select d.id
  from roadops.worker_equipment_norms n
  join roadops.iqn_documents d on d.document_kind = 'iqn_03' and d.source_sha256 = n.source_sha256
  join roadops.import_batches b on b.id = d.import_batch_id and b.state = 'accepted'
  join roadops.iqn_import_reviews review on review.published_document_id = d.id
    and review.import_batch_id = b.id and review.review_state = 'published'
    and review.approved_source_sha256 = n.source_sha256
    and review.publication_channel = 'roadops:iqn-publish'
  where n.code = p_norm_code and d.effective_from <= p_on_date
    and (d.effective_until is null or d.effective_until > p_on_date)
  order by d.effective_from desc limit 1
$function$;

-- Eligibility uses the authoritative, effective-dated job title. The caller
-- cannot change a worker's profession when requesting an item. Unrecognized
-- titles remain unclassified rather than being guessed from a fuzzy match.
create function roadops.worker_equipment_occupation(p_worker_id uuid, p_on_date date)
returns text language sql stable security definer set search_path = '' as $function$
  with worker_title as (
    select regexp_replace(lower(coalesce(nullif(btrim(assignment.job_title), ''), profile.position_name, '')),
                          '[^[:alpha:]]', '', 'g') value
    from roadops.worker_division_assignments assignment
    join roadops.worker_versions profile on profile.worker_id = assignment.worker_id
      and profile.valid_from <= (p_on_date::timestamp at time zone 'Asia/Tashkent')
      and (profile.valid_until is null or profile.valid_until > (p_on_date::timestamp at time zone 'Asia/Tashkent'))
    where assignment.worker_id = p_worker_id and assignment.valid_from <= p_on_date
      and (assignment.valid_until is null or assignment.valid_until > p_on_date)
  )
  select case
    when value in ('mashinist','машинист') then 'mashinist'
    when value in ('haydovchi','ҳайдовчи','driver') then 'haydovchi'
    when value in ('yolishchisi','йўлишчиси','roadworker') then 'yol_ishchisi'
    when value in ('yolustasi','йўлустаси','roadforeman') then 'yol_ustasi'
    when value in ('energetik','энергетик') then 'energetik'
    when value in ('mexanik','механик','mechanic') then 'mexanik'
    when value in ('hhtmuhandisi','ҳҳтмуҳандиси','harakatxavfsizligimuhandisi','ҳаракатхавфсизлигимуҳандиси') then 'hht_muhandisi'
    when value in ('ytbboshligi','йтббошлиғи','yolbolimiboshligi','йўлбўлимибошлиғи') then 'ytb_boshligi'
    else null end
  from worker_title limit 1
$function$;

create function roadops.issue_worker_equipment(
  p_worker_id uuid, p_stock_location_id uuid, p_material_id uuid,
  p_issued_on date, p_quantity integer, p_occupation_code text, p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  issue_id uuid := gen_random_uuid();
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  material_row roadops.materials%rowtype;
  norm_row roadops.worker_equipment_norms%rowtype;
  document_id uuid;
  actual_occupation text;
  available numeric;
begin
  if p_issued_on is null or p_issued_on > (statement_timestamp() at time zone 'Asia/Tashkent')::date
     or p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception using errcode = '23514', message = 'EQUIPMENT_ISSUE_INPUT_INVALID';
  end if;
  select s.division_id into division_id
  from roadops.stock_locations s where s.id = p_stock_location_id and s.active;
  if division_id is null or actor_id is null
     or not roadops.has_permission('resources.manage', division_id) then
    raise exception using errcode = '42501', message = 'EQUIPMENT_ISSUE_FORBIDDEN';
  end if;
  if roadops.division_for_worker_assignment(p_worker_id, p_issued_on) is distinct from division_id
     or roadops.division_for_worker_assignment(p_worker_id, (statement_timestamp() at time zone 'Asia/Tashkent')::date)
        is distinct from division_id
     or not exists (
       select 1 from roadops.workers w
       join roadops.worker_versions v on v.worker_id = w.id
       where w.id = p_worker_id and w.retired_at is null
         and v.valid_until is null and v.employment_state = 'active'
     ) then
    raise exception using errcode = '23514', message = 'EQUIPMENT_WORKER_UNAVAILABLE';
  end if;
  select * into material_row from roadops.materials where id = p_material_id and active;
  select * into norm_row from roadops.worker_equipment_norms where code = material_row.worker_equipment_norm_code;
  if norm_row.code is null then
    raise exception using errcode = '23514', message = 'EQUIPMENT_NORM_MISSING';
  end if;
  actual_occupation := roadops.worker_equipment_occupation(p_worker_id, p_issued_on);
  if actual_occupation is null then
    raise exception using errcode = '23514', message = 'EQUIPMENT_WORKER_OCCUPATION_UNCLASSIFIED';
  end if;
  if p_occupation_code is distinct from actual_occupation then
    raise exception using errcode = '23514', message = 'EQUIPMENT_OCCUPATION_MISMATCH';
  end if;
  if not (actual_occupation = any(norm_row.eligible_occupation_codes)) then
    raise exception using errcode = '23514', message = 'EQUIPMENT_OCCUPATION_NOT_ELIGIBLE';
  end if;
  document_id := roadops.worker_equipment_published_document(norm_row.code, p_issued_on);
  if document_id is null then
    raise exception using errcode = '23514', message = 'EQUIPMENT_IQN03_PUBLICATION_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_stock_location_id::text || ':' || p_material_id::text, 32024));
  select coalesce((select sum(t.quantity_delta) from roadops.inventory_transactions t
                  where t.stock_location_id = p_stock_location_id and t.material_id = p_material_id), 0)
       - coalesce((select sum(r.quantity) from roadops.material_reservations r
                   where r.stock_location_id = p_stock_location_id and r.material_id = p_material_id
                     and r.status = 'reserved'), 0) into available;
  if available < p_quantity then
    raise exception using errcode = '23514', message = 'EQUIPMENT_STOCK_INSUFFICIENT';
  end if;
  insert into roadops.worker_equipment_issues
    (id, division_id, worker_id, material_id, stock_location_id, norm_code,
     iqn_document_id, occupation_code, quantity, issued_on, service_months,
     source_reference, allocation_scope, issued_by, note, request_id)
  values
    (issue_id, division_id, p_worker_id, p_material_id, p_stock_location_id, norm_row.code,
     document_id, p_occupation_code, p_quantity, p_issued_on, norm_row.service_months,
     norm_row.source_reference, norm_row.allocation_scope, actor_id, p_note, roadops.current_request_id());
  insert into roadops.inventory_transactions
    (stock_location_id, material_id, transaction_kind, quantity_delta, occurred_at,
     reference_type, reference_id, note, recorded_by, request_id)
  values
    (p_stock_location_id, p_material_id, 'issue', -p_quantity,
     p_issued_on::timestamp at time zone 'Asia/Tashkent', 'worker_equipment_issue', issue_id,
     p_note, actor_id, roadops.current_request_id());
  return issue_id;
end
$function$;

alter table roadops.worker_equipment_norms enable row level security;
alter table roadops.worker_equipment_norms force row level security;
alter table roadops.worker_equipment_issues enable row level security;
alter table roadops.worker_equipment_issues force row level security;
create policy worker_equipment_norms_read on roadops.worker_equipment_norms
for select to roadops_api using (roadops.has_any_permission('resources.read'));
create policy worker_equipment_issues_read on roadops.worker_equipment_issues
for select to roadops_api using (
  roadops.has_permission('resources.read', division_id)
  and roadops.can_access_division(roadops.division_for_worker_assignment(worker_id,
      (statement_timestamp() at time zone 'Asia/Tashkent')::date))
);
grant select on roadops.worker_equipment_norms, roadops.worker_equipment_issues to roadops_api;
revoke all on function roadops.lock_inventory_pair(),
  roadops.check_stock_after_inventory_change(),
  roadops.worker_equipment_published_document(text, date),
  roadops.worker_equipment_occupation(uuid, date),
  roadops.issue_worker_equipment(uuid, uuid, uuid, date, integer, text, text) from public;
grant execute on function roadops.issue_worker_equipment(uuid, uuid, uuid, date, integer, text, text) to roadops_api;
grant execute on function roadops.worker_equipment_published_document(text, date) to roadops_api;
grant execute on function roadops.worker_equipment_occupation(uuid, date) to roadops_api;

commit;
