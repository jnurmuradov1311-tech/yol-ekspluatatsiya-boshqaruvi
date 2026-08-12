begin;

-- API callers are subject to road-unit RLS, but the single-road deployment
-- invariant must also detect a conflicting D001 spelling outside that scope.
-- Keep the elevated surface read-only and return counts only.
create or replace function roadops.primary_road_invariant()
returns table(candidate_count bigint, exact_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select count(distinct road.id) candidate_count,
         count(*) filter (
           where version.official_code = 'D001'
             and version.length_m = 67000::numeric
         ) exact_count
  from roadops.roads road
  join roadops.road_versions version
    on version.road_id = road.id
   and version.valid_from <= statement_timestamp()
   and (version.valid_until is null or version.valid_until > statement_timestamp())
  where (road.retired_at is null or road.retired_at > statement_timestamp())
    and lower(version.official_code) = lower('D001')
$function$;

revoke all on function roadops.primary_road_invariant() from public;
grant execute on function roadops.primary_road_invariant() to roadops_api;

-- Approval and publication call this before their transaction snapshot is
-- established. SHARE locks prevent a YTP version switch until the guarded
-- workflow commits, closing the source-version TOCTOU window.
create or replace function roadops.lock_primary_road_invariant()
returns table(candidate_count bigint, exact_count bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  lock table roadops.roads in share mode;
  lock table roadops.road_versions in share mode;

  return query select * from roadops.primary_road_invariant();
end
$function$;

revoke all on function roadops.lock_primary_road_invariant() from public;
grant execute on function roadops.lock_primary_road_invariant() to roadops_api;

commit;
