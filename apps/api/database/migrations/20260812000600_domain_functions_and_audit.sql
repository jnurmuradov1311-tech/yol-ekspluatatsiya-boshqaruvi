begin;

create or replace function roadops.bootstrap_first_admin(
  p_email text,
  p_password_hash text,
  p_full_name text,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  created_user_id uuid;
  admin_role_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('roadops.bootstrap_first_admin'));
  if exists (select 1 from roadops.app_users) then
    raise exception using errcode = '55000', message = 'Initial administrator already exists';
  end if;
  if coalesce(btrim(p_email), '') = ''
     or coalesce(btrim(p_full_name), '') = ''
     or length(coalesce(p_password_hash, '')) < 20 then
    raise exception using errcode = '22023', message = 'Valid email, full name, and application password hash are required';
  end if;
  select r.id into admin_role_id from roadops.roles r where r.code = 'system_admin';
  if admin_role_id is null then
    raise exception using errcode = '55000', message = 'System administrator role is not seeded';
  end if;
  if p_request_id is not null then
    perform set_config('roadops.request_id', p_request_id::text, true);
  end if;

  insert into roadops.app_users (
    email, password_hash, full_name, status, mfa_required, email_verified_at
  ) values (
    p_email, p_password_hash, p_full_name, 'active', true, clock_timestamp()
  ) returning id into created_user_id;
  insert into roadops.password_history (
    user_id, password_hash, changed_by, reason
  ) values (created_user_id, p_password_hash, created_user_id, 'created');
  insert into roadops.user_role_memberships (
    user_id, role_id, division_id, valid_from, granted_by
  ) values (
    created_user_id, admin_role_id, null, clock_timestamp(), created_user_id
  );
  insert into roadops.audit_events (
    actor_user_id, request_id, action, entity_type, entity_id,
    after_data, request_context
  ) values (
    created_user_id, p_request_id, 'SYSTEM_BOOTSTRAP_ADMIN', 'app_user',
    created_user_id::text, jsonb_build_object('email', p_email, 'mfa_required', true),
    jsonb_build_object('bootstrap', true)
  );
  return created_user_id;
end
$function$;

create or replace function roadops.complete_initial_totp_enrollment(
  p_user_id uuid,
  p_label text,
  p_secret_ciphertext bytea,
  p_verified_counter bigint,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  factor_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('roadops.bootstrap_first_admin'));
  if p_secret_ciphertext is null or octet_length(p_secret_ciphertext) < 16
     or coalesce(btrim(p_label), '') = ''
     or p_verified_counter is null or p_verified_counter < 0 then
    raise exception using errcode = '22023', message = 'Encrypted TOTP seed, label, and verified counter are required';
  end if;
  if (select count(*) from roadops.app_users) <> 1
     or not exists (
       select 1
       from roadops.app_users u
       join roadops.user_role_memberships m on m.user_id = u.id
       join roadops.roles r on r.id = m.role_id and r.code = 'system_admin'
       where u.id = p_user_id and u.status = 'active' and u.mfa_required
         and u.last_login_at is null and m.division_id is null and m.valid_until is null
     )
     or exists (select 1 from roadops.auth_sessions s where s.user_id = p_user_id)
     or exists (
       select 1 from roadops.login_attempts la
       where la.user_id = p_user_id and la.succeeded
     )
     or exists (select 1 from roadops.user_mfa_factors f where f.user_id = p_user_id) then
    raise exception using errcode = '55000', message = 'Initial TOTP enrollment preconditions are not satisfied';
  end if;
  if p_request_id is not null then
    perform set_config('roadops.request_id', p_request_id::text, true);
  end if;

  insert into roadops.user_mfa_factors (
    user_id, factor_type, label, secret_ciphertext, last_used_counter,
    status, verified_at
  ) values (
    p_user_id, 'totp', p_label, p_secret_ciphertext, p_verified_counter,
    'verified', clock_timestamp()
  ) returning id into factor_id;
  insert into roadops.audit_events (
    actor_user_id, request_id, action, entity_type, entity_id, after_data, request_context
  ) values (
    p_user_id, p_request_id, 'AUTH_INITIAL_TOTP_ENROLLED', 'user_mfa_factor',
    factor_id::text, jsonb_build_object('factor_type', 'totp', 'verified', true),
    jsonb_build_object('bootstrap', true)
  );
  return factor_id;
end
$function$;

