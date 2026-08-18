begin;

-- The original pilot release exposed read-only helpers that forced every
-- operational workflow to a single D001/67 km road. Operational APIs are now
-- scoped by the authenticated actor's effective road/division assignments, so
-- keeping these elevated helpers would preserve a misleading deployment
-- invariant and an unnecessary SECURITY DEFINER surface.
drop function if exists roadops.lock_primary_road_invariant();
drop function if exists roadops.primary_road_invariant();

commit;
