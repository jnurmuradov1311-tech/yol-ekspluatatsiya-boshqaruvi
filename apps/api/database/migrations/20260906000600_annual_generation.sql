begin;

-- One-time expert mappings connect inventory measures to the approved IQN
-- recurrence row. No default frequencies or element/work matches are invented.
create table roadops.annual_maintenance_rules (
  id uuid primary key default gen_random_uuid(),
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  element_type text not null check (btrim(element_type) <> ''),
  quantity_method text not null check (quantity_method in ('count', 'length_m', 'attribute')),
  quantity_attribute text,
  inventory_unit text not null check (btrim(inventory_unit) <> ''),
  conversion_factor numeric(20,6) not null check (conversion_factor > 0),
  annual_occurrences integer not null check (annual_occurrences between 1 and 366),
  allowed_months integer[] not null,
  source_reference text not null check (btrim(source_reference) <> ''),
  scheduling_note text not null check (btrim(scheduling_note) <> ''),
  effective_from date not null,
  effective_until date,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  check ((quantity_method = 'attribute') = (quantity_attribute is not null)),
  check (quantity_attribute is null or quantity_attribute ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  check (effective_until is null or effective_until > effective_from),
  check (cardinality(allowed_months) between 1 and 12
         and allowed_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]
         and array_position(allowed_months, null) is null),
  check ((status = 'draft' and approved_by is null and approved_at is null)
      or (status = 'approved' and approved_by is not null and approved_at is not null)),
  exclude using gist (
    work_variant_id with =, element_type with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);
create index annual_maintenance_rules_variant_idx on roadops.annual_maintenance_rules(work_variant_id);
create index annual_maintenance_rules_created_by_idx on roadops.annual_maintenance_rules(created_by);
create index annual_maintenance_rules_approved_by_idx on roadops.annual_maintenance_rules(approved_by);
alter table roadops.annual_maintenance_rules enable row level security;
alter table roadops.annual_maintenance_rules force row level security;
create policy annual_maintenance_rules_read on roadops.annual_maintenance_rules for select to roadops_api
using (roadops.has_any_permission('planning.read') or roadops.has_permission('catalog.manage', null));
create policy annual_maintenance_rules_insert on roadops.annual_maintenance_rules for insert to roadops_api
with check (roadops.has_permission('catalog.manage', null) and created_by = roadops.current_actor_id()
            and status = 'draft' and approved_by is null and approved_at is null);
grant select on roadops.annual_maintenance_rules to roadops_api;
grant insert (work_variant_id, element_type, quantity_method, quantity_attribute, inventory_unit,
              conversion_factor, annual_occurrences, allowed_months, source_reference, scheduling_note,
              effective_from, effective_until, created_by)
on roadops.annual_maintenance_rules to roadops_api;
create trigger annual_maintenance_rules_audit after insert or update or delete
on roadops.annual_maintenance_rules for each row execute function roadops.capture_row_audit('annual_maintenance_rules');

alter table roadops.annual_programs
  add column generation_method text,
  add column generation_snapshot jsonb;
alter table roadops.annual_program_items add column generation_sources jsonb;

create function roadops.approve_annual_maintenance_rule(p_rule_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare rule_row roadops.annual_maintenance_rules%rowtype;
begin
  if roadops.current_actor_id() is null or not roadops.has_permission('catalog.manage', null) then
    raise exception using errcode = '42501', message = 'ANNUAL_RULE_APPROVAL_FORBIDDEN';
  end if;
  select * into rule_row from roadops.annual_maintenance_rules where id = p_rule_id for update;
  if rule_row.id is null or rule_row.status <> 'draft' then
    raise exception using errcode = '23514', message = 'ANNUAL_RULE_NOT_DRAFT';
  end if;
  if not exists (
    select 1 from roadops.iqn_work_variants v
    join roadops.iqn_work_items w on w.id = v.work_item_id
    join roadops.iqn_documents d on d.id = w.document_id and d.document_kind = 'iqn_02'
    join roadops.iqn_norm_sets n on n.work_variant_id = v.id and n.status = 'approved'
    where v.id = rule_row.work_variant_id and v.interpretation_status = 'approved'
      and v.planning_status = 'automatic' and v.basis_quantity > 0
      and coalesce(btrim(v.basis_unit), '') <> ''
      and exists (select 1 from roadops.iqn_norm_lines line
                  join roadops.iqn_resources resource on resource.id = line.resource_id and resource.resource_kind = 'labor'
                  where line.norm_set_id = n.id and line.minutes_per_basis > 0)
  ) then
    raise exception using errcode = '23514', message = 'ANNUAL_RULE_IQN_NOT_APPROVED';
  end if;
  update roadops.annual_maintenance_rules set status = 'approved',
    approved_by = roadops.current_actor_id(), approved_at = clock_timestamp()
  where id = p_rule_id;
  return p_rule_id;
end
$function$;

-- Monthly placement is a transparent scheduling algorithm. The annual count
-- is from IQN; allowed months are the explicitly reviewed scheduling policy.
create function roadops.annual_occurrence_months(p_occurrences integer, p_allowed integer[])
returns table(month_number integer, occurrences integer)
language sql immutable strict set search_path = '' as $function$
  with months as (
    select array_agg(distinct m order by m) month_list
    from unnest(p_allowed) m where m between 1 and 12
  )
  select months.month_list[1 + floor(k * cardinality(months.month_list)::numeric / p_occurrences)::integer],
         count(*)::integer
  from months cross join generate_series(0, p_occurrences - 1) k
  where p_occurrences between 1 and 366 and cardinality(months.month_list) > 0
  group by 1 order by 1
$function$;

create function roadops.generate_annual_program(p_division_id uuid, p_year integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  program_id uuid;
  year_start date;
  year_end date;
  document_id uuid;
  document_count integer;
  inventory_count integer;
  mapped_count integer;
  line_count integer;
  result jsonb;
begin
  if actor_id is null or not roadops.has_permission('planning.write', p_division_id) then
    raise exception using errcode = '42501', message = 'ANNUAL_GENERATION_FORBIDDEN';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2200 then
    raise exception using errcode = '23514', message = 'ANNUAL_YEAR_INVALID';
  end if;
  year_start := make_date(p_year, 1, 1);
  year_end := make_date(p_year + 1, 1, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_division_id::text || ':' || p_year::text, 62024));
  select id, generation_snapshot into program_id, result
  from roadops.annual_programs where division_id = p_division_id and program_year = p_year for update;
  if program_id is not null then
    return coalesce(result, '{}'::jsonb) || jsonb_build_object('programId', program_id, 'year', p_year,
      'state', (select upper(status) from roadops.annual_programs where id = program_id),
      'lineCount', (select count(*) from roadops.annual_program_items where annual_program_id = program_id), 'reused', true);
  end if;

  -- Temporary tables are session-local and fully rebuilt inside this transaction.
  -- Never reuse a caller-created temporary table in a SECURITY DEFINER function.
  drop table if exists pg_temp.annual_generation_inventory;
  create temporary table annual_generation_inventory (
    element_id uuid, version_id uuid, road_id uuid, element_type text,
    chainage_span numrange, attributes jsonb
  ) on commit drop;
  insert into pg_temp.annual_generation_inventory
  select e.id, v.id, v.road_id, v.element_type, v.chainage_span, v.attributes
  from roadops.road_elements e join roadops.road_element_versions v
    on v.road_element_id = e.id and v.valid_until is null
  where e.retired_at is null and roadops.division_for_road_zone(v.road_id, v.chainage_span, statement_timestamp()) = p_division_id;
  get diagnostics inventory_count = row_count;

  drop table if exists pg_temp.annual_generation_inputs;
  create temporary table annual_generation_inputs (
    element_id uuid, version_id uuid, road_id uuid, rule_id uuid,
    work_variant_id uuid, document_id uuid, work_unit text,
    quantity numeric(20,6), month_number integer, occurrences integer, source_reference text
  ) on commit drop;
  insert into pg_temp.annual_generation_inputs
  select inventory.element_id, inventory.version_id, inventory.road_id, rule.id,
    variant.id, work.document_id, variant.basis_unit,
    measured.quantity * rule.conversion_factor, schedule.month_number, schedule.occurrences,
    rule.source_reference
  from pg_temp.annual_generation_inventory inventory
  join roadops.annual_maintenance_rules rule on rule.element_type = inventory.element_type and rule.status = 'approved'
    and rule.effective_from <= year_start and (rule.effective_until is null or rule.effective_until >= year_end)
  join roadops.iqn_work_variants variant on variant.id = rule.work_variant_id
    and variant.interpretation_status = 'approved' and variant.planning_status = 'automatic'
  join roadops.iqn_work_items work on work.id = variant.work_item_id
  join roadops.iqn_documents document on document.id = work.document_id and document.document_kind = 'iqn_02'
    and document.effective_from <= year_start and (document.effective_until is null or document.effective_until >= year_end)
  cross join lateral roadops.annual_occurrence_months(rule.annual_occurrences, rule.allowed_months) schedule
  cross join lateral (
    select case rule.quantity_method
      when 'count' then 1::numeric
      when 'length_m' then upper(inventory.chainage_span) - lower(inventory.chainage_span)
      when 'attribute' then case
        when inventory.attributes ->> rule.quantity_attribute ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
        then (inventory.attributes ->> rule.quantity_attribute)::numeric else null end
    end quantity
  ) measured
  where measured.quantity > 0 and exists (
    select 1 from roadops.iqn_norm_sets norm
    where norm.work_variant_id = variant.id and norm.status = 'approved'
      and norm.effective_from <= year_start
      and (norm.effective_until is null or norm.effective_until >= year_end)
      and exists (select 1 from roadops.iqn_norm_lines line
                  join roadops.iqn_resources resource on resource.id = line.resource_id and resource.resource_kind = 'labor'
                  where line.norm_set_id = norm.id and line.minutes_per_basis > 0)
  );
  select count(distinct i.document_id), min(i.document_id::text)::uuid, count(distinct i.element_id)
    into document_count, document_id, mapped_count from pg_temp.annual_generation_inputs i;
  if document_count = 0 then
    raise exception using errcode = '23514', message = 'ANNUAL_APPROVED_RULES_OR_INVENTORY_MISSING';
  end if;
  if document_count > 1 then
    raise exception using errcode = '23514', message = 'ANNUAL_IQN_DOCUMENT_CONFLICT';
  end if;
  insert into roadops.annual_programs
    (division_id, program_year, iqn_document_id, source_reference, created_by, generation_method)
  values (p_division_id, p_year, document_id, 'Yo‘l elementlari va tasdiqlangan IQN davriyligi', actor_id, 'inventory-recurrence-v1')
  returning id into program_id;
  insert into roadops.annual_program_items
    (annual_program_id, road_id, work_variant_id, planned_quantity, work_unit, planned_period, note, generation_sources)
  select program_id, i.road_id, i.work_variant_id, sum(i.quantity * i.occurrences), i.work_unit,
    daterange(make_date(p_year, i.month_number, 1),
              (make_date(p_year, i.month_number, 1) + interval '1 month')::date, '[)'),
    'Yo‘l elementlari bo‘yicha davriy saqlash',
    jsonb_agg(jsonb_build_object('elementId', i.element_id, 'versionId', i.version_id, 'ruleId', i.rule_id,
      'quantityPerOccurrence', i.quantity, 'occurrences', i.occurrences, 'sourceReference', i.source_reference)
      order by i.element_id, i.rule_id)
  from pg_temp.annual_generation_inputs i group by i.road_id, i.work_variant_id, i.work_unit, i.month_number;
  get diagnostics line_count = row_count;
  result := jsonb_build_object('programId', program_id, 'year', p_year, 'state', 'DRAFT', 'lineCount', line_count,
    'reused', false, 'coverage', jsonb_build_object('inventoryElements', inventory_count,
       'mappedElements', mapped_count, 'unmappedElements', inventory_count - mapped_count));
  update roadops.annual_programs set generation_snapshot = result where id = program_id;
  return result;
end
$function$;

create function roadops.approve_annual_program(p_program_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare program_row roadops.annual_programs%rowtype;
begin
  select * into program_row from roadops.annual_programs where id = p_program_id for update;
  if program_row.id is null or roadops.current_actor_id() is null
     or not roadops.has_permission('planning.approve', program_row.division_id) then
    raise exception using errcode = '42501', message = 'ANNUAL_APPROVAL_FORBIDDEN';
  end if;
  if program_row.status = 'approved' then return p_program_id; end if;
  if program_row.status not in ('draft', 'reviewed') or not exists (
    select 1 from roadops.annual_program_items where annual_program_id = p_program_id
  ) then
    raise exception using errcode = '23514', message = 'ANNUAL_PROGRAM_NOT_READY';
  end if;
  update roadops.annual_programs set status = 'approved',
    reviewed_by = roadops.current_actor_id(), reviewed_at = clock_timestamp(),
    approved_by = roadops.current_actor_id(), approved_at = clock_timestamp()
  where id = p_program_id;
  return p_program_id;
end
$function$;

revoke all on function roadops.approve_annual_maintenance_rule(uuid),
  roadops.annual_occurrence_months(integer, integer[]),
  roadops.generate_annual_program(uuid, integer), roadops.approve_annual_program(uuid) from public;
grant execute on function roadops.approve_annual_maintenance_rule(uuid),
  roadops.generate_annual_program(uuid, integer), roadops.approve_annual_program(uuid) to roadops_api;
-- Annual state/quantity changes are made by the guarded functions. Otherwise
-- planning.write could directly assign itself planning.approve privileges.
revoke insert, update, delete on roadops.annual_programs, roadops.annual_program_items from roadops_api;

commit;
