begin;

-- A road master records the broad IQN 02-24 work topic seen in the field.
-- The exact executable variant is selected later by the planner. Historical
-- observations remain readable; every new API record supplies this reference.
alter table roadops.inspection_observations
  add column iqn_topic_work_item_id uuid
    references roadops.iqn_work_items(id) on delete restrict;

alter table roadops.defect_cases
  add column iqn_topic_work_item_id uuid
    references roadops.iqn_work_items(id) on delete restrict;

create index inspection_observations_iqn_topic_idx
  on roadops.inspection_observations (iqn_topic_work_item_id)
  where iqn_topic_work_item_id is not null;
create index defect_cases_iqn_topic_idx
  on roadops.defect_cases (iqn_topic_work_item_id)
  where iqn_topic_work_item_id is not null;

create or replace function roadops.validate_manual_inspection_iqn_topic()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  topic_number text;
begin
  if new.iqn_topic_work_item_id is null then
    return new;
  end if;

  select item.source_location ->> 'topic_number'
  into topic_number
  from roadops.iqn_work_items item
  join roadops.iqn_documents document on document.id = item.document_id
  join roadops.iqn_import_reviews review
    on review.published_document_id = document.id and review.review_state = 'published'
  where item.id = new.iqn_topic_work_item_id
    and document.document_kind = 'iqn_02'
    and document.effective_from <= (new.observed_at at time zone 'Asia/Tashkent')::date
    and (document.effective_until is null
         or document.effective_until > (new.observed_at at time zone 'Asia/Tashkent')::date)
    and item.item_kind = 'group'
    and item.parent_item_id is null
    and item.source_location ->> 'catalog_role' = 'manual_inspection_topic';

  if topic_number is null or topic_number !~ '^(?:[1-9]|1[0-9]|2[0-9])$' then
    raise exception using errcode = '23514',
      message = 'Manual inspection topic must be one of the 29 expert-published IQN 02 topics';
  end if;

  return new;
end
$function$;

create trigger inspection_observations_validate_iqn_topic
before insert or update of iqn_topic_work_item_id, observed_at on roadops.inspection_observations
for each row execute function roadops.validate_manual_inspection_iqn_topic();

create or replace function roadops.copy_manual_inspection_iqn_topic()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.source_kind = 'manual_inspection' and new.inspection_observation_id is not null then
    select observation.iqn_topic_work_item_id
    into new.iqn_topic_work_item_id
    from roadops.inspection_observations observation
    where observation.id = new.inspection_observation_id;
  elsif new.source_kind = 'roadvision' then
    new.iqn_topic_work_item_id := null;
  end if;

  return new;
end
$function$;

create trigger defect_cases_copy_iqn_topic
before insert on roadops.defect_cases
for each row execute function roadops.copy_manual_inspection_iqn_topic();

comment on column roadops.inspection_observations.iqn_topic_work_item_id is
  'Expert-published top-level IQN 02 work topic selected by the road master; not an executable norm variant.';
comment on column roadops.defect_cases.iqn_topic_work_item_id is
  'Frozen link to the broad IQN 02 field topic inherited from a manual inspection.';

revoke all on function roadops.validate_manual_inspection_iqn_topic() from public;
revoke all on function roadops.copy_manual_inspection_iqn_topic() from public;

commit;
