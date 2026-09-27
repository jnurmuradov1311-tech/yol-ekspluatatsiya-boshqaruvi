begin;

-- Existing accepted sources remain traceable. New web/mobile capture is strict
-- about inventory at verification, not at the foreman's initial recording.
alter table roadops.inspection_observations add column inventory_resolution text not null default 'LEGACY'
  check (inventory_resolution in ('LEGACY','MATCHED','REVIEW_REQUIRED'));
update roadops.inspection_observations set inventory_resolution='MATCHED' where road_element_id is not null;

-- These aliases identify physical assets, not a defect-to-IQN work decision.
-- Unknown imported element taxonomies require a human match; no fuzzy guessing.
create function roadops.inspection_element_type_matches(p_defect_code text,p_element_type text)
returns boolean language sql immutable set search_path='' as $function$
  select replace(lower(p_element_type),'-','_') = any(case
    when p_defect_code like 'field.pavement.%' or p_defect_code='field.surface.debris'
      then array['pavement','asphalt','asphalt_pavement','road_surface','carriageway']
    when p_defect_code like 'field.sign.%' then array['sign','road_sign','traffic_sign']
    when p_defect_code='field.roadside.vegetation' then array['grass','vegetation','greenery','roadside']
    when p_defect_code like 'field.drainage.%' then array['drainage','ditch','culvert']
    else array[]::text[] end)
$function$;

create or replace function roadops.guard_inspection_inventory_quantity()
returns trigger language plpgsql security definer set search_path='' as $function$
declare
  inspection roadops.inspections%rowtype;
  version_id uuid;
  defect_code text;
  matches uuid[];
  capacity numeric;
  modern boolean;
begin
  select * into inspection from roadops.inspections where id=new.inspection_id;
  modern := coalesce(inspection.source_reference='manual-web-v2',false);
  if new.measurement_unit in ('unit','dona') and new.measured_quantity<>trunc(new.measured_quantity) then
    raise exception using errcode='23514',message='INVENTORY_QUANTITY_EXCEEDED';
  end if;
  select code into defect_code from roadops.defect_types where id=new.defect_type_id;
  if new.road_element_id is null and modern and new.review_status='pending' then
    select array_agg(v.road_element_id order by v.road_element_id) into matches
    from roadops.road_element_versions v join roadops.road_elements e on e.id=v.road_element_id
    where v.road_id=inspection.road_id and v.valid_from<=new.observed_at
      and (v.valid_until is null or v.valid_until>new.observed_at)
      and (e.retired_at is null or e.retired_at>new.observed_at)
      and roadops.inspection_element_type_matches(defect_code,v.element_type)
      and ((v.chainage_point_m is not null and new.chainage_span @> v.chainage_point_m)
        or (v.chainage_span is not null and v.chainage_span @> new.chainage_span));
    if cardinality(matches)=1 then new.road_element_id:=matches[1]; end if;
  end if;
  if new.road_element_id is null then
    if modern then
      new.inventory_resolution:='REVIEW_REQUIRED';
    elsif new.measurement_unit in ('unit','dona') then
      raise exception using errcode='23514',message='INVENTORY_ASSET_REQUIRED';
    end if;
  else
    select v.id into version_id from roadops.road_element_versions v
    join roadops.road_elements e on e.id=v.road_element_id
    where e.id=new.road_element_id and v.road_id=inspection.road_id
      and v.valid_from<=new.observed_at and (v.valid_until is null or v.valid_until>new.observed_at)
      and (e.retired_at is null or e.retired_at>new.observed_at);
    if version_id is null then
      raise exception using errcode='23514',message='INVENTORY_ASSET_NOT_EFFECTIVE';
    end if;
    if modern and defect_code in ('field.pavement.pothole','field.pavement.crack','field.surface.debris',
      'field.sign.damaged','field.roadside.vegetation','field.drainage.blocked') and not exists (
        select 1 from roadops.road_element_versions v where v.id=version_id
          and roadops.inspection_element_type_matches(defect_code,v.element_type)) then
      raise exception using errcode='23514',message='INVENTORY_ASSET_TYPE_MISMATCH';
    end if;
    capacity:=roadops.inventory_physical_quantity(version_id,new.chainage_span,new.measurement_unit);
    if capacity is null then
      if not modern then raise exception using errcode='23514',message='INVENTORY_MEASURE_MISSING'; end if;
      new.inventory_resolution:='REVIEW_REQUIRED';
    else
      if new.measured_quantity>capacity or capacity<=0 then
        raise exception using errcode='23514',message='INVENTORY_QUANTITY_EXCEEDED';
      end if;
      new.inventory_resolution:='MATCHED';
    end if;
  end if;
  if modern and new.review_status='approved' and new.inventory_resolution<>'MATCHED' then
    raise exception using errcode='23514',message='INVENTORY_REVIEW_REQUIRED';
  end if;
  return new;
end
$function$;

drop trigger inspection_observations_inventory_quantity on roadops.inspection_observations;
create trigger inspection_observations_inventory_quantity
before insert or update of inspection_id,road_element_id,defect_type_id,chainage_span,observed_at,
  measured_quantity,measurement_unit,review_status
on roadops.inspection_observations for each row execute function roadops.guard_inspection_inventory_quantity();

-- Review resolves only the asset reference. The foreman's observation, amount,
-- evidence and original source hash remain unchanged; the decision is audited.
create function roadops.resolve_inspection_inventory(p_observation_id uuid,p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
  observation roadops.inspection_observations%rowtype;
  inspection roadops.inspections%rowtype;
  actor_id uuid:=roadops.current_actor_id();
  resolution text;
begin
  select * into observation from roadops.inspection_observations where id=p_observation_id for update;
  select * into inspection from roadops.inspections where id=observation.inspection_id for update;
  if observation.id is null or inspection.status<>'submitted' or observation.review_status<>'pending'
    or actor_id is null or actor_id=inspection.inspector_user_id
    or not roadops.has_permission('defects.verify',inspection.division_id) then
    raise exception using errcode='42501',message='Independent verifier is required';
  end if;
  if p_asset_id is null then raise exception using errcode='23514',message='INVENTORY_REVIEW_REQUIRED'; end if;
  update roadops.inspection_observations set road_element_id=p_asset_id
  where id=p_observation_id returning inventory_resolution into resolution;
  if resolution<>'MATCHED' then raise exception using errcode='23514',message='INVENTORY_MEASURE_MISSING'; end if;
  insert into roadops.inspection_events
    (inspection_id,observation_id,from_status,to_status,event_code,actor_user_id,details,request_id)
  values(inspection.id,observation.id,'pending','pending','inspection_inventory_resolved',actor_id,
    jsonb_build_object('previousRoadElementId',observation.road_element_id,'roadElementId',p_asset_id,
      'originalSourceHash',encode(observation.source_hash,'hex')),roadops.current_request_id());
end
$function$;
revoke all on function roadops.inspection_element_type_matches(text,text),
  roadops.resolve_inspection_inventory(uuid,uuid) from public,roadops_api,roadops_sync,roadops_reporting;
grant execute on function roadops.resolve_inspection_inventory(uuid,uuid) to roadops_api;

commit;
