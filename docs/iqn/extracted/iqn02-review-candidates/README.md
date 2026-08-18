# IQN 02-24 review candidates

These UTF-8 CSV/JSON/Markdown files are mechanically extracted **review
candidates**, not approved norms and not production seed data. They exist so
every source row and anomaly can be reviewed without depending on the binary
DOCX during code review.

Rules:

- the authoritative source is the DOCX with SHA-256
  `443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177`;
- raw codes, units, values, duplicates, malformed identifiers, and populated
  continuation rows are intentionally retained;
- entirely empty physical rows remain available through `roadops:iqn02-stage`
  but are intentionally excluded from the derived resource-line views;
- no file here may be loaded directly into operational planning;
- `roadops:iqn02-stage` remains the lossless source-staging path;
- every staged row still needs an explicit expert decision and a hash-bound
  publication manifest.

`summary.json` and `REPORT.md` describe coverage and known anomalies.
`time-norms.csv`, `recurrence.csv`, `standard-machinery.json`,
`resource-requirements.csv`, and `resource-norms.json` provide candidate views
for domain review. `work-topics.json` isolates the 29 source headings that may
become road-master inspection subjects only after explicit expert publication.
A correction must be captured as reviewer-authored canonical data; the raw
candidate must not be silently overwritten.
