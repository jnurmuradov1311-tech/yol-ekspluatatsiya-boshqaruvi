begin;

-- A month may contain immutable accepted acts plus one editable supplement.
-- Source uniqueness on work_order_id, completion_record_id and actual-cost
-- source IDs remains global: a supplement cannot bill the same source twice.
alter table roadops.monthly_completion_acts
  drop constraint monthly_completion_acts_division_id_act_month_key,
  add column supplement_no integer not null default 1 check (supplement_no > 0),
  add constraint monthly_completion_acts_supplement_uk
    unique (division_id, act_month, supplement_no);
create unique index monthly_completion_acts_one_draft_idx
  on roadops.monthly_completion_acts (division_id, act_month)
  where status = 'draft';

create or replace function roadops.prepare_monthly_completion_act()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  -- Use the same lock as verification, payroll capture and act freezing.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.division_id::text || ':' || extract(year from new.act_month)::integer::text,
    20260818));
  select coalesce(max(a.supplement_no), 0) + 1 into new.supplement_no
  from roadops.monthly_completion_acts a
  where a.division_id = new.division_id and a.act_month = new.act_month;
  select dv.name into new.division_name_snapshot
  from roadops.road_division_versions dv
  where dv.division_id = new.division_id and dv.valid_until is null;
  select u.full_name into new.created_by_name_snapshot
  from roadops.app_users u where u.id = new.created_by;
  if coalesce(btrim(new.division_name_snapshot), '') = ''
     or coalesce(btrim(new.created_by_name_snapshot), '') = '' then
    raise exception using errcode = '23514',
      message = 'Monthly act requires current division and preparer display snapshots';
  end if;
  return new;
end $function$;

create function roadops.guard_monthly_act_supplement_order()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  -- Never renumber/rehome an act, including a draft. Historical hash algorithms
  -- remain untouched; this immutable metadata cannot change behind a frozen hash.
  if new.supplement_no is distinct from old.supplement_no
     or new.division_id is distinct from old.division_id
     or new.act_month is distinct from old.act_month then
    raise exception using errcode = '55000', message = 'MONTHLY_ACT_IDENTITY_IMMUTABLE';
  end if;
  if old.status is distinct from new.status and new.status in ('submitted', 'approved') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.division_id::text || ':' || extract(year from new.act_month)::integer::text,
      20260818));
    if exists (
      select 1 from roadops.monthly_completion_acts earlier
      where earlier.division_id = new.division_id
        and earlier.act_month = new.act_month
        and earlier.supplement_no < new.supplement_no
        and earlier.status <> 'approved'
    ) then
      raise exception using errcode = '55000', message = 'MONTHLY_ACT_PREVIOUS_SUPPLEMENT_NOT_APPROVED';
    end if;
    if exists (
      select 1 from roadops.monthly_completion_acts later
      where later.division_id = new.division_id
        and later.act_month = new.act_month
        and later.supplement_no > new.supplement_no
        and later.status in ('submitted', 'approved')
    ) then
      raise exception using errcode = '55000', message = 'MONTHLY_ACT_LATER_SUPPLEMENT_ALREADY_FROZEN';
    end if;
  end if;
  return new;
end $function$;
create trigger monthly_completion_acts_aa_supplement_order
  before update on roadops.monthly_completion_acts
  for each row execute function roadops.guard_monthly_act_supplement_order();

create or replace function roadops.guard_monthly_act_verified_work_completeness()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if old.status is distinct from new.status and new.status in ('submitted', 'approved') then
    if exists (
      select 1 from roadops.monthly_completion_act_items item
      where item.act_id = new.id and (
        item.iqn_norm_set_id_snapshot is null
        or item.iqn_labor_norm_line_ids_snapshot is null
        or item.iqn_basis_quantity_snapshot is null
        or item.iqn_basis_unit_snapshot is null
        or item.iqn_labor_minutes_per_basis_snapshot is null
        or item.iqn_labor_minutes_per_unit_snapshot is null
        or item.iqn_total_labor_minutes_snapshot is null)
    ) then
      raise exception using errcode = '23514', message = 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING';
    end if;
  end if;
  -- Submission snapshots all currently verified, unbilled work. Approval verifies
  -- that frozen snapshot; work verified afterwards belongs to a new supplement.
  if old.status = 'draft' and new.status = 'submitted' then
    if exists (
      select 1 from roadops.work_orders wo
      join roadops.plan_items plan_item on plan_item.id = wo.plan_item_id
      join roadops.planning_runs planning_run on planning_run.id = plan_item.planning_run_id
      join roadops.work_completion_records completion on completion.work_order_id = wo.id
      where planning_run.division_id = new.division_id
        and wo.status = 'verified' and wo.completed_at is not null
        and completion.verified_at is not null and completion.verified_by is not null
        and (wo.completed_at at time zone 'Asia/Tashkent')::date >= new.act_month
        and (wo.completed_at at time zone 'Asia/Tashkent')::date
          < (new.act_month + interval '1 month')::date
        and not exists (
          select 1 from roadops.monthly_completion_act_items included
          join roadops.monthly_completion_acts included_act on included_act.id = included.act_id
          where included.work_order_id = wo.id
            and included.completion_record_id = completion.id
            and included_act.division_id = new.division_id
            and included_act.act_month = new.act_month
            and (included_act.id = new.id or (
              included_act.status = 'approved'
              and included_act.supplement_no < new.supplement_no))
        )
    ) then
      raise exception using errcode = '23514', message = 'MONTHLY_ACT_VERIFIED_WORK_MISSING';
    end if;
  end if;
  return new;
end $function$;

create or replace function roadops.reject_late_verification_for_closed_act_month()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare work_division_id uuid; completion_date date;
begin
  if old.status is distinct from 'verified' and new.status = 'verified' then
    work_division_id := roadops.division_for_work_order(new.id);
    completion_date := (new.completed_at at time zone 'Asia/Tashkent')::date;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      work_division_id::text || ':' || extract(year from completion_date)::integer::text,
      20260818));
    -- Same-month work remains possible. A frozen later month already contains
    -- its YTD snapshot, so earlier-month backfills need a correction workflow.
    if exists (
      select 1 from roadops.monthly_completion_acts act
      where act.division_id = work_division_id
        and act.act_month > date_trunc('month', completion_date)::date
        and extract(year from act.act_month) = extract(year from completion_date)
        and act.status in ('submitted', 'approved')
    ) then
      raise exception using errcode = '55000', message = 'MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION';
    end if;
  end if;
  return new;
end $function$;

-- The existing refresh function sums unique act items (each has globally unique
-- work_order_id/completion_record_id), never joining rows of cost lines into
-- quantities. Its approved-prior-or-current predicate already includes approved
-- same-month supplements. Recompute only the draft; prior hashes remain intact.
revoke all on function roadops.prepare_monthly_completion_act(),
  roadops.guard_monthly_act_supplement_order(),
  roadops.guard_monthly_act_verified_work_completeness(),
  roadops.reject_late_verification_for_closed_act_month() from public;
commit;
