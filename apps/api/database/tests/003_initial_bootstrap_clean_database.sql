-- Run on a clean migrated database BEFORE any fixture. Transaction rolls back.
begin;
set local role roadops_api;

do $test$
declare
  admin_id uuid;
  factor_id uuid;
begin
  admin_id := roadops.bootstrap_first_admin(
    'first-admin@test.invalid',
    '$2y$12$012345678901234567890u012345678901234567890123456789012',
    'First Test Administrator',
    gen_random_uuid()
  );
  if admin_id is null then
    raise exception 'Initial admin bootstrap did not return an id';
  end if;

  factor_id := roadops.complete_initial_totp_enrollment(
    admin_id, 'Initial test TOTP', decode(repeat('ab', 32), 'hex'), 123456,
    gen_random_uuid()
  );
  if factor_id is null then
    raise exception 'Initial TOTP enrollment did not return a factor id';
  end if;
  if not exists (
    select 1 from roadops.lookup_login_identity('first-admin@test.invalid') li
    where li.user_id = admin_id and li.mfa_required and li.totp_factor_id = factor_id
      and li.totp_last_used_counter = 123456
  ) then
    raise exception 'Bootstrap login identity is incomplete';
  end if;

  begin
    perform roadops.bootstrap_first_admin(
      'second@test.invalid', repeat('x', 30), 'Second', gen_random_uuid()
    );
    raise exception 'Second initial admin was unexpectedly allowed';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end
$test$;

rollback;
