begin;

-- Natural inventory units are explicit. A point/linear asset is one source row;
-- unknown area/volume is never inferred from the asset count or an IQN rate.
create function roadops.inventory_physical_quantity(p_version_id uuid, p_span numrange, p_unit text)
returns numeric language plpgsql stable security definer set search_path = '' as $function$
declare
  asset roadops.road_element_versions%rowtype;
  properties jsonb;
  measured text;
  fraction numeric := 1;
begin
  select * into asset from roadops.road_element_versions where id = p_version_id;
  if asset.id is null or p_span is null or isempty(p_span) then return null; end if;
  if asset.chainage_point_m is not null then
    if not p_span @> asset.chainage_point_m then return 0; end if;
  elsif not asset.chainage_span @> p_span then
    return 0;
  else
    fraction := (upper(p_span)-lower(p_span)) / (upper(asset.chainage_span)-lower(asset.chainage_span));
  end if;
  properties := coalesce(asset.attributes->'properties', '{}'::jsonb) || asset.attributes;
  if p_unit in ('unit','dona') then return 1; end if;
  if p_unit in ('m','km') then
    if asset.chainage_span is null then return null; end if;
    return (upper(p_span)-lower(p_span)) / case p_unit when 'km' then 1000 else 1 end;
  end if;
  if p_unit = 'm2' then
    measured := properties->>'areaM2';
    if measured ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then return measured::numeric * fraction; end if;
    measured := properties->>'widthM';
    if asset.chainage_span is not null and measured ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      return measured::numeric * (upper(p_span)-lower(p_span));
    end if;
  elsif p_unit = 'm3' then
    measured := properties->>'volumeM3';
    if measured ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then return measured::numeric * fraction; end if;
  end if;
  return null;
end
$function$;

create function roadops.guard_inspection_inventory_quantity()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare version_id uuid; inspection_road_id uuid; capacity numeric;
begin
  if new.road_element_id is null then
    if new.measurement_unit in ('unit','dona') then
      raise exception using errcode='23514', message='INVENTORY_ASSET_REQUIRED';
    end if;
    return new;
  end if;
  select i.road_id into inspection_road_id from roadops.inspections i where i.id=new.inspection_id;
  select v.id into version_id from roadops.road_element_versions v
  join roadops.road_elements e on e.id=v.road_element_id
  where e.id=new.road_element_id and v.road_id=inspection_road_id
    and v.valid_from<=new.observed_at and (v.valid_until is null or v.valid_until>new.observed_at)
    and (e.retired_at is null or e.retired_at>new.observed_at);
  if version_id is null then
    raise exception using errcode='23514', message='INVENTORY_ASSET_NOT_EFFECTIVE';
  end if;
  capacity := roadops.inventory_physical_quantity(version_id,new.chainage_span,new.measurement_unit);
  if capacity is null then
    raise exception using errcode='23514', message='INVENTORY_MEASURE_MISSING';
  end if;
  if new.measured_quantity>capacity or capacity<=0
     or (new.measurement_unit in ('unit','dona') and new.measured_quantity<>trunc(new.measured_quantity)) then
    raise exception using errcode='23514', message='INVENTORY_QUANTITY_EXCEEDED';
  end if;
  return new;
end
$function$;
create trigger inspection_observations_inventory_quantity
before insert or update of inspection_id,road_element_id,chainage_span,observed_at,measured_quantity,measurement_unit
on roadops.inspection_observations for each row execute function roadops.guard_inspection_inventory_quantity();

