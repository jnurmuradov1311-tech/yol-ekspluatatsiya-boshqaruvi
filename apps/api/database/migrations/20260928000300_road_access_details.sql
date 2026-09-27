begin;

-- Shared exact section/lane/window representation for the register and YTP.
-- Private helper: callers use the scoped wrapper below.
create function roadops.road_access_payload(p_plan_item_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $function$
  select jsonb_build_object(
    'planningRunId', pi.planning_run_id, 'planItemId', pi.id,
    'workOrderId', wo.id, 'orderNumber', wo.order_number,
    'roadId', pi.road_id, 'divisionId', run.division_id,
    'chainageStartM', lower(pi.chainage_span)::text,
    'chainageEndM', upper(pi.chainage_span)::text,
    'startsAt', lower(pi.scheduled_window), 'endsAt', upper(pi.scheduled_window),
    'direction', coalesce(nullif(btrim(manual.direction), ''),
      nullif(btrim(observation.direction), ''), nullif(btrim(candidate.direction), '')),
    'laneLabel', case when scheme.scheme_kind = 'full_closure_permit' then 'Barcha tasmalar'
      else coalesce(nullif(btrim(manual.lane_label), ''),
        nullif(btrim(observation.lane_label), ''), nullif(btrim(candidate.lane_label), '')) end,
    'roadAccess', case when scheme.scheme_kind is null or scheme.scheme_kind = 'shoulder_work' then 'OPEN'
      when scheme.scheme_kind = 'full_closure_permit' then 'CLOSED' else 'PARTIAL' end,
    'permitReference', pi.permit_reference,
    'operationalState', case when wo.status in ('completed', 'verified') then 'OPENED'
      when wo.status = 'cancelled' or pi.status = 'cancelled' then 'CANCELLED'
      when wo.status in ('in_progress', 'paused') and (
        select event.payload ->> 'status' from roadops.integration_outbox event
        where event.aggregate_type = 'plan_item' and event.aggregate_id = pi.id
          and event.destination_code = 'road_repair' and event.event_kind like 'road_access.%'
        order by event.created_at desc, event.id desc limit 1
      ) = 'COMPLETED' then 'OPENED'
      when wo.status in ('in_progress', 'paused') then 'ACTIVE'
      when upper(pi.scheduled_window) < statement_timestamp() then 'OVERDUE'
      else 'SCHEDULED' end,
    'workName', coalesce(pi.formula_inputs ->> 'workName', item.normalized_name),
    'roadCode', road.official_code
  )
  from roadops.plan_items pi
  join roadops.planning_runs run on run.id = pi.planning_run_id
  left join roadops.safety_schemes scheme on scheme.id = pi.safety_scheme_id
  left join roadops.manual_work_requests manual on manual.id = pi.manual_work_request_id
  left join roadops.defect_cases defect on defect.id = coalesce(pi.defect_case_id,
    nullif(pi.formula_inputs #>> '{manualInput,sourceDefectId}', '')::uuid)
  left join roadops.inspection_observations observation on observation.id = defect.inspection_observation_id
  left join roadops.roadvision_candidates candidate on candidate.id = defect.roadvision_candidate_id
  left join roadops.work_orders wo on wo.plan_item_id = pi.id
  left join roadops.iqn_work_variants variant on variant.id = pi.work_variant_id
  left join roadops.iqn_work_items item on item.id = variant.work_item_id
  left join roadops.road_versions road on road.road_id = pi.road_id and road.valid_until is null
  where pi.id = p_plan_item_id
$function$;

create function roadops.road_access_details(p_plan_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb; division uuid; delivery record;
begin
  select run.division_id into division from roadops.plan_items item
    join roadops.planning_runs run on run.id = item.planning_run_id where item.id = p_plan_item_id;
  if division is null or not (roadops.has_permission('planning.read', division)
    or roadops.has_permission('planning.write', division)
    or roadops.has_permission('planning.approve', division)
    or roadops.has_permission('execution.read', division)) then
    raise exception using errcode = '42501', message = 'Road access entry is outside the current scope';
  end if;
  result := roadops.road_access_payload(p_plan_item_id);
  select state, published_at into delivery from roadops.integration_outbox
    where aggregate_type = 'plan_item' and aggregate_id = p_plan_item_id
      and destination_code = 'road_repair' and event_kind like 'road_access.%'
    order by created_at desc, id desc limit 1;
  return result || jsonb_build_object('deliveryState', coalesce(upper(delivery.state), 'NOT_QUEUED'),
    'deliveredAt', delivery.published_at);
end
$function$;

-- New dispatches cannot publish a partial closure without an exact lane and
-- direction. Existing historical plans remain readable and visibly incomplete.
create function roadops.guard_road_access_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare item record; body jsonb;
begin
  if new.status <> 'published' or old.status = 'published' then return new; end if;
  for item in select pi.id, ss.scheme_kind from roadops.plan_items pi
    join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
    where pi.planning_run_id = new.id and pi.status <> 'cancelled' and ss.scheme_kind <> 'shoulder_work'
  loop
    body := roadops.road_access_payload(item.id);
    if coalesce(body ->> 'direction', '') = ''
      or (item.scheme_kind <> 'full_closure_permit' and coalesce(body ->> 'laneLabel', '') = '')
      or (item.scheme_kind = 'full_closure_permit' and coalesce(btrim(body ->> 'permitReference'), '') = '') then
      raise exception using errcode = '23514', message = 'ROAD_ACCESS_DETAILS_REQUIRED';
    end if;
  end loop;
  return new;
end
$function$;
create trigger planning_runs_guard_road_access before update of status on roadops.planning_runs
  for each row execute function roadops.guard_road_access_dispatch();

create or replace function roadops.queue_work_road_access()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare item record; body jsonb;
begin
  if new.status <> 'published' or old.status = 'published' then return new; end if;
  for item in select pi.id from roadops.plan_items pi
    join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
    where pi.planning_run_id = new.id and pi.status <> 'cancelled' and ss.scheme_kind <> 'shoulder_work'
  loop
    body := roadops.road_access_payload(item.id) || jsonb_build_object('status', 'SCHEDULED');
    insert into roadops.integration_outbox(destination_code,event_kind,aggregate_type,aggregate_id,payload,payload_hash)
      values('road_repair','road_access.scheduled','plan_item',item.id,body,
        extensions.digest(convert_to(body::text,'UTF8'),'sha256')) on conflict do nothing;
  end loop;
  return new;
end
$function$;

create or replace function roadops.queue_work_road_access_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare item record; body jsonb; event_status text;
begin
  if tg_table_name = 'work_orders' then
    -- A returned completion corrects accounting/evidence; it does not close a road again.
    if old.status = 'completed' and new.status = 'in_progress' then return new; end if;
    if new.status is not distinct from old.status or new.status not in ('in_progress','completed','cancelled') then return new; end if;
    select pi.id, ss.scheme_kind, run.status run_status into item from roadops.plan_items pi
      join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
      join roadops.planning_runs run on run.id = pi.planning_run_id where pi.id = new.plan_item_id;
    event_status := upper(new.status);
  else
    if new.scheduled_window is not distinct from old.scheduled_window
      and not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then return new; end if;
    select pi.id, ss.scheme_kind, run.status run_status into item from roadops.plan_items pi
      join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
      join roadops.planning_runs run on run.id = pi.planning_run_id where pi.id = new.id;
    event_status := case when new.status = 'cancelled' then 'CANCELLED' else 'RESCHEDULED' end;
  end if;
  if item.id is null or item.scheme_kind = 'shoulder_work' or item.run_status <> 'published' then return new; end if;
  body := roadops.road_access_payload(item.id) || jsonb_build_object('status', event_status);
  if event_status in ('COMPLETED','CANCELLED') then body := body || '{"roadAccess":"OPEN"}'::jsonb; end if;
  insert into roadops.integration_outbox(destination_code,event_kind,aggregate_type,aggregate_id,payload,payload_hash)
    values('road_repair','road_access.updated','plan_item',item.id,body,
      extensions.digest(convert_to(body::text,'UTF8'),'sha256')) on conflict do nothing;
  return new;
end
$function$;

revoke all on function roadops.road_access_payload(uuid),roadops.guard_road_access_dispatch()
  from public,roadops_api,roadops_sync,roadops_reporting;
revoke all on function roadops.road_access_details(uuid) from public,roadops_sync,roadops_reporting;
grant execute on function roadops.road_access_details(uuid) to roadops_api;
commit;
