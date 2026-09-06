begin;

-- A physical defect is captured before the road-section head chooses work.
-- These field categories are not IQN work norms or automatic IQN mappings.
insert into roadops.defect_types (code, name, description, measurement_unit, active_from)
values
  ('field.pavement.pothole', 'Qoplamadagi chuqurcha', 'Joyida o‘lchangan shikastlangan yuza.', 'm2', date '2026-01-01'),
  ('field.pavement.crack', 'Qoplamadagi yoriq', 'Joyida o‘lchangan yoriq uzunligi.', 'm', date '2026-01-01'),
  ('field.sign.damaged', 'Shikastlangan yo‘l belgisi', 'Ko‘rikda aniqlangan belgilar soni.', 'unit', date '2026-01-01'),
  ('field.roadside.vegetation', 'Yo‘l yoqasidagi ortiqcha o‘simlik', 'Ko‘rikda aniqlangan o‘simliklar maydoni.', 'm2', date '2026-01-01'),
  ('field.drainage.blocked', 'Suv ketkazish tizimi tiqilishi', 'Tiqilgan ariq yoki quvur uzunligi.', 'm', date '2026-01-01'),
  ('field.surface.debris', 'Qatnov qismidagi ifloslanish', 'Tozalanishi kerak bo‘lgan maydon.', 'm2', date '2026-01-01')
on conflict (code, active_from) do nothing;

alter table roadops.inspection_observations add column observed_issue text;
alter table roadops.defect_cases add column observed_issue text;

comment on column roadops.inspection_observations.observed_issue is
  'Physical condition recorded by the inspector independently from the later IQN work choice.';
comment on column roadops.inspection_observations.iqn_topic_work_item_id is
  'Optional legacy IQN topic; defect capture does not require IQN publication or work selection.';
comment on column roadops.defect_cases.observed_issue is
  'Physical issue inherited from its source observation without inventing an IQN classification.';

create or replace function roadops.validate_inspection_defect_measurement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  observed_date date := (new.observed_at at time zone 'Asia/Tashkent')::date;
  expected_unit text;
begin
  select defect.measurement_unit into expected_unit
  from roadops.defect_types defect
  where defect.id = new.defect_type_id
    and defect.active_from <= observed_date
    and (defect.active_until is null or defect.active_until > observed_date);
  if expected_unit is null then
    raise exception using errcode = '23514', message = 'Defect type is not active on the observation date';
  end if;
  if expected_unit <> new.measurement_unit then
    raise exception using errcode = '23514', message = 'Defect measurement unit does not match its physical type';
  end if;
  if new.observed_issue is not null and btrim(new.observed_issue) = '' then
    raise exception using errcode = '23514', message = 'Observed physical issue must not be blank';
  end if;
  return new;
end
$function$;

create trigger inspection_observations_validate_defect_measurement
before insert or update of defect_type_id, measurement_unit, observed_at, observed_issue
on roadops.inspection_observations
for each row execute function roadops.validate_inspection_defect_measurement();

-- Extend the existing provenance copy. The review/submit state machine and
-- permissions remain authoritative; its approved defect keeps the physical issue.
create or replace function roadops.copy_manual_inspection_iqn_topic()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.source_kind = 'manual_inspection' and new.inspection_observation_id is not null then
    select observation.iqn_topic_work_item_id,
           coalesce(observation.observed_issue, observation.description)
    into new.iqn_topic_work_item_id, new.observed_issue
    from roadops.inspection_observations observation
    where observation.id = new.inspection_observation_id;
  elsif new.source_kind = 'roadvision' then
    new.iqn_topic_work_item_id := null;
    new.observed_issue := coalesce(new.observed_issue, new.description);
  end if;
  return new;
end
$function$;

revoke all on function roadops.validate_inspection_defect_measurement() from public;
revoke all on function roadops.copy_manual_inspection_iqn_topic() from public;

commit;