create or replace function roadops.lookup_login_identity(p_email text)
returns table (
  user_id uuid,
  email text,
  password_hash text,
  status text,
  mfa_required boolean,
  locked_until timestamptz,
  totp_factor_id uuid,
  totp_secret_ciphertext bytea,
  totp_last_used_counter bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select u.id, u.email::text, u.password_hash, u.status, u.mfa_required, u.locked_until,
         factor.id, factor.secret_ciphertext, factor.last_used_counter
  from roadops.app_users u
  left join lateral (
    select f.id, f.secret_ciphertext, f.last_used_counter
    from roadops.user_mfa_factors f
    where f.user_id = u.id and f.factor_type = 'totp' and f.status = 'verified'
    order by f.verified_at desc, f.id
    limit 1
  ) factor on true
  where u.email = p_email::extensions.citext
  limit 1
$function$;

create or replace function roadops.consume_totp_counter(
  p_user_id uuid,
  p_factor_id uuid,
  p_counter bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_counter is null or p_counter < 0 then
    return false;
  end if;
  update roadops.user_mfa_factors f
  set last_used_counter = p_counter
  where f.id = p_factor_id and f.user_id = p_user_id
    and f.factor_type = 'totp' and f.status = 'verified'
    and (f.last_used_counter is null or f.last_used_counter < p_counter);
  return found;
end
$function$;

create or replace function roadops.record_login_failure(
  p_email text,
  p_failure_code text,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id uuid default null
)
returns table (failed_login_count integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_row roadops.app_users%rowtype;
  next_count integer := 0;
  next_lock timestamptz;
begin
  if coalesce(btrim(p_email), '') = '' or coalesce(btrim(p_failure_code), '') = '' then
    raise exception using errcode = '22023', message = 'Email and failure code are required';
  end if;
  if p_request_id is not null then
    perform set_config('roadops.request_id', p_request_id::text, true);
  end if;

  select u.* into user_row
  from roadops.app_users u
  where u.email = p_email::extensions.citext
  for update;

  if found then
    next_count := user_row.failed_login_count + 1;
    next_lock := case
      when next_count >= 5
      then greatest(coalesce(user_row.locked_until, '-infinity'::timestamptz),
                    clock_timestamp() + interval '15 minutes')
      else user_row.locked_until
    end;
    update roadops.app_users
    set failed_login_count = next_count, locked_until = next_lock,
        row_version = row_version + 1
    where id = user_row.id;
  end if;

  insert into roadops.login_attempts (
    email, user_id, succeeded, failure_code, ip_address, user_agent, request_id
  ) values (
    p_email, user_row.id, false, p_failure_code, p_ip_address, p_user_agent, p_request_id
  );

  return query select next_count, next_lock;
end
$function$;

create or replace function roadops.complete_login(
  p_user_id uuid,
  p_token_hash text,
  p_csrf_hash text,
  p_expires_at timestamptz,
  p_absolute_expires_at timestamptz,
  p_mfa_factor_id uuid default null,
  p_totp_counter bigint default null,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_row roadops.app_users%rowtype;
  created_session_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$'
     or p_csrf_hash is null or p_csrf_hash !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'Token and CSRF hashes must be 64 hexadecimal characters';
  end if;
  if p_expires_at <= clock_timestamp()
     or p_absolute_expires_at < p_expires_at
     or p_absolute_expires_at > clock_timestamp() + interval '31 days' then
    raise exception using errcode = '22023', message = 'Invalid session expiry window';
  end if;
  if p_request_id is not null then
    perform set_config('roadops.request_id', p_request_id::text, true);
  end if;

  select u.* into user_row
  from roadops.app_users u where u.id = p_user_id for update;
  if not found or user_row.status <> 'active'
     or (user_row.locked_until is not null and user_row.locked_until > clock_timestamp()) then
    raise exception using errcode = '28000', message = 'Login cannot be completed';
  end if;

  if user_row.mfa_required then
    if p_mfa_factor_id is null or p_totp_counter is null or p_totp_counter < 0 then
      raise exception using errcode = '28000', message = 'Verified MFA counter is required';
    end if;
    update roadops.user_mfa_factors f
    set last_used_counter = p_totp_counter
    where f.id = p_mfa_factor_id and f.user_id = user_row.id
      and f.factor_type = 'totp' and f.status = 'verified'
      and (f.last_used_counter is null or f.last_used_counter < p_totp_counter);
    if not found then
      raise exception using errcode = '28000', message = 'MFA counter was already used or factor is invalid';
    end if;
  end if;

  insert into roadops.auth_sessions (
    user_id, token_hash, csrf_token_hash, expires_at, absolute_expires_at,
    ip_address, user_agent, created_request_id
  ) values (
    user_row.id, decode(lower(p_token_hash), 'hex'), decode(lower(p_csrf_hash), 'hex'),
    p_expires_at, p_absolute_expires_at, p_ip_address, p_user_agent, p_request_id
  ) returning id into created_session_id;

  update roadops.app_users
  set failed_login_count = 0, locked_until = null, last_login_at = clock_timestamp(),
      row_version = row_version + 1
  where id = user_row.id;

  insert into roadops.login_attempts (
    email, user_id, succeeded, ip_address, user_agent, request_id
  ) values (
    user_row.email, user_row.id, true, p_ip_address, p_user_agent, p_request_id
  );

  insert into roadops.audit_events (
    actor_user_id, session_id, request_id, action, entity_type, entity_id,
    after_data, request_context
  ) values (
    user_row.id, created_session_id, p_request_id, 'AUTH_LOGIN', 'app_user',
    user_row.id::text,
    jsonb_build_object('session_id', created_session_id),
    jsonb_build_object('ip_address', p_ip_address, 'user_agent', p_user_agent)
  );

  return created_session_id;
end
$function$;

create or replace function roadops.authenticate_session(p_token_hash text)
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  full_name text,
  status text,
  expires_at timestamptz,
  csrf_hash text,
  permissions text[],
  road_unit_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9A-Fa-f]{64}$' then
    return;
  end if;

  return query
  with valid_session as (
    select s.*, u.email::text as user_email, u.full_name as user_full_name,
           u.status as user_status
    from roadops.auth_sessions s
    join roadops.app_users u on u.id = s.user_id
    where s.token_hash = decode(lower(p_token_hash), 'hex')
      and s.revoked_at is null
      and s.expires_at > statement_timestamp()
      and s.absolute_expires_at > statement_timestamp()
      and u.status = 'active'
    limit 1
  ), active_memberships as (
    select m.*
    from roadops.user_role_memberships m
    join valid_session vs on vs.user_id = m.user_id
    where m.valid_from <= statement_timestamp()
      and (m.valid_until is null or m.valid_until > statement_timestamp())
  )
  select
    vs.id,
    vs.user_id,
    vs.user_email,
    vs.user_full_name,
    vs.user_status,
    vs.expires_at,
    encode(vs.csrf_token_hash, 'hex'),
    coalesce((
      select array_agg(distinct p.code order by p.code)
      from active_memberships am
      join roadops.role_permissions rp on rp.role_id = am.role_id
      join roadops.permissions p on p.id = rp.permission_id
    ), array[]::text[]),
    case
      when exists (select 1 from active_memberships am where am.division_id is null)
      then coalesce((
        select array_agg(d.id order by d.id)
        from roadops.road_divisions d where d.retired_at is null
      ), array[]::uuid[])
      else coalesce((
        select array_agg(distinct am.division_id order by am.division_id)
        from active_memberships am where am.division_id is not null
      ), array[]::uuid[])
    end
  from valid_session vs;
end
$function$;

comment on function roadops.authenticate_session(text) is
  'Looks up an active session from a lowercase/uppercase hex SHA-256 token hash; never accepts a plaintext cookie token.';

create or replace function roadops.logout_session(
  p_session_id uuid,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  session_owner_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor context is required';
  end if;
  if p_request_id is not null then
    perform set_config('roadops.request_id', p_request_id::text, true);
  end if;

  select s.user_id into session_owner_id
  from roadops.auth_sessions s where s.id = p_session_id for update;
  if not found or session_owner_id <> actor_id then
    raise exception using errcode = '42501', message = 'Session does not belong to the authenticated actor';
  end if;

  update roadops.auth_sessions
  set revoked_at = coalesce(revoked_at, clock_timestamp()),
      revocation_reason = coalesce(revocation_reason, 'user_logout')
  where id = p_session_id;

  insert into roadops.audit_events (
    actor_user_id, session_id, request_id, action, entity_type, entity_id,
    after_data, request_context
  ) values (
    actor_id, p_session_id, p_request_id, 'AUTH_LOGOUT', 'auth_session',
    p_session_id::text, jsonb_build_object('revoked', true),
    jsonb_build_object('ip_address', p_ip_address, 'user_agent', p_user_agent)
  );
  return true;
end
$function$;

create or replace function roadops.match_roadvision_candidate(
  p_candidate_id uuid,
  p_road_id uuid,
  p_road_element_id uuid,
  p_defect_type_id uuid,
  p_chainage_span numrange
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  candidate roadops.roadvision_candidates%rowtype;
  division_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor context is required';
  end if;
  select c.* into candidate
  from roadops.roadvision_candidates c where c.id = p_candidate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RoadVision candidate not found';
  end if;
  if candidate.status not in ('received', 'unmatched', 'awaiting_verification') then
    raise exception using errcode = '55000', message = 'Final RoadVision candidate cannot be rematched';
  end if;
  if candidate.attribute_catalog_id is null or exists (
    select 1 from roadops.roadvision_attribute_catalog ac
    where ac.id = candidate.attribute_catalog_id
      and ac.record_kind <> 'defect_candidate'
  ) then
    raise exception using errcode = '23514', message = 'Only a classified defect_candidate attribute can be matched';
  end if;

  select rv.division_id into division_id
  from roadops.road_versions rv
  where rv.road_id = p_road_id
    and rv.valid_from <= candidate.observed_at
    and (rv.valid_until is null or rv.valid_until > candidate.observed_at)
  order by rv.valid_from desc limit 1;
  if division_id is null or not roadops.has_permission('defects.verify', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot match candidates for this division';
  end if;
  if p_road_element_id is not null and not exists (
    select 1 from roadops.road_element_versions ev
    where ev.road_element_id = p_road_element_id and ev.road_id = p_road_id
      and ev.valid_from <= candidate.observed_at
      and (ev.valid_until is null or ev.valid_until > candidate.observed_at)
  ) then
    raise exception using errcode = '23514', message = 'Road element does not belong to the selected road';
  end if;
  if not exists (
    select 1 from roadops.defect_types dt
    where dt.id = p_defect_type_id
      and dt.active_from <= candidate.observed_at::date
      and (dt.active_until is null or dt.active_until > candidate.observed_at::date)
  ) then
    raise exception using errcode = '23514', message = 'Defect type is not active at observation time';
  end if;

  update roadops.roadvision_candidates
  set road_id = p_road_id,
      road_element_id = p_road_element_id,
      defect_type_id = p_defect_type_id,
      chainage_span = p_chainage_span,
      status = 'awaiting_verification'
  where id = p_candidate_id;

  insert into roadops.roadvision_candidate_events (
    candidate_id, from_status, to_status, event_code, actor_user_id, details, request_id
  ) values (
    p_candidate_id, candidate.status, 'awaiting_verification', 'human_match', actor_id,
    jsonb_build_object(
      'road_id', p_road_id, 'road_element_id', p_road_element_id,
      'defect_type_id', p_defect_type_id, 'chainage_span', p_chainage_span
    ), roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.verify_roadvision_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_measured_quantity numeric default null,
  p_measurement_unit text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  candidate roadops.roadvision_candidates%rowtype;
  division_id uuid;
  created_defect_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor context is required';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception using errcode = '22023', message = 'Decision must be confirmed or rejected';
  end if;

  select c.* into candidate
  from roadops.roadvision_candidates c
  where c.id = p_candidate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RoadVision candidate not found';
  end if;
  if (p_decision = 'confirmed' and candidate.status <> 'awaiting_verification')
     or (p_decision = 'rejected'
         and candidate.status not in ('received', 'unmatched', 'awaiting_verification')) then
    raise exception using errcode = '55000', message = 'Candidate is not in a human-verifiable state';
  end if;

  select rv.division_id into division_id
  from roadops.road_versions rv
  where rv.road_id = candidate.road_id
    and rv.valid_from <= candidate.observed_at
    and (rv.valid_until is null or rv.valid_until > candidate.observed_at)
  order by rv.valid_from desc limit 1;

  if (division_id is not null and not roadops.has_permission('defects.verify', division_id))
     or (division_id is null and not roadops.has_permission('defects.verify', null)) then
    raise exception using errcode = '42501', message = 'Actor cannot verify this division candidate';
  end if;
  if p_decision = 'confirmed' and (
    candidate.road_id is null or candidate.defect_type_id is null or candidate.chainage_span is null
    or p_measured_quantity is null or p_measured_quantity <= 0
    or p_measurement_unit is null or btrim(p_measurement_unit) = ''
  ) then
    raise exception using errcode = '23514', message = 'Confirmed candidate requires road, defect, chainage, quantity, and unit';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = '23514', message = 'Rejected candidate requires a note';
  end if;

  insert into roadops.roadvision_candidate_verifications (
    candidate_id, decision, verified_by, measured_quantity, measurement_unit, note, request_id
  ) values (
    candidate.id, p_decision, actor_id, p_measured_quantity, p_measurement_unit,
    p_note, roadops.current_request_id()
  );

  update roadops.roadvision_candidates
  set status = p_decision
  where id = candidate.id;

  insert into roadops.roadvision_candidate_events (
    candidate_id, from_status, to_status, event_code, actor_user_id, details, request_id
  ) values (
    candidate.id, candidate.status, p_decision, 'human_verification', actor_id,
    jsonb_build_object('note', p_note), roadops.current_request_id()
  );

  if p_decision = 'confirmed' then
    insert into roadops.defect_cases (
      source_kind, roadvision_candidate_id, road_id, road_element_id, defect_type_id,
      chainage_span, observed_at, verified_at, verified_by, measured_quantity,
      measurement_unit, description
    ) values (
      'roadvision', candidate.id, candidate.road_id, candidate.road_element_id,
      candidate.defect_type_id, candidate.chainage_span, candidate.observed_at,
      clock_timestamp(), actor_id, p_measured_quantity, p_measurement_unit, p_note
    ) returning id into created_defect_id;

    insert into roadops.defect_case_events (
      defect_case_id, from_status, to_status, event_code, actor_user_id, note, request_id
    ) values (
      created_defect_id, null, 'open', 'created_from_verified_roadvision', actor_id,
      p_note, roadops.current_request_id()
    );
  end if;

  return created_defect_id;
end
$function$;

create or replace function roadops.submit_inspection(p_inspection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  inspection roadops.inspections%rowtype;
begin
  select i.* into inspection
  from roadops.inspections i where i.id = p_inspection_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inspection not found';
  end if;
  if inspection.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'Only draft or returned inspection can be submitted';
  end if;
  if actor_id is null or actor_id <> inspection.inspector_user_id
     or not roadops.has_permission('defects.capture', inspection.division_id) then
    raise exception using errcode = '42501', message = 'Only the assigned inspector can submit this inspection';
  end if;
  if not exists (
    select 1 from roadops.inspection_observations o where o.inspection_id = inspection.id
  ) then
    raise exception using errcode = '23514', message = 'Inspection must contain at least one observation';
  end if;
  if exists (
    select 1 from roadops.inspection_observations o
    where o.inspection_id = inspection.id and o.review_status <> 'pending'
  ) then
    raise exception using errcode = '23514', message = 'Returned inspection contains a finalized observation';
  end if;

  update roadops.inspections
  set status = 'submitted', submitted_at = clock_timestamp(),
      inspection_completed_at = coalesce(inspection_completed_at, clock_timestamp())
  where id = inspection.id;
  insert into roadops.inspection_events (
    inspection_id, from_status, to_status, event_code, actor_user_id, request_id
  ) values (
    inspection.id, inspection.status, 'submitted', 'inspection_submitted', actor_id,
    roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.return_inspection(
  p_inspection_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  inspection roadops.inspections%rowtype;
begin
  select i.* into inspection
  from roadops.inspections i where i.id = p_inspection_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inspection not found';
  end if;
  if inspection.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'Only submitted inspection can be returned';
  end if;
  if actor_id is null or actor_id = inspection.inspector_user_id
     or not roadops.has_permission('defects.verify', inspection.division_id) then
    raise exception using errcode = '42501', message = 'Independent verifier is required';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = '23514', message = 'Return note is required';
  end if;
  if exists (
    select 1 from roadops.inspection_observations o
    where o.inspection_id = inspection.id and o.review_status <> 'pending'
  ) then
    raise exception using errcode = '55000', message = 'Inspection with reviewed observations cannot be returned';
  end if;

  update roadops.inspections
  set status = 'returned', returned_at = clock_timestamp(), returned_by = actor_id,
      return_note = p_note
  where id = inspection.id;
  insert into roadops.inspection_events (
    inspection_id, from_status, to_status, event_code, actor_user_id, note, request_id
  ) values (
    inspection.id, 'submitted', 'returned', 'inspection_returned', actor_id, p_note,
    roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.review_inspection_observation(
  p_observation_id uuid,
  p_decision text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  observation roadops.inspection_observations%rowtype;
  inspection roadops.inspections%rowtype;
  created_defect_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Observation decision must be approved or rejected';
  end if;
  select o.* into observation
  from roadops.inspection_observations o where o.id = p_observation_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Inspection observation not found';
  end if;
  select i.* into inspection
  from roadops.inspections i where i.id = observation.inspection_id for update;
  if inspection.status <> 'submitted' or observation.review_status <> 'pending' then
    raise exception using errcode = '55000', message = 'Observation is not pending review';
  end if;
  if actor_id is null or actor_id = inspection.inspector_user_id
     or not roadops.has_permission('defects.verify', inspection.division_id) then
    raise exception using errcode = '42501', message = 'Independent verifier is required';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = '23514', message = 'Rejected observation requires a note';
  end if;

  update roadops.inspection_observations
  set review_status = p_decision, reviewed_at = clock_timestamp(), reviewed_by = actor_id,
      review_note = p_note
  where id = observation.id;

  insert into roadops.inspection_events (
    inspection_id, observation_id, from_status, to_status, event_code,
    actor_user_id, note, request_id
  ) values (
    inspection.id, observation.id, 'pending', p_decision, 'observation_reviewed',
    actor_id, p_note, roadops.current_request_id()
  );

  if p_decision = 'approved' then
    insert into roadops.defect_cases (
      source_kind, inspection_observation_id, road_id, road_element_id, defect_type_id,
      chainage_span, observed_at, verified_at, verified_by, measured_quantity,
      measurement_unit, description
    ) values (
      'manual_inspection', observation.id, inspection.road_id, observation.road_element_id,
      observation.defect_type_id, observation.chainage_span, observation.observed_at,
      clock_timestamp(), actor_id, observation.measured_quantity,
      observation.measurement_unit, observation.description
    ) returning id into created_defect_id;

    insert into roadops.defect_case_events (
      defect_case_id, from_status, to_status, event_code, actor_user_id, note, request_id
    ) values (
      created_defect_id, null, 'open', 'created_from_approved_inspection', actor_id,
      p_note, roadops.current_request_id()
    );
  end if;

  if not exists (
    select 1 from roadops.inspection_observations o
    where o.inspection_id = inspection.id and o.review_status = 'pending'
  ) then
    update roadops.inspections
    set status = 'approved', approved_at = clock_timestamp(), approved_by = actor_id
    where id = inspection.id;
    insert into roadops.inspection_events (
      inspection_id, from_status, to_status, event_code, actor_user_id, request_id
    ) values (
      inspection.id, 'submitted', 'approved', 'inspection_review_completed', actor_id,
      roadops.current_request_id()
    );
  end if;

  return created_defect_id;
end
$function$;

create or replace function roadops.put_plan_blocker(
  p_run_id uuid,
  p_plan_item_id uuid,
  p_code text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signature bytea;
begin
  signature := extensions.digest(
    convert_to(
      concat_ws('|', p_run_id::text, coalesce(p_plan_item_id::text, ''), p_code,
                coalesce(p_entity_type, ''), coalesce(p_entity_id::text, '')),
      'UTF8'
    ),
    'sha256'
  );
  insert into roadops.planning_blockers (
    planning_run_id, plan_item_id, blocker_code, entity_type, entity_id,
    details, deterministic_signature, source
  ) values (
    p_run_id, p_plan_item_id, p_code, p_entity_type, p_entity_id,
    coalesce(p_details, '{}'::jsonb), signature, 'engine'
  )
  on conflict (planning_run_id, deterministic_signature) do update
    set details = excluded.details,
        detected_at = clock_timestamp(),
        resolved_at = null,
        source = 'engine';
end
$function$;

create or replace function roadops.rebuild_plan_blockers(p_run_id uuid)
returns table (blocker_code text, blocker_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row roadops.planning_runs%rowtype;
  item record;
  schedule_date date;
  active_norm_set_id uuid;
  iqn_component_count integer;
  snapshot_component_count integer;
  needed_minutes integer;
  assigned_minutes integer;
  needed_equipment numeric;
  reserved_equipment numeric;
  needed_material numeric;
  reserved_material numeric;
begin
  select r.* into run_row
  from roadops.planning_runs r where r.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if run_row.status not in ('draft', 'evaluated') then
    raise exception using errcode = '55000', message = 'Only draft or evaluated plan can be rebuilt';
  end if;
  if not roadops.has_permission('planning.write', run_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot evaluate this division plan';
  end if;

  update roadops.planning_blockers b
  set resolved_at = clock_timestamp()
  where b.planning_run_id = p_run_id and b.source = 'engine' and b.resolved_at is null;

  if not exists (select 1 from roadops.plan_items pi where pi.planning_run_id = p_run_id) then
    perform roadops.put_plan_blocker(
      p_run_id, null, 'PLAN_EMPTY', 'planning_run', p_run_id,
      jsonb_build_object('message', 'Plan contains no work items')
    );
  end if;

  for item in
    select pi.*, dc.status as defect_status, dc.defect_type_id,
           api.annual_program_id, ap.status as annual_program_status,
           v.formula_type, v.formula_parameters as variant_formula_parameters,
           v.basis_quantity, v.basis_unit, v.interpretation_status,
           v.planning_status as variant_planning_status
    from roadops.plan_items pi
    left join roadops.defect_cases dc on dc.id = pi.defect_case_id
    left join roadops.annual_program_items api on api.id = pi.annual_program_item_id
    left join roadops.annual_programs ap on ap.id = api.annual_program_id
    left join roadops.iqn_work_variants v on v.id = pi.work_variant_id
    where pi.planning_run_id = p_run_id and pi.status <> 'cancelled'
    order by pi.id
  loop
    if not exists (
      select 1 from roadops.road_versions rv
      where rv.road_id = item.road_id
        and rv.valid_from <= run_row.as_of
        and (rv.valid_until is null or rv.valid_until > run_row.as_of)
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ROAD_SOURCE_VERSION_UNAVAILABLE', 'road', item.road_id,
        jsonb_build_object('as_of', run_row.as_of)
      );
    end if;

    if item.defect_case_id is not null and item.defect_status not in ('open', 'planned') then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'DEFECT_NOT_PLANNABLE', 'defect_case', item.defect_case_id,
        jsonb_build_object('status', item.defect_status)
      );
    end if;

    if item.annual_program_item_id is not null and item.annual_program_status <> 'approved' then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ANNUAL_PROGRAM_NOT_APPROVED', 'annual_program', item.annual_program_id,
        jsonb_build_object('status', item.annual_program_status)
      );
    end if;

    if item.work_variant_id is null then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_WORK_VARIANT_MISSING', 'plan_item', item.id, '{}'::jsonb
      );
    elsif item.defect_case_id is not null and not exists (
      select 1 from roadops.defect_work_variant_crosswalks m
      where m.defect_type_id = item.defect_type_id
        and m.work_variant_id = item.work_variant_id
        and m.status = 'approved'
        and m.effective_from <= run_row.as_of::date
        and (m.effective_until is null or m.effective_until > run_row.as_of::date)
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_MAPPING_NOT_APPROVED', 'defect_case', item.defect_case_id,
        jsonb_build_object('work_variant_id', item.work_variant_id)
      );
    end if;

    if item.work_variant_id is not null and (
      item.interpretation_status is distinct from 'approved'
      or item.variant_planning_status is distinct from 'automatic'
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_VARIANT_NOT_AUTOMATICALLY_PLANNABLE',
        'iqn_work_variant', item.work_variant_id,
        jsonb_build_object(
          'interpretation_status', item.interpretation_status,
          'planning_status', item.variant_planning_status,
          'formula_type', item.formula_type
        )
      );
    end if;

    if item.work_quantity is null or item.work_unit is null then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'WORK_QUANTITY_MISSING', 'plan_item', item.id, '{}'::jsonb
      );
    elsif item.work_variant_id is not null and item.basis_unit is distinct from item.work_unit then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'WORK_UNIT_MISMATCH', 'plan_item', item.id,
        jsonb_build_object('submitted_unit', item.work_unit)
      );
    end if;

    if item.scheduled_window is null then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'SCHEDULE_WINDOW_MISSING', 'plan_item', item.id, '{}'::jsonb
      );
      schedule_date := null;
    else
      schedule_date := (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date;
      if schedule_date < lower(run_row.planning_window)
         or ((upper(item.scheduled_window) - interval '1 microsecond') at time zone 'Asia/Tashkent')::date
            >= upper(run_row.planning_window) then
        perform roadops.put_plan_blocker(
          p_run_id, item.id, 'SCHEDULE_OUTSIDE_PLAN_WINDOW', 'plan_item', item.id,
          jsonb_build_object('planning_window', run_row.planning_window, 'scheduled_window', item.scheduled_window)
        );
      end if;
    end if;

    if item.safety_scheme_id is null or not exists (
      select 1 from roadops.safety_schemes ss
      where ss.id = item.safety_scheme_id
        and ss.division_id = run_row.division_id
        and ss.status = 'approved'
        and (schedule_date is null or (
          ss.effective_from <= schedule_date
          and (ss.effective_until is null or ss.effective_until > schedule_date)
        ))
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'SAFETY_SCHEME_MISSING', 'plan_item', item.id, '{}'::jsonb
      );
    end if;

    active_norm_set_id := null;
    if item.work_variant_id is not null then
      select ns.id into active_norm_set_id
      from roadops.iqn_norm_sets ns
      where ns.work_variant_id = item.work_variant_id
        and ns.status = 'approved'
        and ns.effective_from <= run_row.as_of::date
        and (ns.effective_until is null or ns.effective_until > run_row.as_of::date)
      order by ns.effective_from desc
      limit 1;
    end if;

    if item.work_variant_id is not null and active_norm_set_id is null then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_APPROVED_NORM_SET_MISSING',
        'iqn_work_variant', item.work_variant_id,
        jsonb_build_object('as_of', run_row.as_of::date)
      );
    end if;

    select count(*) into iqn_component_count
    from roadops.iqn_norm_lines nl where nl.norm_set_id = active_norm_set_id;
    if active_norm_set_id is not null and iqn_component_count = 0 then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_NORM_LINES_MISSING', 'iqn_norm_set', active_norm_set_id, '{}'::jsonb
      );
    end if;

    if active_norm_set_id is not null and exists (
      select 1
      from roadops.iqn_norm_lines nl
      join roadops.iqn_resources r on r.id = nl.resource_id
      where nl.norm_set_id = active_norm_set_id and r.resource_kind = 'labor'
    ) and not exists (
      select 1 from roadops.work_variant_skill_requirements sr
      where sr.work_variant_id = item.work_variant_id and sr.status = 'approved'
        and sr.effective_from <= coalesce(schedule_date, run_row.as_of::date)
        and (sr.effective_until is null
             or sr.effective_until > coalesce(schedule_date, run_row.as_of::date))
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'WORK_TEMPLATE_MISSING',
        'iqn_work_variant', item.work_variant_id,
        jsonb_build_object('message', 'Approved crew skill template is required for IQN labor time')
      );
    end if;

    if item.variant_planning_status = 'automatic'
       and item.formula_type not in ('linear', 'incremental', 'fixed_period') then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_FORMULA_ENGINE_INPUT_REQUIRED',
        'iqn_work_variant', item.work_variant_id,
        jsonb_build_object('formula_type', item.formula_type, 'formula_inputs', item.formula_inputs)
      );
    end if;

    if item.formula_type = 'incremental' and (
      jsonb_typeof(item.variant_formula_parameters -> 'step_quantity') is distinct from 'number'
      or exists (
        select 1 from roadops.iqn_norm_lines nl
        where nl.norm_set_id = active_norm_set_id
          and (nl.quantity_per_basis is null or nl.increment_quantity is null)
      )
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_INCREMENT_FORMULA_INCOMPLETE',
        'iqn_work_variant', item.work_variant_id, '{}'::jsonb
      );
    end if;

    if item.formula_type = 'fixed_period' and (
      item.scheduled_window is null
      or jsonb_typeof(item.variant_formula_parameters -> 'period_days') is distinct from 'number'
      or (item.variant_formula_parameters ->> 'period_days')::numeric <= 0
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'IQN_FIXED_PERIOD_INPUT_INCOMPLETE',
        'iqn_work_variant', item.work_variant_id, '{}'::jsonb
      );
    end if;

    if active_norm_set_id is not null
       and item.work_quantity is not null and item.work_unit is not null
       and item.variant_planning_status = 'automatic'
       and item.formula_type = 'linear' then
      insert into roadops.plan_resource_requirements (
        plan_item_id, norm_line_id, resource_kind, resource_code,
        required_quantity, unit, required_minutes, calculation, calculated_at
      )
      select
        item.id, nl.id, r.resource_kind,
        coalesce(nullif(r.normalized_code, ''), nullif(r.raw_code, ''), r.id::text),
        ((item.work_quantity / item.basis_quantity) * nl.quantity_per_basis)::numeric(20,6),
        nl.unit,
        case when nl.minutes_per_basis is null then null
             else ceil((item.work_quantity / item.basis_quantity) * nl.minutes_per_basis)::integer end,
        jsonb_build_object(
          'formula_type', 'linear', 'basis_quantity', item.basis_quantity,
          'work_quantity', item.work_quantity, 'quantity_per_basis', nl.quantity_per_basis,
          'input_snapshot_hash', encode(run_row.input_snapshot_hash, 'hex')
        ), run_row.as_of
      from roadops.iqn_norm_lines nl
      join roadops.iqn_resources r on r.id = nl.resource_id
      where nl.norm_set_id = active_norm_set_id and nl.quantity_per_basis is not null
      on conflict (plan_item_id, norm_line_id) do update
        set resource_kind = excluded.resource_kind,
            resource_code = excluded.resource_code,
            required_quantity = excluded.required_quantity,
            unit = excluded.unit,
            required_minutes = excluded.required_minutes,
            calculation = excluded.calculation,
            calculated_at = excluded.calculated_at;
    elsif active_norm_set_id is not null
       and item.work_quantity is not null and item.work_unit is not null
       and item.variant_planning_status = 'automatic'
       and item.formula_type = 'incremental'
       and jsonb_typeof(item.variant_formula_parameters -> 'step_quantity') = 'number'
       and not exists (
         select 1 from roadops.iqn_norm_lines nl
         where nl.norm_set_id = active_norm_set_id
           and (nl.quantity_per_basis is null or nl.increment_quantity is null)
       ) then
      insert into roadops.plan_resource_requirements (
        plan_item_id, norm_line_id, resource_kind, resource_code,
        required_quantity, unit, required_minutes, calculation, calculated_at
      )
      select
        item.id, nl.id, r.resource_kind,
        coalesce(nullif(r.normalized_code, ''), nullif(r.raw_code, ''), r.id::text),
        (nl.quantity_per_basis
          + ceil(greatest(item.work_quantity - item.basis_quantity, 0)
                 / (item.variant_formula_parameters ->> 'step_quantity')::numeric)
            * nl.increment_quantity)::numeric(20,6),
        nl.unit,
        case when nl.minutes_per_basis is null then null
             else ceil(nl.minutes_per_basis
               + ceil(greatest(item.work_quantity - item.basis_quantity, 0)
                      / (item.variant_formula_parameters ->> 'step_quantity')::numeric)
                 * coalesce(nl.increment_minutes, 0))::integer end,
        jsonb_build_object(
          'formula_type', 'incremental', 'basis_quantity', item.basis_quantity,
          'step_quantity', item.variant_formula_parameters -> 'step_quantity',
          'work_quantity', item.work_quantity, 'base_resource_quantity', nl.quantity_per_basis,
          'increment_resource_quantity', nl.increment_quantity,
          'input_snapshot_hash', encode(run_row.input_snapshot_hash, 'hex')
        ), run_row.as_of
      from roadops.iqn_norm_lines nl
      join roadops.iqn_resources r on r.id = nl.resource_id
      where nl.norm_set_id = active_norm_set_id
      on conflict (plan_item_id, norm_line_id) do update
        set resource_kind = excluded.resource_kind,
            resource_code = excluded.resource_code,
            required_quantity = excluded.required_quantity,
            unit = excluded.unit,
            required_minutes = excluded.required_minutes,
            calculation = excluded.calculation,
            calculated_at = excluded.calculated_at;
    elsif active_norm_set_id is not null
       and item.variant_planning_status = 'automatic'
       and item.formula_type = 'fixed_period'
       and item.scheduled_window is not null
       and jsonb_typeof(item.variant_formula_parameters -> 'period_days') = 'number'
       and (item.variant_formula_parameters ->> 'period_days')::numeric > 0 then
      insert into roadops.plan_resource_requirements (
        plan_item_id, norm_line_id, resource_kind, resource_code,
        required_quantity, unit, required_minutes, calculation, calculated_at
      )
      select
        item.id, nl.id, r.resource_kind,
        coalesce(nullif(r.normalized_code, ''), nullif(r.raw_code, ''), r.id::text),
        (ceil((extract(epoch from (upper(item.scheduled_window) - lower(item.scheduled_window))) / 86400.0)
              / (item.variant_formula_parameters ->> 'period_days')::numeric)
          * nl.quantity_per_basis)::numeric(20,6),
        nl.unit,
        case when nl.minutes_per_basis is null then null
             else ceil(
               ceil((extract(epoch from (upper(item.scheduled_window) - lower(item.scheduled_window))) / 86400.0)
                    / (item.variant_formula_parameters ->> 'period_days')::numeric)
               * nl.minutes_per_basis
             )::integer end,
        jsonb_build_object(
          'formula_type', 'fixed_period',
          'period_days', item.variant_formula_parameters -> 'period_days',
          'scheduled_window', item.scheduled_window,
          'quantity_per_period', nl.quantity_per_basis,
          'input_snapshot_hash', encode(run_row.input_snapshot_hash, 'hex')
        ), run_row.as_of
      from roadops.iqn_norm_lines nl
      join roadops.iqn_resources r on r.id = nl.resource_id
      where nl.norm_set_id = active_norm_set_id and nl.quantity_per_basis is not null
      on conflict (plan_item_id, norm_line_id) do update
        set resource_kind = excluded.resource_kind,
            resource_code = excluded.resource_code,
            required_quantity = excluded.required_quantity,
            unit = excluded.unit,
            required_minutes = excluded.required_minutes,
            calculation = excluded.calculation,
            calculated_at = excluded.calculated_at;
    end if;

    select count(*) into snapshot_component_count
    from roadops.plan_resource_requirements pr
    join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
    where pr.plan_item_id = item.id and nl.norm_set_id = active_norm_set_id;
    if active_norm_set_id is not null and iqn_component_count <> snapshot_component_count then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'RESOURCE_SNAPSHOT_INCOMPLETE', 'plan_item', item.id,
        jsonb_build_object('norm_lines', iqn_component_count, 'snapshots', snapshot_component_count)
      );
    end if;

    select
      coalesce((
        select sum(pr.required_minutes)
        from roadops.plan_resource_requirements pr
        where pr.plan_item_id = item.id and pr.resource_kind = 'labor'
      ), 0),
      coalesce((
        select sum(wa.planned_minutes)
        from roadops.work_assignments wa
        join roadops.plan_resource_requirements pr on pr.id = wa.labor_requirement_id
        where pr.plan_item_id = item.id and pr.resource_kind = 'labor'
          and wa.status <> 'cancelled'
      ), 0)
    into needed_minutes, assigned_minutes;
    if needed_minutes > assigned_minutes then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'LABOR_ASSIGNMENT_INCOMPLETE', 'plan_item', item.id,
        jsonb_build_object('required_minutes', needed_minutes, 'assigned_minutes', assigned_minutes)
      );
    end if;

    if exists (
      select 1
      from roadops.work_variant_skill_requirements sr
      where sr.work_variant_id = item.work_variant_id and sr.status = 'approved'
        and sr.effective_from <= coalesce(schedule_date, run_row.as_of::date)
        and (sr.effective_until is null
             or sr.effective_until > coalesce(schedule_date, run_row.as_of::date))
        and (
          select count(distinct wa.worker_id)
          from roadops.work_assignments wa
          where wa.plan_item_id = item.id and wa.skill_requirement_id = sr.id
            and wa.status <> 'cancelled'
        ) < sr.worker_count
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'WORK_TEMPLATE_CREW_INCOMPLETE', 'plan_item', item.id,
        coalesce((
          select jsonb_build_object('skills', jsonb_agg(jsonb_build_object(
            'qualification_code', sr.qualification_code,
            'required_workers', sr.worker_count,
            'assigned_workers', (
              select count(distinct wa.worker_id)
              from roadops.work_assignments wa
              where wa.plan_item_id = item.id and wa.skill_requirement_id = sr.id
                and wa.status <> 'cancelled'
            )
          ) order by sr.qualification_code))
          from roadops.work_variant_skill_requirements sr
          where sr.work_variant_id = item.work_variant_id and sr.status = 'approved'
            and sr.effective_from <= coalesce(schedule_date, run_row.as_of::date)
            and (sr.effective_until is null
                 or sr.effective_until > coalesce(schedule_date, run_row.as_of::date))
        ), '{}'::jsonb)
      );
    end if;

    if exists (
      select 1
      from roadops.work_assignments wa
      join roadops.plan_resource_requirements pr on pr.id = wa.labor_requirement_id
      join roadops.work_variant_skill_requirements sr on sr.id = wa.skill_requirement_id
      where wa.plan_item_id = item.id and wa.status <> 'cancelled'
        and (
          not exists (
            select 1 from roadops.worker_versions wv
            where wv.worker_id = wa.worker_id
              and wv.employment_state = 'active'
              and wv.valid_from <= lower(wa.scheduled_window)
              and (wv.valid_until is null or wv.valid_until > lower(wa.scheduled_window))
          )
          or roadops.division_for_worker_assignment(wa.worker_id, wa.work_date)
             is distinct from run_row.division_id
          or not exists (
            select 1 from roadops.worker_qualification_versions q
            where q.worker_id = wa.worker_id and q.qualification_code = sr.qualification_code
              and q.valid_from <= lower(wa.scheduled_window)
              and (q.valid_until is null or q.valid_until > lower(wa.scheduled_window))
          )
        )
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'WORKER_NOT_ELIGIBLE', 'plan_item', item.id, '{}'::jsonb
      );
    end if;

    select
      coalesce((
        select sum(pr.required_quantity)
        from roadops.plan_resource_requirements pr
        where pr.plan_item_id = item.id and pr.resource_kind = 'equipment'
      ), 0),
      coalesce((
        select sum(er.allocated_quantity)
        from roadops.equipment_reservations er
        join roadops.plan_resource_requirements pr on pr.id = er.equipment_requirement_id
        where pr.plan_item_id = item.id and pr.resource_kind = 'equipment'
          and er.status in ('reserved', 'checked_out')
      ), 0)
    into needed_equipment, reserved_equipment;
    if needed_equipment > reserved_equipment then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'EQUIPMENT_RESERVATION_INCOMPLETE', 'plan_item', item.id,
        jsonb_build_object('required_quantity', needed_equipment, 'allocated_quantity', reserved_equipment)
      );
    end if;
    if exists (
      select 1
      from roadops.equipment_reservations er
      join roadops.plan_resource_requirements pr on pr.id = er.equipment_requirement_id
      join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
      join roadops.equipment_units e on e.id = er.equipment_unit_id
      where er.plan_item_id = item.id and er.status in ('reserved', 'checked_out')
        and e.iqn_resource_id is distinct from nl.resource_id
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'EQUIPMENT_CATALOG_MAPPING_MISMATCH', 'plan_item', item.id, '{}'::jsonb
      );
    end if;

    select
      coalesce((
        select sum(pr.required_quantity)
        from roadops.plan_resource_requirements pr
        where pr.plan_item_id = item.id and pr.resource_kind = 'material'
      ), 0),
      coalesce((
        select sum(mr.quantity)
        from roadops.material_reservations mr
        join roadops.plan_resource_requirements pr on pr.id = mr.material_requirement_id
        where pr.plan_item_id = item.id and pr.resource_kind = 'material'
          and mr.status in ('reserved', 'issued')
      ), 0)
    into needed_material, reserved_material;
    if needed_material > reserved_material then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'MATERIAL_RESERVATION_INCOMPLETE', 'plan_item', item.id,
        jsonb_build_object('required_quantity', needed_material, 'reserved_quantity', reserved_material)
      );
    end if;
    if exists (
      select 1
      from roadops.material_reservations mr
      join roadops.plan_resource_requirements pr on pr.id = mr.material_requirement_id
      join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
      join roadops.materials m on m.id = mr.material_id
      where mr.plan_item_id = item.id and mr.status in ('reserved', 'issued')
        and m.iqn_resource_id is distinct from nl.resource_id
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'MATERIAL_CATALOG_MAPPING_MISMATCH', 'plan_item', item.id, '{}'::jsonb
      );
    end if;

    if item.scheduled_window is not null and exists (
      select 1 from roadops.plan_items other
      where other.id <> item.id
        and other.road_id = item.road_id
        and other.status in ('approved', 'scheduled', 'in_progress')
        and other.chainage_span && item.chainage_span
        and other.scheduled_window && item.scheduled_window
    ) then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ROAD_ZONE_TIME_CONFLICT', 'road', item.road_id,
        jsonb_build_object('chainage_span', item.chainage_span, 'scheduled_window', item.scheduled_window)
      );
    end if;
  end loop;

  update roadops.plan_items pi
  set status = case
    when exists (
      select 1 from roadops.planning_blockers b
      where b.plan_item_id = pi.id and b.resolved_at is null
    ) then 'blocked' else 'ready' end
  where pi.planning_run_id = p_run_id and pi.status in ('candidate', 'blocked', 'ready');

  update roadops.planning_runs
  set status = 'evaluated', evaluated_at = clock_timestamp(),
      approved_at = null, approved_by = null, published_at = null, published_by = null
  where id = p_run_id;

  return query
  select b.blocker_code, count(*)
  from roadops.planning_blockers b
  where b.planning_run_id = p_run_id and b.resolved_at is null
  group by b.blocker_code
  order by b.blocker_code;
end
$function$;

create or replace function roadops.approve_planning_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row roadops.planning_runs%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select r.* into run_row from roadops.planning_runs r where r.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if run_row.status <> 'evaluated' then
    raise exception using errcode = '55000', message = 'Only evaluated plan can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('planning.approve', run_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot approve this division plan';
  end if;
  if actor_id = run_row.created_by then
    raise exception using errcode = '42501', message = 'Plan creator cannot approve the same plan';
  end if;
  if exists (
    select 1 from roadops.planning_blockers b
    where b.planning_run_id = p_run_id and b.resolved_at is null
  ) or exists (
    select 1 from roadops.plan_items pi
    where pi.planning_run_id = p_run_id and pi.status not in ('ready', 'cancelled')
  ) then
    raise exception using errcode = '23514', message = 'Plan has unresolved blockers or non-ready items';
  end if;

  update roadops.plan_items set status = 'approved'
  where planning_run_id = p_run_id and status = 'ready';
  update roadops.planning_runs
  set status = 'approved', approved_at = clock_timestamp(), approved_by = actor_id
  where id = p_run_id;
end
$function$;

create or replace function roadops.publish_planning_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row roadops.planning_runs%rowtype;
  actor_id uuid := roadops.current_actor_id();
  created_count integer;
begin
  select r.* into run_row from roadops.planning_runs r where r.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if run_row.status <> 'approved' then
    raise exception using errcode = '55000', message = 'Only approved plan can be published';
  end if;
  if actor_id is null or not roadops.has_permission('planning.approve', run_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot publish this division plan';
  end if;
  if exists (
    select 1 from roadops.planning_blockers b
    where b.planning_run_id = p_run_id and b.resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'Plan has unresolved blockers';
  end if;

  insert into roadops.work_orders (plan_item_id, order_number, issued_by)
  select pi.id,
         'WO-' || to_char(clock_timestamp() at time zone 'Asia/Tashkent', 'YYYYMMDD') || '-'
           || upper(substr(replace(pi.id::text, '-', ''), 1, 12)),
         actor_id
  from roadops.plan_items pi
  where pi.planning_run_id = p_run_id and pi.status = 'approved'
  on conflict (plan_item_id) do nothing;
  get diagnostics created_count = row_count;

  update roadops.plan_items set status = 'scheduled'
  where planning_run_id = p_run_id and status = 'approved';
  update roadops.planning_runs
  set status = 'published', published_at = clock_timestamp(), published_by = actor_id
  where id = p_run_id;

  insert into roadops.integration_outbox (
    destination_code, event_kind, aggregate_type, aggregate_id, payload, payload_hash
  ) values (
    'road_repair', 'planning_run.published', 'planning_run', p_run_id,
    jsonb_build_object('planning_run_id', p_run_id, 'published_at', clock_timestamp()),
    extensions.digest(convert_to(p_run_id::text || ':planning_run.published', 'UTF8'), 'sha256')
  ) on conflict do nothing;

  return created_count;
end
$function$;

create or replace function roadops.dashboard_summary(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if p_unit_id is null or not roadops.can_access_division(p_unit_id) then
    raise exception using errcode = '42501', message = 'Actor cannot access this road unit';
  end if;
  select jsonb_build_object(
    'road_unit_id', p_unit_id,
    'open_defects', (
      select count(*) from roadops.defect_cases dc
      join roadops.road_versions rv on rv.road_id = dc.road_id and rv.valid_until is null
      where rv.division_id = p_unit_id and dc.status in ('open', 'planned', 'in_progress')
    ),
    'roadvision_awaiting_verification', (
      select count(*) from roadops.roadvision_candidates c
      join roadops.road_versions rv on rv.road_id = c.road_id and rv.valid_until is null
      where rv.division_id = p_unit_id and c.status = 'awaiting_verification'
    ),
    'draft_or_evaluated_plans', (
      select count(*) from roadops.planning_runs pr
      where pr.division_id = p_unit_id and pr.status in ('draft', 'evaluated')
    ),
    'active_work_orders', (
      select count(*) from roadops.work_orders wo
      join roadops.plan_items pi on pi.id = wo.plan_item_id
      join roadops.planning_runs pr on pr.id = pi.planning_run_id
      where pr.division_id = p_unit_id
        and wo.status in ('issued', 'accepted', 'in_progress', 'paused')
    ),
    'generated_at', statement_timestamp()
  ) into result;
  return result;
end
$function$;

create table roadops.audit_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references roadops.app_users(id) on delete restrict,
  session_id uuid,
  request_id uuid,
  action text not null check (btrim(action) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  request_context jsonb not null default '{}'::jsonb,
  previous_hash bytea check (previous_hash is null or octet_length(previous_hash) = 32),
  event_hash bytea not null check (octet_length(event_hash) = 32)
);

create index audit_events_entity_idx
  on roadops.audit_events (entity_type, entity_id, occurred_at, id);
create index audit_events_actor_idx
  on roadops.audit_events (actor_user_id, occurred_at desc);

create or replace function roadops.fill_audit_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  prior_hash bytea;
  canonical text;
begin
  perform pg_advisory_xact_lock(hashtext('roadops.audit_events.hash_chain'));
  select a.event_hash into prior_hash from roadops.audit_events a order by a.id desc limit 1;
  new.previous_hash := prior_hash;
  new.actor_user_id := coalesce(new.actor_user_id, roadops.current_actor_id());
  new.session_id := coalesce(new.session_id, roadops.current_session_id());
  new.request_id := coalesce(new.request_id, roadops.current_request_id());
  canonical := concat_ws('|',
    coalesce(encode(prior_hash, 'hex'), ''), new.event_id::text, new.occurred_at::text,
    coalesce(new.actor_user_id::text, ''), coalesce(new.session_id::text, ''),
    coalesce(new.request_id::text, ''), new.action, new.entity_type,
    coalesce(new.entity_id, ''), coalesce(new.before_data::text, 'null'),
    coalesce(new.after_data::text, 'null'), new.request_context::text
  );
  new.event_hash := extensions.digest(convert_to(canonical, 'UTF8'), 'sha256');
  return new;
end
$function$;

create trigger audit_events_fill_hash
before insert on roadops.audit_events
for each row execute function roadops.fill_audit_hash();
create trigger audit_events_append_only
before update or delete on roadops.audit_events
for each row execute function roadops.forbid_mutation();
create trigger audit_events_no_truncate
before truncate on roadops.audit_events
for each statement execute function roadops.forbid_mutation();

create or replace function roadops.capture_row_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_data jsonb;
  new_data jsonb;
  captured_id text;
begin
  old_data := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_data := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if old_data is not null then
    old_data := old_data - array[
      'password_hash','token_hash','csrf_token_hash','secret_ciphertext',
      'credential_id','public_key'
    ];
  end if;
  if new_data is not null then
    new_data := new_data - array[
      'password_hash','token_hash','csrf_token_hash','secret_ciphertext',
      'credential_id','public_key'
    ];
  end if;
  captured_id := coalesce(
    new_data ->> 'id', old_data ->> 'id',
    new_data ->> 'setting_key', old_data ->> 'setting_key'
  );
  insert into roadops.audit_events (
    action, entity_type, entity_id, before_data, after_data, request_context
  ) values (
    lower(tg_op), coalesce(nullif(tg_argv[0], ''), tg_table_name), captured_id,
    old_data, new_data,
    jsonb_build_object('database_role', current_user, 'table_schema', tg_table_schema)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

do $audit_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_users','system_settings','user_mfa_factors','auth_sessions','roles','role_permissions',
    'user_role_memberships','integration_connections','dead_letter_events','sync_conflicts',
    'road_divisions','road_division_versions','road_division_profile_versions',
    'roads','road_versions','road_elements','road_element_versions','workers','worker_versions',
    'import_batches','import_issues','iqn_work_variants','iqn_norm_sets',
    'work_variant_skill_requirements',
    'defect_work_variant_crosswalks','roadvision_candidates','roadvision_candidate_verifications',
    'inspections','inspection_observations','defect_cases','annual_programs',
    'annual_program_items','planning_runs','plan_items',
    'work_assignments','equipment_reservations','material_reservations','work_orders',
    'work_completion_records'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on roadops.%I '
      'for each row execute function roadops.capture_row_audit(%L)',
      table_name || '_audit', table_name, table_name
    );
  end loop;
end
$audit_triggers$;

do $append_only_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'password_history','login_attempts','planning_run_inputs'
  ] loop
    execute format(
      'create trigger %I before update or delete on roadops.%I '
      'for each row execute function roadops.forbid_mutation()',
      table_name || '_append_only', table_name
    );
    execute format(
      'create trigger %I before truncate on roadops.%I '
      'for each statement execute function roadops.forbid_mutation()',
      table_name || '_no_truncate', table_name
    );
  end loop;
end
$append_only_triggers$;

revoke all on function roadops.authenticate_session(text) from public;
revoke all on function roadops.bootstrap_first_admin(text, text, text, uuid) from public;
revoke all on function roadops.complete_initial_totp_enrollment(uuid, text, bytea, bigint, uuid) from public;
revoke all on function roadops.logout_session(uuid, inet, text, uuid) from public;
revoke all on function roadops.lookup_login_identity(text) from public;
revoke all on function roadops.consume_totp_counter(uuid, uuid, bigint) from public;
revoke all on function roadops.record_login_failure(text, text, inet, text, uuid) from public;
revoke all on function roadops.complete_login(uuid, text, text, timestamptz, timestamptz, uuid, bigint, inet, text, uuid) from public;
revoke all on function roadops.match_roadvision_candidate(uuid, uuid, uuid, uuid, numrange) from public;
revoke all on function roadops.verify_roadvision_candidate(uuid, text, numeric, text, text) from public;
revoke all on function roadops.submit_inspection(uuid) from public;
revoke all on function roadops.return_inspection(uuid, text) from public;
revoke all on function roadops.review_inspection_observation(uuid, text, text) from public;
revoke all on function roadops.put_plan_blocker(uuid, uuid, text, text, uuid, jsonb) from public;
revoke all on function roadops.rebuild_plan_blockers(uuid) from public;
revoke all on function roadops.approve_planning_run(uuid) from public;
revoke all on function roadops.publish_planning_run(uuid) from public;
revoke all on function roadops.dashboard_summary(uuid) from public;
revoke all on function roadops.fill_audit_hash() from public;
revoke all on function roadops.capture_row_audit() from public;

commit;
