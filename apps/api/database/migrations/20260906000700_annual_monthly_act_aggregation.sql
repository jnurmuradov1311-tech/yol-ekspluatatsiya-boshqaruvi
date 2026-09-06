begin;

-- Generated recurrence programs store monthly slices. Their annual denominator
-- and YTD identity must be the complete program/road/variant/unit group.
-- Legacy manual programs retain their original per-item reporting identity.
create function roadops.annual_completion_basis(p_item_id uuid)
returns table(group_key text, annual_quantity numeric)
language sql stable security definer set search_path = ''
as $function$
  select case when program.generation_method = 'inventory-recurrence-v1'
           then 'annual-program:' || program.id::text || ':' || item.road_id::text
             || ':' || item.work_variant_id::text || ':' || lower(btrim(item.work_unit))
           else 'annual:' || item.id::text
         end,
         case when program.generation_method = 'inventory-recurrence-v1'
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
revoke all on function roadops.annual_completion_basis(uuid) from public;
grant execute on function roadops.annual_completion_basis(uuid) to roadops_api;

create or replace function roadops.prepare_monthly_completion_act_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  source_row record;
begin
  select a.* into act_row from roadops.monthly_completion_acts a where a.id = new.act_id;
  if act_row.id is null or act_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Monthly act must be draft';
  end if;

  select wo.order_number, wo.status, wo.completed_at, wo.issued_by, wo.verified_by,
         roadops.division_for_work_order(wo.id) as division_id,
         pi.road_id, pi.work_variant_id, pi.annual_program_item_id,
         coalesce(annual_basis.annual_quantity, api.planned_quantity, 0) annual_planned_quantity,
         cr.id as completion_record_id, cr.completed_quantity, cr.work_unit,
         cr.recorded_by as completion_recorded_by, cr.verified_by as completion_verified_by,
         cr.verified_at as completion_verified_at,
         coalesce(nullif(btrim(rv.official_code), ''), r.external_id) as road_code,
         rv.name as road_name,
         coalesce(nullif(btrim(wi.normalized_code), ''), nullif(btrim(wi.raw_code), ''),
           wv.variant_key) as work_code,
         coalesce(nullif(btrim(wv.variant_label), ''), wi.normalized_name, wi.raw_name) as work_name,
         concat_ws(' · ', doc.code, nullif(btrim(wi.raw_code), ''),
           coalesce(nullif(btrim(wv.variant_label), ''), wi.normalized_name, wi.raw_name))
           as norm_reference
  into source_row
  from roadops.work_orders wo
  join roadops.work_completion_records cr on cr.work_order_id = wo.id
  join roadops.plan_items pi on pi.id = wo.plan_item_id
  left join roadops.annual_program_items api on api.id = pi.annual_program_item_id
  left join lateral roadops.annual_completion_basis(api.id) annual_basis on true
  join roadops.roads r on r.id = pi.road_id
  join roadops.road_versions rv on rv.road_id = r.id
    and rv.valid_from <= wo.completed_at
    and (rv.valid_until is null or rv.valid_until > wo.completed_at)
  join roadops.iqn_work_variants wv on wv.id = pi.work_variant_id
  join roadops.iqn_work_items wi on wi.id = wv.work_item_id
  join roadops.iqn_documents doc on doc.id = wi.document_id
  where wo.id = new.work_order_id;

  if source_row is null or source_row.status <> 'verified'
     or source_row.completed_at is null or source_row.completion_verified_at is null
     or source_row.verified_by is null or source_row.verified_by = source_row.issued_by
     or source_row.completion_verified_by is null
     or source_row.completion_verified_by = source_row.completion_recorded_by then
    raise exception using errcode = '23514',
      message = 'Only independently verified completed work can enter a monthly act';
  end if;
  if source_row.division_id is distinct from act_row.division_id then
    raise exception using errcode = '23514',
      message = 'Work order and monthly act divisions must match';
  end if;
  if (source_row.completed_at at time zone 'Asia/Tashkent')::date < act_row.act_month
     or (source_row.completed_at at time zone 'Asia/Tashkent')::date
       >= (act_row.act_month + interval '1 month')::date then
    raise exception using errcode = '23514',
      message = 'Work completion date must fall inside the act month';
  end if;

  new.completion_record_id := source_row.completion_record_id;
  new.order_number_snapshot := source_row.order_number;
  new.road_code_snapshot := source_row.road_code;
  new.road_name_snapshot := source_row.road_name;
  new.road_id_snapshot := source_row.road_id;
  new.work_variant_id_snapshot := source_row.work_variant_id;
  new.annual_program_item_id_snapshot := source_row.annual_program_item_id;
  new.work_code_snapshot := source_row.work_code;
  new.work_name_snapshot := source_row.work_name;
  new.norm_reference_snapshot := source_row.norm_reference;
  new.completed_at_snapshot := source_row.completed_at;
  new.completed_quantity := source_row.completed_quantity;
  new.work_unit := source_row.work_unit;
  new.annual_planned_quantity_snapshot := source_row.annual_planned_quantity;
  new.year_to_date_quantity_snapshot := 0;
  new.year_to_date_amount_uzs_snapshot := 0;
  new.labor_amount_uzs := 0;
  new.social_amount_uzs := 0;
  new.material_amount_uzs := 0;
  new.equipment_amount_uzs := 0;
  new.total_amount_uzs := 0;
  return new;
