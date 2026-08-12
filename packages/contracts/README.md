# RoadOps contracts

`openapi.yaml` is the normative browser/API contract for `/api/v1`. Breaking
changes require a new API version or a documented compatibility window.

`external/ytp` and `external/roadvision` are explicitly unapproved vendor
proposals. They let the adapters fail closed and make missing decisions visible;
they do not invent an active connection.

Contract rules:

- JSON uses camelCase for the RoadOps browser API and snake_case only inside the
  proposed vendor envelopes.
- decimal business quantities are serialized as strings; time allocations and
  chainage are integers.
- authenticated mutating browser requests require the session cookie, CSRF
  header and an idempotency key; login is rate-limited and may return a TOTP
  challenge;
- operational scope is fail-closed to the single effective YTP `D001` road. Its
  source-owned identity and geometry remain read-only, while its synchronized
  length must equal exactly `67000` metres; a missing, duplicate, differently
  cased or differently sized row is rejected instead of silently substituted;
- manual inspection entry reads `GET /manual-inspections/options`, creates a
  draft with `POST /manual-inspections`, submits the whole inspection, then
  applies one atomic inspection-level `VERIFIED` or `REJECTED` decision to all
  pending observations;
- manual inspection requests require `defectTypeId`, its exact catalog `unit`
  and an auditable `observedIssue`; no name-based legacy lookup is promised;
- automatic and manual planning are separate endpoints. Both previews return
  explicit resource checks, the selected traffic-safety scheme and each selected
  worker's remaining time against the 420-minute working-day limit;
- planning candidate IDs are source-prefixed (`DEFECT:`, `ANNUAL:` or
  `MANUAL:` plus UUID). A bare UUID is not a valid candidate ID;
- a plan preview is first approved by an authorized user other than its creator,
  then published. `GET /planning/plans` and `GET /planning/plans/{id}` preserve
  the full handoff between users, including blockers, resources and actor-specific
  action permissions. Approval and publication each revalidate the server-stored
  snapshot at every item's scheduled local work date; publication creates work
  orders atomically;
- `GET /timesheets/monthly` returns a dedicated `1..month-end` grid and
  `GET /reports/timesheet.xlsx?year=…&month=…` exports the same period as a true
  Excel workbook;
- RoadVision finding responses identify evidence as JPEG, PNG or MP4 so the web
  client can render images and video without guessing from a URL;
- vendor webhooks are HMAC-authenticated, replay-limited and idempotent by event
  ID plus raw-payload checksum.
- neither requests nor responses include priority, condition indices, 0-100
  ratings or AI confidence scores.

Local lint:

```bash
make contracts
```
