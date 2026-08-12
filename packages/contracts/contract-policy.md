# Contract approval policy

## RoadOps browser API

`openapi.yaml` is code-reviewed with every API or web change. A response or
request field may not be renamed independently in PHP and TypeScript. CI lints
the document; end-to-end tests remain the executable compatibility check.

Plan approval and publication are distinct state transitions. The preview
creator cannot approve their own plan; that attempt is a `409` conflict. Both
transitions revalidate the server-owned preview snapshot and live resource
constraints, and publication creates work orders inside one transaction. The
browser cannot override or attest the snapshot hash.

Planning candidate identifiers are namespaced strings, not UUIDs. Their prefix
(`DEFECT`, `ANNUAL` or `MANUAL`) is part of the identifier and cannot be removed
without a versioned contract change.

## External vendors

YTP and RoadVision schemas carry `PROPOSED_VENDOR_REVIEW_REQUIRED`. Moving either
adapter to `READY` requires a signed decision record containing:

- vendor/source owner and RoadOps owner;
- approved schema hash and version;
- sandbox evidence for create, update, retirement/withdrawal, replay and outage;
- authentication and key-rotation process;
- data retention, personal-data classification and incident contacts;
- reconciliation thresholds and rollback/replay procedures.

A changed vendor schema is introduced as a new file/version and processed in a
compatibility staging queue. Never silently relax `additionalProperties`, accept
unknown attribute codes or reinterpret historical events.

## Privacy and secrets

Contracts contain no credential examples. Worker/personnel data is limited to
what operations need, scoped by road division, and not returned to anonymous
clients. Evidence URLs must be short-lived and authorization-checked. Logs and
audit payloads redact passwords, session/CSRF hashes, TOTP secrets, vendor
credentials and cloud keys.
