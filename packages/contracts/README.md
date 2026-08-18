# RoadOps contracts

`openapi.yaml` is the normative browser/API contract for `/api/v1`. Breaking
changes require a new API version or a documented compatibility window.

`external/ytp` and `external/roadvision` are explicitly unapproved vendor
proposals. They let the adapters fail closed and make missing decisions visible;
they do not invent an active connection.

Contract rules:

- JSON uses camelCase for the RoadOps browser API and snake_case only inside the
  proposed vendor envelopes.
- decimal business quantities are serialized as strings; time allocations are
  integers. Manual inspection captures integer chainage metres, while manual
  planning accepts a decimal-string point exactly as its endpoint schema defines;
- authenticated mutating browser requests require the session cookie, CSRF
  header and an idempotency key; login is rate-limited and may return a TOTP
  challenge;
- operational records are fail-closed to the authenticated actor's division and
  its effective YTP roads. Source-owned road identity, length and geometry remain
  read-only; a missing, ambiguous or out-of-scope road is rejected instead of
  silently substituted;
- the separate `GET /admin/network-summary` and
  `GET /admin/organization-hierarchy` endpoints require global `system.all`
  and stay outside division-scoped operational views. Only these admin APIs
  return the official 42 371 km national baseline; division dashboards and
  settings never receive that value. The hierarchy contains only synchronized
  `REPUBLIC -> REGION -> ENTERPRISE -> DIVISION` records and reports incomplete
  source links instead of generating placeholder enterprises or divisions;
- manual inspection entry reads `GET /manual-inspections/options`, creates a
  draft with `POST /manual-inspections`, submits the whole inspection, then
  applies one atomic inspection-level `VERIFIED` or `REJECTED` decision to all
  pending observations;
- manual inspection requests require an expert-published top-level IQN 02-24
  `iqnTopicId`, one `chainageStartM` location, an exact quantity and one of the
  five allowed measurement units. Executable norm detail is selected during planning;
- automatic and manual planning are separate endpoints. Both previews return
  explicit resource checks, the selected traffic-safety scheme and each selected
  worker's remaining time against the 420-minute working-day limit. A manual
  preview accepts one point only; when linked to a manual-inspection defect, that
  point must equal the defect's frozen source location;
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
- work-order start, completion and independent verification always return the
  same full detail contract. Completion keeps explicit worker dates and material/
  equipment reservation IDs. Evidence must come from a configured approved HTTPS
  origin; private object-store URIs and arbitrary external hosts are rejected.
  Only independently verified actuals count toward annual-program and work-order
  reports;
- approved UZS cost-rate versions and monthly work-time norms are date-specific
  and never overlap. `POST /monthly-completion-acts` rejects any missing approved
  rate or norm, creates or appends to the month's open draft, freezes every
  labor/allowance/social/material/machine and annual/YTD display value, and exports
  the six-sheet monthly completion-act XLSX. Its `Tabel` is a true day-by-day
  hours grid; labor keeps approved monthly norm, salary, bonus, traffic/travel
  allowances and social components separate. Source-template payroll fields that
  are not captured are explicitly marked as unavailable/zero rather than guessed;
- RoadVision findings return every checksum-bearing JPEG, PNG or MP4 media item
  through an indexed, authenticated same-origin stream; private S3 references
  are never exposed. Manual-inspection observations use their own configured
  bucket, region and prefix with the same full-object SHA-256 fail-closed check;
- vendor webhooks are HMAC-authenticated, replay-limited and idempotent by event
  ID plus raw-payload checksum.
- neither requests nor responses include priority, condition indices, 0-100
  ratings or AI confidence scores.

Local lint:

```bash
make contracts
```
