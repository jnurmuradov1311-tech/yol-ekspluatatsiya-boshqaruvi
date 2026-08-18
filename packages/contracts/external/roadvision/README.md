# RoadVision result contract proposal

Status: **vendor-proposed; configuration required; not approved for production**.

The material available during implementation documents an S3 upload path for
customer input. It does not define a result API, result bucket, webhook, manifest,
withdrawal process or media-retention contract. Consequently:

- the default adapter must remain `CONFIGURATION_REQUIRED` or
  `CONTRACT_REVIEW_REQUIRED`;
- `proposed-result-event.schema.json` and `proposed-s3-manifest.schema.json` are
  negotiation artifacts only;
- production must reject unknown attribute codes and quarantine the current
  152-versus-153 catalog count discrepancy;
- every observation remains `PENDING_REVIEW` until a named human reviewer makes
  a verified, rejected or duplicate decision;
- direction and lane labels are preserved as source facts and remain visible in
  the review context;
- every JPEG, PNG and MP4 media entry is checksum-verified and served through
  its authorized, indexed same-origin evidence route. The browser API returns
  the complete media metadata list without any private `s3://` object URI;
- each object must expose the declared full-file SHA-256 as an S3 native
  checksum whose `ChecksumType` is `FULL_OBJECT`. User metadata is checked when
  present but cannot substitute for an S3-computed checksum. Missing, composite
  or mismatched checksums fail closed. Because this application caps evidence
  at 250 MiB, uploaders can use one checksum-enabled PUT instead of multipart
  SHA-256's composite semantics;
- no confidence, condition, priority or 0–100 score is accepted or exposed.

The sample uses a synthetic MP4 observation on D001 to exercise the video and
lane contract. Its values, IDs, locations and object URIs are not RoadVision
production data and contain no credentials.

For webhook delivery the proposal uses these headers:

1. `X-RoadOps-Timestamp`: Unix seconds, within five minutes of receipt.
2. `X-RoadOps-Signature`: hex HMAC-SHA256 of
   `{timestamp}.{exact_raw_request_body}`, optionally prefixed by `sha256=`.

The shared secret must be kept in the deployment secret manager and rotated with
an overlap window agreed with the vendor.
