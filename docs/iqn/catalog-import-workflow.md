# IQN and RoadVision catalog import workflow

This workflow separates source capture from operational approval. A successful
stage command does not create a usable norm or RoadVision mapping. Publication
requires a complete manifest approved through an authenticated global-expert
application session. The console publisher cannot accept or invent reviewer
identity.

## IQN 02

Stage the reviewed DOCX:

```bash
php artisan roadops:iqn02-stage source-materials/ИҚН\ 02-24.docx
```

The command has a built-in hard gate for the uploaded IQN 02 source SHA-256
`443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177`.
`--expected-sha256` is an optional second operator pin; it never replaces or
weakens the built-in approved-source check.

Parser version `iqn02-ooxml-2` preserves all direct Word body blocks and their
order. It stores paragraphs, table context references, physical and logical
cell positions, `gridSpan`, vertical merge restart/continuation, tab/break
tokens, normalized display text, ambiguity flags, and deterministic SHA-256
provenance for every block, row, and cell.

Regression counts for the supplied source are:

| Structure | Count |
| --- | ---: |
| Paragraph blocks | 691 |
| Tables | 99 |
| Total body blocks | 790 |
| Table rows | 1,260 |
| Physical cells | 5,735 |
| Cells with `gridSpan` | 250 |
| Vertical merge restarts | 91 |
| Vertical merge continuations | 237 |
| Tab tokens in body paragraphs | 300 |
| Tab tokens in table cells | 4,113 |
| Explicit line breaks in body paragraphs | 2 |
| Explicit line breaks in table cells | 10 |

The review-manifest body contains `document`, `block_decisions`,
`row_decisions`, and `catalog`. It must not contain `reviewer_attestation`;
the server creates that identity evidence itself. Both decision arrays must
cover every staged source record of their kind exactly once. Accepted records
require an object-valued `canonical_payload` with a unique `catalog_keys`
array; rejected records require a reason and cannot have canonical payload. An
accepted record with any ambiguity flag also requires
`ambiguity_resolution`. Every catalog entity must point to exactly one
accepted `source_location.block_provenance_hash` or
`source_location.row_provenance_hash`, and its key must be claimed by that
source record's `canonical_payload`. Both IQN 02 and IQN 03 publication require
non-empty work items, variants, resources, norm sets, and norm lines.

Submit the completed body to the authenticated approval endpoint. This route
requires a current session with a truly global `catalog.manage` or
`system.all` membership, CSRF protection, and an idempotency key:

```bash
jq -n --slurpfile manifest reviewed-iqn02.json \
  '{manifest: $manifest[0], confirmation: "IQN_CATALOG_REVIEW_APPROVED"}' \
  > /secure-review/iqn02-approval-request.json

curl --fail-with-body -X POST \
  'https://<roadops-host>/api/v1/admin/iqn/import-batches/<batch-uuid>/review-approval' \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <session-csrf-token>' \
  -H 'Idempotency-Key: <unique-idempotency-key>' \
  -b '<roadops-session-cookie>' \
  --data-binary @/secure-review/iqn02-approval-request.json
```

The server injects and persists an attestation containing the approval UUID,
authenticated reviewer UUID, exact batch ID, approved source SHA-256,
canonical manifest SHA-256, database approval time, and a fixed 24-hour expiry.
The approval row also records the authenticated session and request IDs in the
tamper-evident audit chain. A division-scoped permission cannot create it.

Publish before the persisted approval expires:

```bash
php artisan roadops:iqn-publish <batch-uuid>
```

The console command accepts neither a manifest path nor a reviewer UUID. It
locks and revalidates the persisted approval, confirms that the reviewer still
has active global authority, rechecks both approved source checksums and every
block/row decision, records the database publisher principal, and atomically
transitions the same approval from `validated` to `published`.

### Approval trust model

Reviewer identity comes from the opaque authenticated browser session (and its
configured MFA policy), never from JSON or CLI input. The request transaction
sets database-local actor, session, and request IDs; global-permission
middleware and an independent RLS policy both require a global membership.
The API persists the validated manifest and server-created attestation as one
single-use approval. The sync role cannot insert/delete approvals or update
their reviewer, session, request, source, attestation, or hashes; it can only
set the five publication-transition fields. A database trigger permits exactly
one `validated` to `published` transition, checks the resulting document is for
the approved batch/source, and binds `publisher_db_role` to the real database
session principal. Both approval creation and publication are appended to the
tamper-evident audit chain.

The `catalog` object contains ordered arrays named `sections`, `work_items`,
`variants`, `resources`, `norm_sets`, and `norm_lines`. Each row has a unique
manifest `key`; foreign references use these keys. Parent sections/work items
must occur before children. `planning_status=automatic` is rejected unless the
variant is explicitly `interpretation_status=approved`. Approved norm sets are
inserted as drafts, their reviewed lines are inserted, and only then are they
transitioned to approved.

