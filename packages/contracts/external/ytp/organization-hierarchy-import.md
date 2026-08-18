# Organization hierarchy import prerequisite

RoadOps has a temporal database projection for the fixed administrative chain
`REPUBLIC -> REGION -> ENTERPRISE -> DIVISION`, but the current YTP proposal
does **not** claim that the source exposes these relationships. Production must
not infer them from names, `region_code`, addresses, or free-form
`ROAD_UNIT.profile` fields.

Before hierarchy synchronization is enabled, the YTP owner must approve a new
version of `proposed-event.schema.json` with stable external identifiers and
retirement/effective-date semantics for all of the following records:

- organization identity and version (`REPUBLIC`, `REGION`, or `ENTERPRISE`);
- organization parent assignment (`REGION -> REPUBLIC` and
  `ENTERPRISE -> REGION`);
- road-division assignment (`DIVISION -> ENTERPRISE`).

The PHP contract validator and projector must be extended in the same change.
Every referenced identity must already exist in the same authoritative source;
unknown, cross-source, cyclic, incomplete, overlapping, or wrong-level links
must fail closed. Until that contract is approved, the hierarchy tables remain
empty in production and the admin API reports only synchronized records plus
the separately governed 42,371 km Republic-level baseline. No `200+` enterprise
or `550` division placeholder rows are generated.
