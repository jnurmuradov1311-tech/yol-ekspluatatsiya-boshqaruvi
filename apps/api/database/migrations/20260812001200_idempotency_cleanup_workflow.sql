begin;

-- Scheduler-only maintenance path. It is bounded and exposes no caller-chosen
-- predicate, so it cannot delete live records or another actor's unexpired key.
create or replace function roadops.cleanup_expired_idempotency_keys(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_count integer;
begin
  if p_limit < 1 or p_limit > 10000 then
    raise exception using errcode = '22023',
      message = 'Idempotency cleanup limit must be between 1 and 10000';
  end if;

  with expired as (
    select k.id
    from roadops.idempotency_keys k
    where k.expires_at <= clock_timestamp()
    order by k.expires_at, k.id
    for update skip locked
    limit p_limit
  )
  delete from roadops.idempotency_keys k
  using expired
  where k.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$function$;

revoke all on function roadops.cleanup_expired_idempotency_keys(integer) from public;
revoke all on function roadops.cleanup_expired_idempotency_keys(integer) from roadops_api;
grant execute on function roadops.cleanup_expired_idempotency_keys(integer) to roadops_sync;

commit;