### Road-master inspection topics

The source audit isolates 29 general time-norm headings in
[`extracted/iqn02-review-candidates/work-topics.json`](extracted/iqn02-review-candidates/work-topics.json).
They are candidates, not a production lookup. The expert publication manifest
must represent approved inspection subjects as top-level `iqn_work_items` with
`item_kind=group`, no `parent_key`, and source-location metadata
`catalog_role=manual_inspection_topic` plus a unique `topic_number` from 1
through 29.

The road-master options API must read only those marker-bound work items from
the latest effective, expert-published IQN 02 document, ordered by
`topic_number`. `defect_types` is a separate finding classification and must
not be relabeled or used as an IQN-topic fallback. Until all 29 topics are
approved, the API should return no IQN choices and an
`IQN_TOPICS_NOT_APPROVED` configuration blocker.

## IQN 03

The legacy PDF-only command remains a safe blocker and never guesses tables:

```bash
php artisan roadops:iqn03-stage 'source-materials/ИҚН 03-24 29.01.2025.pdf' \
  --expected-sha256=<approved-source-sha256>
```

It records a rejected import batch and an
`IQN03_APPROVED_PDF_EXTRACTOR_REQUIRED` `CONFIGURATION_REQUIRED` artifact. It
does not guess tables from plain PDF text.

The approved review-staging interchange is now
[`schemas/iqn03-layout-json-v1.schema.json`](schemas/iqn03-layout-json-v1.schema.json).
It is locked to the uploaded 51-page source with SHA-256
`f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e`.
The contract retains every page and global block/word sequence, top-origin PDF
bounding boxes, raw text, table/row/cell positions, merged-cell placeholders,
orphan table words, extractor identity, and independently verified totals.

Generate a candidate layout offline; `pdfplumber` is an analyst-tool
dependency and is deliberately not an API runtime dependency:

```bash
python3 tools/iqn/extract_iqn03_layout.py \
  'source-materials/ИҚН 03-24 29.01.2025.pdf' \
  /secure-review/iqn03-layout.json
```

Visually inspect the PDF and layout artifact, then stage it:

```bash
php artisan roadops:iqn03-layout-stage \
  'source-materials/ИҚН 03-24 29.01.2025.pdf' \
  /secure-review/iqn03-layout.json
```

The command independently hashes the PDF and layout JSON, rejects any source
other than the approved checksum, recomputes all declared counts, rejects gaps
or duplicates in page/block/table/row/cell/word sequences, and writes within a
single transaction. Page/block geometry goes to `iqn_staged_blocks`; every
table row and all cell slots, including null merged-cell placeholders, go to
`iqn_staged_rows` and `import_raw_cells`. Each record receives a deterministic
SHA-256 provenance hash.

Reference extraction counts are 51 pages, 1,218 blocks (1,178 text and 40
table blocks), 573 table rows, 4,444 cell slots, 2,916 non-placeholder cells,
and 13,376 words. These are layout-capture counts, not approved norm counts.
The staged batch remains non-operational until every staged row receives an
explicit expert decision, every staged block receives an explicit expert
decision, and the authenticated approval plus normal `roadops:iqn-publish`
validation passes. An empty IQN 03 operational catalog is rejected. No
duplicated or malformed source code is auto-corrected.

## RoadVision attribute catalog

Stage and audit the workbook:

```bash
php artisan roadops:roadvision-catalog \
  source-materials/RoadVisionAI_atributlar_royxati_uzbekcha.xlsx \
  --acknowledge-count-mismatch
```

The supplied master sheet contains 152 complete, sequential, unique rows. Its
Summary declares 153 total: the pavement subtotal is 20 while the master has
19. Acknowledgement downgrades only the total/subtotal discrepancy. Sheet/header
contract errors, required-field omissions, ID collisions, sequence gaps, and
normalized-name collisions remain blocking. Column D is retained as
`direction`; it is not mislabeled as description.

Publication requires one explicit classification for all 152 row hashes:

```bash
php artisan roadops:roadvision-catalog:publish <batch-uuid> \
  reviewed-roadvision.json --reviewed-by=<active-app-user-uuid>
```

The classification manifest contains `catalog_revision`, `active_from`, an
overall `review_note`, and `rows`. Every row specifies `external_code`,
`expected_row_hash`, `record_kind`, and `review_note`. Only
`defect_candidate` rows carry `defect_type_code`, which must resolve to an active
approved defect type on `active_from`. Missing rows, duplicate codes, normalized
name collisions, changed row hashes, or overlapping active catalog periods stop
the transaction. A replacement revision must name the single existing
`supersedes_revision`; the prior period is closed before the new revision is
inserted.

No command in this workflow changes planning, manual-inspection, web-route, or
OpenAPI behavior.