end
$function$;

create or replace function roadops.refresh_monthly_completion_act_totals(p_act_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select a.* into act_row
  from roadops.monthly_completion_acts a where a.id = p_act_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Monthly completion act not found';
  end if;
  if act_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft monthly act totals can be refreshed';
  end if;
  if actor_id is null or not roadops.has_permission('costs.manage', act_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot refresh this division monthly act';
  end if;

  update roadops.monthly_completion_act_items i
  set labor_amount_uzs = coalesce((
        select sum(l.amount_uzs - l.social_amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'labor'
      ), 0),
      social_amount_uzs = coalesce((
        select sum(l.social_amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'labor'
      ), 0),
      material_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'material'
      ), 0),
      equipment_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'equipment'
      ), 0),
      total_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id
      ), 0)
  where i.act_id = p_act_id;

  update roadops.monthly_completion_acts a
  set labor_amount_uzs = totals.labor_amount,
      social_amount_uzs = totals.social_amount,
      material_amount_uzs = totals.material_amount,
      equipment_amount_uzs = totals.equipment_amount,
      total_amount_uzs = totals.labor_amount + totals.social_amount
        + totals.material_amount + totals.equipment_amount
  from (
    select coalesce(sum(i.labor_amount_uzs), 0)::numeric(24,2) labor_amount,
           coalesce(sum(i.social_amount_uzs), 0)::numeric(24,2) social_amount,
           coalesce(sum(i.material_amount_uzs), 0)::numeric(24,2) material_amount,
           coalesce(sum(i.equipment_amount_uzs), 0)::numeric(24,2) equipment_amount
    from roadops.monthly_completion_act_items i where i.act_id = p_act_id
  ) totals
  where a.id = p_act_id;

  update roadops.monthly_completion_act_items current_item
  set year_to_date_quantity_snapshot = coalesce((
        select sum(prior.completed_quantity)
        from roadops.monthly_completion_act_items prior
        join roadops.monthly_completion_acts prior_act on prior_act.id = prior.act_id
        where prior_act.division_id = current_act.division_id
          and date_part('year', prior_act.act_month) = date_part('year', current_act.act_month)
          and prior_act.act_month <= current_act.act_month
          and (prior_act.status = 'approved' or prior_act.id = current_act.id)
          and (
            (current_item.annual_program_item_id_snapshot is not null
              and coalesce((
                select basis.group_key from roadops.annual_completion_basis(prior.annual_program_item_id_snapshot) basis
              ), 'annual:' || prior.annual_program_item_id_snapshot::text) = coalesce((
                select basis.group_key from roadops.annual_completion_basis(current_item.annual_program_item_id_snapshot) basis
              ), 'annual:' || current_item.annual_program_item_id_snapshot::text))
            or (current_item.annual_program_item_id_snapshot is null
              and prior.annual_program_item_id_snapshot is null
              and prior.road_id_snapshot = current_item.road_id_snapshot
              and prior.work_variant_id_snapshot = current_item.work_variant_id_snapshot
              and lower(btrim(prior.work_unit)) = lower(btrim(current_item.work_unit)))
          )
      ), 0),
      year_to_date_amount_uzs_snapshot = coalesce((
        select sum(prior.total_amount_uzs)
        from roadops.monthly_completion_act_items prior
        join roadops.monthly_completion_acts prior_act on prior_act.id = prior.act_id
        where prior_act.division_id = current_act.division_id
          and date_part('year', prior_act.act_month) = date_part('year', current_act.act_month)
          and prior_act.act_month <= current_act.act_month
          and (prior_act.status = 'approved' or prior_act.id = current_act.id)
          and (
            (current_item.annual_program_item_id_snapshot is not null
              and coalesce((
                select basis.group_key from roadops.annual_completion_basis(prior.annual_program_item_id_snapshot) basis
              ), 'annual:' || prior.annual_program_item_id_snapshot::text) = coalesce((
                select basis.group_key from roadops.annual_completion_basis(current_item.annual_program_item_id_snapshot) basis
              ), 'annual:' || current_item.annual_program_item_id_snapshot::text))
            or (current_item.annual_program_item_id_snapshot is null
              and prior.annual_program_item_id_snapshot is null
              and prior.road_id_snapshot = current_item.road_id_snapshot
              and prior.work_variant_id_snapshot = current_item.work_variant_id_snapshot
              and lower(btrim(prior.work_unit)) = lower(btrim(current_item.work_unit)))
          )
      ), 0)
  from roadops.monthly_completion_acts current_act
  where current_item.act_id = p_act_id and current_act.id = p_act_id;
end
$function$;

revoke all on function roadops.prepare_monthly_completion_act_item() from public;
revoke all on function roadops.refresh_monthly_completion_act_totals(uuid) from public;
grant execute on function roadops.refresh_monthly_completion_act_totals(uuid) to roadops_api;

commit;
