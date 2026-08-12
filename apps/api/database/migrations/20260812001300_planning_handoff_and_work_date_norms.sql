begin;

-- Planning previews can span several local work dates. The original evaluator
-- selected IQN mappings and norm sets at the run capture timestamp, which can
-- differ from an item's scheduled date. Patch the existing guarded evaluator
-- in place so all effective-date decisions use the item's local work date.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('roadops.rebuild_plan_core_blockers(uuid)'::regprocedure)
  into definition;

  if position(
    $needle$m.effective_from <= run_row.as_of::date$needle$ in definition
  ) = 0 or position(
    $needle$ns.effective_from <= run_row.as_of::date$needle$ in definition
  ) = 0 then
    raise exception 'Unexpected rebuild_plan_core_blockers definition; work-date migration was not applied';
  end if;

  definition := replace(
    definition,
    $needle$m.effective_from <= run_row.as_of::date$needle$,
    $replacement$m.effective_from <= coalesce(
          (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date,
          run_row.as_of::date
        )$replacement$
  );
  definition := replace(
    definition,
    $needle$m.effective_until > run_row.as_of::date$needle$,
    $replacement$m.effective_until > coalesce(
          (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date,
          run_row.as_of::date
        )$replacement$
  );
  definition := replace(
    definition,
    $needle$ns.effective_from <= run_row.as_of::date$needle$,
    $replacement$ns.effective_from <= coalesce(
          (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date,
          run_row.as_of::date
        )$replacement$
  );
  definition := replace(
    definition,
    $needle$ns.effective_until > run_row.as_of::date$needle$,
    $replacement$ns.effective_until > coalesce(
          (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date,
          run_row.as_of::date
        )$replacement$
  );

  -- An independent approver must be able to perform the same guarded rebuild
  -- immediately before approval even when their role does not include draft
  -- authoring permission.
  if position(
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$ in definition
  ) = 0 then
    raise exception 'Unexpected rebuild_plan_blockers permission guard';
  end if;
  definition := replace(
    definition,
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$,
    $replacement$if not (
    roadops.has_permission('planning.write', run_row.division_id)
    or roadops.has_permission('planning.approve', run_row.division_id)
  ) then$replacement$
  );
  execute definition;

  select pg_get_functiondef('roadops.rebuild_plan_assignment_blockers(uuid)'::regprocedure)
  into definition;
  if position(
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$ in definition
  ) = 0 then
    raise exception 'Unexpected rebuild_plan_assignment_blockers permission guard';
  end if;
  definition := replace(
    definition,
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$,
    $replacement$if not (
    roadops.has_permission('planning.write', run_row.division_id)
    or roadops.has_permission('planning.approve', run_row.division_id)
  ) then$replacement$
  );
  execute definition;

  select pg_get_functiondef('roadops.rebuild_plan_safety_blockers(uuid)'::regprocedure)
  into definition;
  if position(
    $needle$where pr.id = p_run_id and roadops.has_permission('planning.write', pr.division_id)$needle$ in definition
  ) = 0 then
    raise exception 'Unexpected rebuild_plan_safety_blockers permission guard';
  end if;
  definition := replace(
    definition,
    $needle$where pr.id = p_run_id and roadops.has_permission('planning.write', pr.division_id)$needle$,
    $replacement$where pr.id = p_run_id and (
      roadops.has_permission('planning.write', pr.division_id)
      or roadops.has_permission('planning.approve', pr.division_id)
    )$replacement$
  );
  execute definition;

  select pg_get_functiondef('roadops.add_equipment_operator_blockers(uuid)'::regprocedure)
  into definition;
  if position(
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$ in definition
  ) = 0 then
    raise exception 'Unexpected add_equipment_operator_blockers permission guard';
  end if;
  definition := replace(
    definition,
    $needle$if not roadops.has_permission('planning.write', run_row.division_id) then$needle$,
    $replacement$if not (
    roadops.has_permission('planning.write', run_row.division_id)
    or roadops.has_permission('planning.approve', run_row.division_id)
  ) then$replacement$
  );
  execute definition;
end
$migration$;

comment on function roadops.rebuild_plan_blockers(uuid) is
  'Rebuilds deterministic blockers and resource snapshots using each plan item scheduled local work date.';

commit;
