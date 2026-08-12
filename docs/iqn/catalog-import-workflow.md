# IQN and RoadVision catalog import workflow

This workflow separates source capture from operational approval. A successful
stage command does not create a usable norm or RoadVision mapping. Publication
requires a complete, hash-bound expert manifest and an active reviewer UUID.

## IQN 02

Stage the reviewed DOCX:

```bash
php artisan roadops:iqn02-stage source-materials/ИҚН\ 02-24.docx \
  --expected-sha256=<approved-source-sha256>
```

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

Publish only after an expert prepares a complete JSON review manifest:

```bash
php artisan roadops:iqn-publish <batch-uuid> reviewed-iqn02.json \
  --reviewed-by=<active-app-user-uuid>
```

The manifest root contains `document`, `row_decisions`, and `catalog`.
`row_decisions` must cover every staged row exactly once. Accepted rows require
an object-valued `canonical_payload` with a unique `catalog_keys` array;
rejected rows require a reason and cannot have canonical payload. An accepted
row with any ambiguity flag also requires `ambiguity_resolution`. Every catalog
entity must point to an accepted `source_location.row_provenance_hash`, and its
key must be claimed by that row's `canonical_payload`. IQN 02 publication additionally requires
non-empty work items, variants, resources, norm sets, and norm lines.

The `catalog` object contains ordered arrays named `sections`, `work_items`,
`variants`, `resources`, `norm_sets`, and `norm_lines`. Each row has a unique
manifest `key`; foreign references use these keys. Parent sections/work items
must occur before children. `planning_status=automatic` is rejected unless the
variant is explicitly `interpretation_status=approved`. Approved norm sets are
inserted as drafts, their reviewed lines are inserted, and only then are they
transitioned to approved.

## IQN 03

The application has no approved layout-aware PDF extractor. The safe command is:

```bash
php artisan roadops:iqn03-stage 'source-materials/ИҚН 03-24 29.01.2025.pdf' \
  --expected-sha256=<approved-source-sha256>
```

It records a rejected import batch and an
`IQN03_APPROVED_PDF_EXTRACTOR_REQUIRED` `CONFIGURATION_REQUIRED` artifact. It
does not guess tables from plain PDF text. The approved extractor contract must
produce `iqn03-layout-json-v1` with page number, block sequence, raw text, table
coordinates, source bounding box, extractor name/version, and source SHA-256.
Only a future parser identified by `iqn03-layout-json-*` is eligible for the IQN
publish service.

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
