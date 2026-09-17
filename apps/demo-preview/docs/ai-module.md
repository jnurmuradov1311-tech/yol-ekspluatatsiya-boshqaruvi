# IQN work selection

The Site now has a server-only OpenAI Responses adapter in `worker/ai.ts`.
Its default model is `gpt-5.6-luna`; `OPENAI_MODEL` is an optional server runtime override.
`OPENAI_API_KEY` is a server runtime secret. It is never read by frontend code,
returned by status, or included in source/build configuration. Hosted runtime
secrets are managed in Sites; an ignored local env file does not configure production.

On 2026-09-11, secure key provisioning was attempted with the user's consent.
Platform authentication succeeded, but encrypted key creation returned
“OpenAI Platform rejected the API key request.” No key was created or saved.
Live provider access, account/model permissions and real output quality therefore
remain unverified. The published app reports that AI is unconfigured and retains
its explicitly labelled IQN demo proposal.

## Request boundary

`GET /api/ai/status` reports only whether the runtime key is configured.
`POST /api/ai/work-selection` accepts bounded defect type, original observation,
confirmed quantity, typed repair measurements, chief review and clarification text.
Both require the identity header injected by Sites dispatch. POST additionally
requires same-origin JSON. Existing owner-private Site access controls remain in force.
The browser's demo chief/foreman role is not used as server authentication.

Only defect data is sent to the provider: no worker names, wages, credentials,
road coordinates, inventory or uploaded evidence. This module does not process
RoadVision video or make claims about seeing images. RoadVision ingestion remains
a separate demo capability.

## Selection and execution

The server generates the eligible set from the source IQN catalog, matching units,
usable norms and explicit defect mappings. Unmapped types are scoped to their IQN
topic. Potholes additionally require typed thickness, maximum individual area and
old-pavement removal choice. Text cannot waive those measurements.

Required-context questions can be answered in the planner or the existing chief
review. The model assesses whether the answer actually resolves the question.
An unknown work ID, unresolved question, refusal, incomplete response or invalid
JSON cannot become a selected work. Model instructions treat observations and
answers as data, not commands.

The model returns work selection and its explanation only. Existing deterministic
IQN calculations allocate time/crew, retain unknown resource-recipe blockers and
route shortages to requisitions. The model cannot change quantities, norms, prices,
stock, staff, approvals or dispatch state. The chief still approves execution.
Selection provenance and clarification are retained with the session's plan input;
the business demo still resets on full reload.

Requests have a 30-second provider timeout and 1,800-token output cap. Identical
in-flight requests are coalesced; validated results are cached for five minutes per
authenticated user. The six-request/minute guard is isolate-local, not a distributed
billing cap. Provider errors are surfaced without echoing response bodies and without
automatic retry. A provider failure never masquerades as successful AI advice.

## Validation

- `node --test tests/ai-selection.test.mjs tests/connected-demo.test.mjs`
- `ROADOPS_TEST_DEPENDENCIES=<test dependency directory> node tests/run-planner-interaction.mjs`
- Normal Sites production build and artifact validation.

Provider tests use mocked Responses payloads and assert no live request occurs when
authentication, input validation or runtime configuration is missing. UI interaction
tests cover demo compatibility, live-mode provenance, clarification edits, retained
resource blockers and provider failures. Live model evaluation is still required
once Platform permits provisioning; no live model success is claimed.

Official request references:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/guides/error-codes