-- Return one occurrence in the IQN work unit, using only expert-approved
-- mappings. A known mapping with no inventory is zero, an unknown mapping null.
create function roadops.inventory_work_capacity(p_road_id uuid,p_variant_id uuid,p_span numrange,p_at timestamptz,p_asset_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = '' as $function$
declare capacity numeric; missing boolean;
begin
  if not exists(select 1 from roadops.annual_maintenance_rules r
    where r.work_variant_id=p_variant_id and r.status='approved'
      and r.effective_from<=(p_at at time zone 'Asia/Tashkent')::date
      and (r.effective_until is null or r.effective_until>(p_at at time zone 'Asia/Tashkent')::date)) then
    return null;
  end if;
  if exists(select 1 from roadops.annual_maintenance_rules r
    join roadops.iqn_work_variants q on q.id=r.work_variant_id
    where r.work_variant_id=p_variant_id and r.status='approved' and r.quantity_method='count'
      and q.basis_unit in ('unit','dona') and r.conversion_factor<>1
      and r.effective_from<=(p_at at time zone 'Asia/Tashkent')::date
      and (r.effective_until is null or r.effective_until>(p_at at time zone 'Asia/Tashkent')::date)) then
    raise exception using errcode='23514',message='INVENTORY_UNIT_MISMATCH';
  end if;
  select coalesce(sum(quantity * conversion_factor),0),coalesce(bool_or(quantity is null),false)
  into capacity,missing from (
    select r.conversion_factor,
      case r.quantity_method
        when 'count' then case when v.chainage_point_m is not null or p_span @> v.chainage_span then 1::numeric else null end
        when 'length_m' then case when v.chainage_span is not null
          then upper(v.chainage_span * p_span)-lower(v.chainage_span * p_span) else null end
        when 'attribute' then case when coalesce(v.attributes->>r.quantity_attribute,v.attributes->'properties'->>r.quantity_attribute) ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
          then coalesce(v.attributes->>r.quantity_attribute,v.attributes->'properties'->>r.quantity_attribute)::numeric
            * case when v.chainage_span is null then 1 else
                (upper(v.chainage_span*p_span)-lower(v.chainage_span*p_span))/(upper(v.chainage_span)-lower(v.chainage_span)) end
          else null end
      end quantity
    from roadops.annual_maintenance_rules r
    join roadops.road_element_versions v on v.element_type=r.element_type and v.road_id=p_road_id
      and v.valid_from<=p_at and (v.valid_until is null or v.valid_until>p_at)
      and ((v.chainage_point_m is not null and p_span @> v.chainage_point_m)
        or (v.chainage_span is not null and v.chainage_span && p_span))
    join roadops.road_elements e on e.id=v.road_element_id and (e.retired_at is null or e.retired_at>p_at)
    where r.work_variant_id=p_variant_id and r.status='approved'
      and (p_asset_id is null or v.road_element_id=p_asset_id)
      and r.effective_from<=(p_at at time zone 'Asia/Tashkent')::date
      and (r.effective_until is null or r.effective_until>(p_at at time zone 'Asia/Tashkent')::date)
  ) measured;
  if missing then raise exception using errcode='23514', message='INVENTORY_MEASURE_MISSING'; end if;
  return capacity;
end
$function$;

create function roadops.assert_plan_inventory_quantity(p_plan roadops.plan_items)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  annual roadops.annual_program_items%rowtype;
  asset_id uuid;
  version_id uuid;
  capacity numeric;
  claimed numeric;
  work_day date;
  source_defect uuid;
begin
  if p_plan.status='cancelled' or p_plan.work_quantity is null or p_plan.scheduled_window is null then return; end if;
  if exists(select 1 from roadops.planning_runs r where r.id=p_plan.planning_run_id and r.status in ('cancelled','superseded')) then return; end if;
  work_day := (lower(p_plan.scheduled_window) at time zone 'Asia/Tashkent')::date;
  -- Serialize competing requests, including non-overlapping hours on one day.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan.road_id::text||':'||p_plan.work_variant_id::text||':'||work_day::text,27024));
  if p_plan.annual_program_item_id is not null then
    select * into annual from roadops.annual_program_items where id=p_plan.annual_program_item_id for update;
    if annual.road_id<>p_plan.road_id or annual.work_variant_id<>p_plan.work_variant_id
      or annual.work_unit<>p_plan.work_unit or not annual.planned_period @> work_day then
      raise exception using errcode='23514',message='ANNUAL_ITEM_SCOPE_MISMATCH';
    end if;
    select coalesce(sum(coalesce((select cr.completed_quantity from roadops.work_orders o join roadops.work_completion_records cr on cr.work_order_id=o.id where o.plan_item_id=pi.id and o.status='verified' and cr.verified_at is not null),pi.work_quantity)),0) into claimed from roadops.plan_items pi
    join roadops.planning_runs r on r.id=pi.planning_run_id
    where pi.annual_program_item_id=annual.id and pi.id<>p_plan.id and pi.status<>'cancelled'
      and r.status not in ('cancelled','superseded');
    if claimed+p_plan.work_quantity>annual.planned_quantity then
      raise exception using errcode='23514',message='ANNUAL_QUANTITY_EXCEEDED';
    end if;
  end if;
  source_defect := p_plan.defect_case_id;
  if source_defect is null and p_plan.formula_inputs#>>'{manualInput,sourceDefectId}' ~ '^[0-9a-fA-F-]{36}$' then
    source_defect := (p_plan.formula_inputs#>>'{manualInput,sourceDefectId}')::uuid;
  end if;
  select d.road_element_id into asset_id from roadops.defect_cases d where d.id=source_defect;
  capacity := roadops.inventory_work_capacity(p_plan.road_id,p_plan.work_variant_id,p_plan.chainage_span,lower(p_plan.scheduled_window),asset_id);
  if capacity is not null and exists(select 1 from roadops.iqn_work_variants v
    where v.id=p_plan.work_variant_id and v.basis_unit<>p_plan.work_unit) then
    raise exception using errcode='23514',message='INVENTORY_UNIT_MISMATCH';
  end if;
  if capacity is null and asset_id is not null then
    select v.id into version_id from roadops.road_element_versions v
    where v.road_element_id=asset_id and v.road_id=p_plan.road_id
      and v.valid_from<=lower(p_plan.scheduled_window)
      and (v.valid_until is null or v.valid_until>lower(p_plan.scheduled_window));
    capacity := roadops.inventory_physical_quantity(version_id,p_plan.chainage_span,p_plan.work_unit);
    if capacity is null then raise exception using errcode='23514',message='INVENTORY_MEASURE_MISSING'; end if;
  end if;
  if capacity is null then
    if p_plan.work_unit in ('unit','dona') or annual.generation_sources is not null then
      raise exception using errcode='23514',message='INVENTORY_MAPPING_REQUIRED';
    end if;
    return;
  end if;
  if p_plan.work_unit in ('unit','dona') and p_plan.work_quantity<>trunc(p_plan.work_quantity) then
    raise exception using errcode='23514',message='INVENTORY_QUANTITY_EXCEEDED';
  end if;
  -- Each daily order is one occurrence. The approved annual/monthly total
  -- permits recurrence on different days; another same-day order cannot reuse it.
  select coalesce(sum(coalesce((select cr.completed_quantity from roadops.work_orders o join roadops.work_completion_records cr on cr.work_order_id=o.id where o.plan_item_id=pi.id and o.status='verified' and cr.verified_at is not null),pi.work_quantity)),0) into claimed from roadops.plan_items pi
  join roadops.planning_runs r on r.id=pi.planning_run_id
  where pi.id<>p_plan.id and pi.road_id=p_plan.road_id and pi.work_variant_id=p_plan.work_variant_id
    and pi.work_unit=p_plan.work_unit and pi.chainage_span && p_plan.chainage_span
    and pi.status<>'cancelled' and r.status not in ('cancelled','superseded')
    and (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date=work_day;
  if p_plan.work_quantity+claimed>capacity then
    raise exception using errcode='23514',message='INVENTORY_QUANTITY_EXCEEDED';
  end if;
end
$function$;
create function roadops.guard_plan_inventory_quantity()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin perform roadops.assert_plan_inventory_quantity(new); return new; end
$function$;
create trigger plan_items_inventory_quantity before insert or update of road_id,work_variant_id,chainage_span,work_quantity,work_unit,scheduled_window,status,annual_program_item_id,defect_case_id,formula_inputs
on roadops.plan_items for each row execute function roadops.guard_plan_inventory_quantity();

-- Check again at actual recording/verification, including legacy plans created
-- before this migration. The record cannot exceed its authorized daily order.
create function roadops.guard_completion_inventory_quantity()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare plan roadops.plan_items%rowtype;
begin
  select p.* into plan from roadops.work_orders o join roadops.plan_items p on p.id=o.plan_item_id
  where o.id=new.work_order_id;
  if new.completed_quantity>plan.work_quantity or new.work_unit<>plan.work_unit then
    raise exception using errcode='23514',message='INVENTORY_QUANTITY_EXCEEDED';
  end if;
  plan.work_quantity := new.completed_quantity;
  perform roadops.assert_plan_inventory_quantity(plan);
  return new;
end
$function$;
create trigger work_completion_records_inventory_quantity before insert or update of completed_quantity,work_unit,verified_at
on roadops.work_completion_records for each row execute function roadops.guard_completion_inventory_quantity();

revoke all on function roadops.inventory_physical_quantity(uuid,numrange,text),
  roadops.guard_inspection_inventory_quantity(),roadops.inventory_work_capacity(uuid,uuid,numrange,timestamptz,uuid),
  roadops.assert_plan_inventory_quantity(roadops.plan_items),roadops.guard_plan_inventory_quantity(),
  roadops.guard_completion_inventory_quantity() from public, roadops_api, roadops_sync, roadops_reporting;

-- Include source point assets and the YTP properties envelope in annual need.
create or replace function roadops.generate_annual_program(p_division_id uuid, p_year integer)
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
    if exists(select 1 from roadops.annual_programs p where p.id=program_id
                and p.status='draft' and p.generation_method like 'inventory-recurrence-%')
      and not exists(select 1 from roadops.plan_items pi join roadops.annual_program_items i
                     on i.id=pi.annual_program_item_id where i.annual_program_id=program_id)
      and not exists(select 1 from roadops.planning_runs r where r.annual_program_id=program_id) then
      -- Refresh an unapproved draft after inventory/mapping corrections. Its ID
      -- and audit history stay intact; published/used source rows are immutable.
      delete from roadops.annual_program_items where annual_program_id=program_id;
    else
      return coalesce(result, '{}'::jsonb) || jsonb_build_object('programId', program_id, 'year', p_year,
        'state', (select upper(status) from roadops.annual_programs where id = program_id),
        'lineCount', (select count(*) from roadops.annual_program_items where annual_program_id = program_id), 'reused', true);
    end if;
  end if;

  -- Temporary tables are session-local and fully rebuilt inside this transaction.
  -- Never reuse a caller-created temporary table in a SECURITY DEFINER function.
  drop table if exists pg_temp.annual_generation_inventory;
  create temporary table annual_generation_inventory (
    element_id uuid, version_id uuid, road_id uuid, element_type text,
    chainage_span numrange, chainage_point_m numeric, attributes jsonb
  ) on commit drop;
  insert into pg_temp.annual_generation_inventory
  select e.id, v.id, v.road_id, v.element_type, v.chainage_span, v.chainage_point_m, v.attributes
  from roadops.road_elements e join roadops.road_element_versions v
    on v.road_element_id = e.id and v.valid_until is null and v.valid_from<=statement_timestamp()
  where e.retired_at is null and exists (
    select 1 from roadops.road_division_assignments a
    where a.road_id=v.road_id and a.division_id=p_division_id
      and a.valid_from<=statement_timestamp() and (a.valid_until is null or a.valid_until>statement_timestamp())
      and ((v.chainage_point_m is not null and a.chainage_span @> v.chainage_point_m)
        or (v.chainage_span is not null and a.chainage_span @> v.chainage_span))
  );
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
    and not (rule.quantity_method='count' and variant.basis_unit in ('unit','dona') and rule.conversion_factor<>1)
  join roadops.iqn_work_items work on work.id = variant.work_item_id
  join roadops.iqn_documents document on document.id = work.document_id and document.document_kind = 'iqn_02'
    and document.effective_from <= year_start and (document.effective_until is null or document.effective_until >= year_end)
  cross join lateral roadops.annual_occurrence_months(rule.annual_occurrences, rule.allowed_months) schedule
  cross join lateral (
    select case rule.quantity_method
      when 'count' then 1::numeric
      when 'length_m' then upper(inventory.chainage_span) - lower(inventory.chainage_span)
      when 'attribute' then case
        when coalesce(inventory.attributes ->> rule.quantity_attribute, inventory.attributes->'properties'->>rule.quantity_attribute) ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
        then (coalesce(inventory.attributes ->> rule.quantity_attribute, inventory.attributes->'properties'->>rule.quantity_attribute))::numeric else null end
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
  if program_id is null then
    insert into roadops.annual_programs
      (division_id, program_year, iqn_document_id, source_reference, created_by, generation_method)
    values (p_division_id, p_year, document_id, 'Yo‘l elementlari va tasdiqlangan IQN davriyligi', actor_id, 'inventory-recurrence-v2')
    returning id into program_id;
  else
    update roadops.annual_programs set iqn_document_id=document_id, generation_method='inventory-recurrence-v2'
    where id=program_id;
  end if;
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


create or replace function roadops.approve_annual_program(p_program_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare program_row roadops.annual_programs%rowtype;
begin
  select * into program_row from roadops.annual_programs where id = p_program_id for update;
  if program_row.id is null or roadops.current_actor_id() is null
     or not roadops.has_permission('planning.approve', program_row.division_id) then
    raise exception using errcode = '42501', message = 'ANNUAL_APPROVAL_FORBIDDEN';
  end if;
  if program_row.status = 'approved' then return p_program_id; end if;
  if program_row.generation_method is not null and
    (program_row.generation_snapshot#>>'{coverage,unmappedElements}')::integer is distinct from 0 then
    raise exception using errcode='23514',message='ANNUAL_INVENTORY_COVERAGE_INCOMPLETE';
  end if;
  if program_row.generation_method is not null and exists (
    select 1 from roadops.road_elements e
    join roadops.road_element_versions v on v.road_element_id=e.id and v.valid_until is null and v.valid_from<=statement_timestamp()
    where e.retired_at is null and exists (
      select 1 from roadops.road_division_assignments a
      where a.road_id=v.road_id and a.division_id=program_row.division_id
        and a.valid_from<=statement_timestamp() and (a.valid_until is null or a.valid_until>statement_timestamp())
        and ((v.chainage_point_m is not null and a.chainage_span @> v.chainage_point_m)
          or (v.chainage_span is not null and a.chainage_span @> v.chainage_span))
    ) and not exists (
      select 1 from roadops.annual_program_items i
      cross join lateral jsonb_array_elements(i.generation_sources) source
      where i.annual_program_id=p_program_id and source->>'elementId'=e.id::text and source->>'versionId'=v.id::text
    )
  ) then
    raise exception using errcode='23514',message='ANNUAL_INVENTORY_SNAPSHOT_STALE';
  end if;
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


create or replace function roadops.approve_annual_maintenance_rule(p_rule_id uuid)
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
  if rule_row.quantity_method='count' and rule_row.conversion_factor<>1
    and exists(select 1 from roadops.iqn_work_variants v where v.id=rule_row.work_variant_id
               and v.basis_unit in ('unit','dona')) then
    raise exception using errcode='23514',message='INVENTORY_UNIT_MISMATCH';
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


-- Preserve full-year act denominators across both inventory generator versions.
create or replace function roadops.annual_completion_basis(p_item_id uuid)
returns table(group_key text, annual_quantity numeric)
language sql stable security definer set search_path = ''
as $function$
  select case when program.generation_method in ('inventory-recurrence-v1', 'inventory-recurrence-v2')
           then 'annual-program:' || program.id::text || ':' || item.road_id::text
             || ':' || item.work_variant_id::text || ':' || lower(btrim(item.work_unit))
           else 'annual:' || item.id::text
         end,
         case when program.generation_method in ('inventory-recurrence-v1', 'inventory-recurrence-v2')
           then (select sum(sibling.planned_quantity)
                 from roadops.annual_program_items sibling
                 where sibling.annual_program_id = item.annual_program_id
                   and sibling.road_id = item.road_id
                   and sibling.work_variant_id = item.work_variant_id
                   and lower(btrim(sibling.work_unit)) = lower(btrim(item.work_unit)))
           else item.planned_quantity
         end
  from roadops.annual_program_items item
  join roadops.annual_programs program on program.id = item.annual_program_id
  where item.id = p_item_id
    and (roadops.has_permission('costs.read', program.division_id)
         or roadops.has_permission('costs.manage', program.division_id))
$function$;

commit;
