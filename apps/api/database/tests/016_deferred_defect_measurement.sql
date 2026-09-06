-- Run after migrations. Exercise the production validators without IQN fixtures.
begin;

create temporary table deferred_capture_probe (
  defect_type_id uuid,
  measurement_unit text,
  observed_at timestamptz,
  observed_issue text,
  iqn_topic_work_item_id uuid
);
create trigger validate_measurement
before insert on deferred_capture_probe
for each row execute function roadops.validate_inspection_defect_measurement();
create trigger validate_optional_topic
before insert on deferred_capture_probe
for each row execute function roadops.validate_manual_inspection_iqn_topic();

do $test$
declare
  pothole_id uuid;
begin
  select id into strict pothole_id from roadops.defect_types
  where code = 'field.pavement.pothole' and active_from = date '2026-01-01';

  -- Physical capture is valid with no IQN selection and no published norm.
  insert into deferred_capture_probe values (
    pothole_id, 'm2', '2026-09-06 10:00:00+05', 'Chuqurchalar: 25.5 m2', null
  );
  if (select count(*) from deferred_capture_probe) <> 1 then
    raise exception 'Physical capture without IQN was not accepted';
  end if;

  begin
    insert into deferred_capture_probe values (
      pothole_id, 'm', '2026-09-06 10:00:00+05', 'Wrong dimension', null
    );
    raise exception 'Wrong physical unit was accepted';
  exception when check_violation then
    if sqlerrm not like '%physical type%' then raise; end if;
  end;

  begin
    insert into deferred_capture_probe values (
      pothole_id, 'm2', '2025-12-31 10:00:00+05', 'Before category effective date', null
    );
    raise exception 'Inactive defect type was accepted';
  exception when check_violation then
    if sqlerrm not like '%not active%' then raise; end if;
  end;

  begin
    insert into deferred_capture_probe values (
      pothole_id, 'm2', '2026-09-06 10:00:00+05', '   ', null
    );
    raise exception 'Blank physical issue was accepted';
  exception when check_violation then
    if sqlerrm not like '%must not be blank%' then raise; end if;
  end;
end
$test$;

create temporary table deferred_case_probe (
  source_kind text,
  inspection_observation_id uuid,
  iqn_topic_work_item_id uuid,
  observed_issue text,
  description text
);
create trigger copy_provenance
before insert on deferred_case_probe
for each row execute function roadops.copy_manual_inspection_iqn_topic();
insert into deferred_case_probe values (
  'roadvision', null, '81000000-0000-4000-8000-000000000003', null, 'Road AI measured crack'
);
do $test$
begin
  if not exists (
    select 1 from deferred_case_probe
    where iqn_topic_work_item_id is null and observed_issue = 'Road AI measured crack'
  ) then
    raise exception 'Road AI capture invented IQN or lost physical issue';
  end if;
end
$test$;

rollback;
