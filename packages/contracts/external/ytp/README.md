# Yo'l ta'mirlash punkti contract proposal

Status: **vendor-proposed; configuration required; not approved for production**.

This folder is a negotiation baseline only. No Yo'l ta'mirlash punkti API or
sandbox specification was available when it was written. The adapter must report
`CONFIGURATION_REQUIRED` or `CONTRACT_REVIEW_REQUIRED` until the source owner
approves all of the following:

- stable external IDs for roads, road units, unit profiles, assignments, road
  elements, workers, qualifications and availability;
- ordered revision/cursor behaviour, replay limits and full-snapshot boundaries;
- effective-dated retirement/deletion semantics;
- calibrated WGS84 geometry, chainage origin and direction rules;
- OAuth/service-account and webhook key rotation rules;
- maximum event size, rate limits and reconciliation reports.

RoadOps treats these records as source-owned, effective-dated replicas. Operators
cannot overwrite them locally. The webhook envelope is idempotent by
`(source_system, event_id)`; reusing an event ID with different raw bytes is a
hard conflict.

The bundled payloads use a synthetic complete D001 road only to make contract
validation deterministic. They are fixtures, not runtime defaults. A production
deployment obtains every road identity, length, geometry and effective road or
worker assignment from YTP and supports every road visible in the caller's scope.

The sample coordinates and IDs are synthetic contract examples. They are not
production master data.
