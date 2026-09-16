# PALURU Central Secret Console — Phase 2 Prototype Plan

Status: Phase 1 plan; execution is not authorized by this document

Phase 2 goal: independent Human-facing admin-plane prototype using mock/synthetic credentials only

## 1. Scope boundary

Phase 2 may implement:

- credential list/detail UI;
- display name, status, friendly backend summary, consumers, last-rotated metadata, and connectivity;
- `[変更]`, `[疎通確認]`, and `[rotation準備]` workflows;
- the API/state machine defined in this directory;
- synthetic GAS-like and Secret-Manager-like adapters;
- redacted audit and failure-injection test paths; and
- responsive Human input UI.

Phase 2 must not:

- modify any production credential, Script Property, Secret Manager secret/version/IAM, Cloud Run service/revision, deployment, or consumer code;
- add root administration to PALURU Mini;
- import a production registry, target resolver, endpoint, Script ID, project/resource ID, OAuth grant, or cloud credential;
- implement a secret read/reveal/export/compare/hash endpoint;
- use real provider credentials in tests; or
- proceed into the `kaz_os_read` production PoC.

## 2. Component placement

Prototype code belongs in a new independent component/repository such as `paluru-secret-console`, not under PALURU Mini runtime source (`app.js`, `gas/`, `features/`, or PWA routes). These six Phase 1 documents remain in PALURU Mini as the cross-system design record.

Recommended logical package boundaries:

```text
secret-console/
  ui/                  # metadata pages and isolated sensitive input page
  api/                 # HTTP contract, auth/CSRF/re-auth guards
  registry/            # schema validation and metadata store port
  rotation/            # state machine and coordinator
  adapters/
    fake-gas/
    fake-secret-manager/
  probes/              # fixed synthetic runners
  audit/               # append-only port and redacted event serializer
  test/
```

This is a responsibility layout, not authorization to create the component in Phase 1.

## 3. Prototype decisions

- Use one server-rendered or same-origin UI; no third-party scripts on the sensitive form.
- Keep registry/audit interfaces vendor-neutral so production storage can be selected after prototype evidence.
- Use synthetic fixed records, including `demo_internal_read`, rather than real logical credentials if a tester could confuse them with production.
- Label every page `NON-PRODUCTION / SYNTHETIC`.
- Bind only to loopback or an explicitly isolated non-production environment.
- Deny network egress from fake adapters where the runtime supports it.
- Use a fake identity provider/session in local automated tests and document the production authentication decision as unresolved.
- Design mobile controls at least 48 px high and body/input text at least 16 px; verify 320 px and 390 px widths without horizontal scrolling.

## 4. Implementation steps

### Step 1 — Contract harness

- Encode registry, binding, rotation, and response validation.
- Reject unknown fields and forbidden secret-like fields outside the one input DTO.
- Add the safe error catalog and response serializer.
- Add a structural test that no route matches read/reveal/export/raw/debug semantics.

Exit: schemas and contract tests pass without a UI or adapter.

### Step 2 — Registry and redacted projections

- Create synthetic credentials spanning both fake backend types.
- Implement list/detail projections that omit target/key refs and physical identifiers.
- Represent `unknown`/`unverified` explicitly; do not infer healthy status.

Exit: UI DTO snapshots contain only allowlisted metadata.

### Step 3 — Rotation state machine

- Implement guarded transitions, revision checks, one-active-rotation rule, and action permissions.
- Implement per-binding states and reverse-order rollback selection.
- Add deterministic time and `Asia/Tokyo` rendering tests.

Exit: every valid transition and invalid transition has a test.

### Step 4 — Synthetic adapters and probes

- Fake GAS adapter: simulate one allowlisted binding, dual slot, lock, idempotency, configured status, partial failure, timeout, and rollback.
- Fake Secret Manager adapter: simulate versions, pin/activate, disable/re-enable, IAM denial, uncertain result, and rollback.
- Fixed probes: success, auth failure, source failure, timeout, and malformed provider response reduced to safe codes.

Exit: no adapter exposes a value-returning method and arbitrary probes are impossible.

### Step 5 — Audit ledger

- Persist only the allowlisted audit schema.
- Verify persistence by reading events back using rotation/event/request IDs.
- Inject audit write/read failures and confirm workflow success is blocked.

Exit: an actual persisted synthetic rotation can be traced without secret material.

### Step 6 — Human UI

- Build inventory, credential detail, rotation preparation, sensitive input, verification, revoke approval, rollback, and audit views.
- Keep physical key/resource fields out of normal forms.
- Replace and clear the sensitive document after submit.
- Show separate facts for configured, staged/distributed, connectivity, and acceptance.

Exit: desktop, 390 px, and 320 px layout checks pass; current value is never displayed.

### Step 7 — Security and failure testing

- Test CSRF, stale re-auth, replay, concurrent rotations, stale revisions, double submit, partial distribution, audit outage, adapter timeout, and provider raw errors.
- Search responses, DOM, browser storage, logs, audit, test output, and artifacts for the submitted synthetic marker and derived encodings.
- Run secret scanning with value-safe output.

Exit: leak count is zero and failure states are recoverable or explicitly manual.

### Step 8 — Human acceptance and Phase 3 Design Review package

- Human enters a synthetic credential through the Console only.
- Demonstrate inventory, change, connectivity, prepare, distribute, approval, disable, regression, and rollback.
- Record redacted evidence and unresolved production decisions.
- Prepare, but do not execute, the `kaz_os_read` preflight.

Exit: Human accepts the prototype and approves or rejects proceeding to Phase 3 design review.

## 5. Acceptance matrix

| ID | Acceptance | Evidence |
| --- | --- | --- |
| P2-01 | Console is physically/logically separate from PALURU Mini | repository/component and route inspection |
| P2-02 | Current value is never shown | UI/browser response tests |
| P2-03 | No secret read endpoint exists | route inventory and negative tests |
| P2-04 | Browser response contains no submitted synthetic marker | success/failure/timeout tests |
| P2-05 | Logs/traces/audit contain no marker or derived form | capture and scan |
| P2-06 | Registry separates logical credential from bindings | schema/projection tests |
| P2-07 | Human UI does not require physical property/resource names | browser acceptance |
| P2-08 | Adapter results are redacted and idempotent | retry/conflict tests |
| P2-09 | Partial failure is detected and no revoke follows | failure-injection test |
| P2-10 | Rollback restores the synthetic prior binding | end-to-end state test |
| P2-11 | Audit event is actually persisted and retrievable | durable read-back test |
| P2-12 | Mock mode cannot address production targets | configuration and egress tests |
| P2-13 | 320 px/390 px UI has no horizontal overflow and usable controls | real-browser screenshots/measurements |
| P2-14 | No production credential/infrastructure mutation occurred | scoped diff plus cloud/GAS change audit |

## 6. Required tests

### Unit

- schema enums, formats, uniqueness, and cross-record references;
- forbidden fields and unknown-field rejection;
- state-transition guards and terminal states;
- redaction of adapter/provider errors;
- idempotency and optimistic concurrency;
- safe probe reduction;
- audit field allowlist;
- Asia/Tokyo timestamp rendering.

### Integration

- full synthetic rotation across two fake bindings;
- partial stage and partial activation;
- pre-revoke probe failure and rollback;
- expired approval and stale registry revision;
- old-disable failure and re-enable recovery;
- post-disable regression failure;
- audit-store outage and uncertain adapter result;
- concurrent-rotation rejection.

### Browser

- metadata list/detail;
- masked new-value entry with no reveal control;
- field/document clearing after submission;
- back/refresh does not restore the value;
- no third-party requests or browser storage writes;
- responsive layout and keyboard/touch usability;
- redacted state/audit rendering.

### Security

- synthetic marker scan of source exclusions, HTTP captures, logs, traces, errors, DOM, storage, audit, and test artifacts;
- CSP/frame/CSRF/re-auth checks;
- arbitrary target/probe/property/resource injection rejection;
- no production configuration or egress available in mock mode.

## 7. Phase 3 Design Review inputs

Phase 2 must produce evidence, not an automatic promotion. Phase 3 review requires:

1. selected production hosting and Human authentication model;
2. selected GAS consumer-write transport, including why rejected options are unsafe or infeasible;
3. OAuth scopes/token lifecycle if Human-delegated `scripts.run` is selected;
4. target-local dual-slot/equivalent design for Mini;
5. dual-acceptance and version activation design for the Kaz OS gateway;
6. secret-level IAM and Cloud Run revision plan;
7. exact Progress, Projects, Inbox, unrelated regression, leak, and audit tests;
8. old-disable/re-enable/retention policy;
9. rollback runbook with stop conditions; and
10. explicit Human approval for each production mutation.

## 8. Risks and stop conditions

| Risk | Phase 2 response |
| --- | --- |
| Prototype accidentally gains production access | stop; remove access; audit before continuing |
| Framework logs sensitive request bodies | NO-GO until disabled and verified |
| UI retains value after submit/back/refresh | NO-GO |
| Adapter interface requires read-back/hash to work | redesign; do not weaken contract |
| GAS transport cannot be strongly authenticated and scoped | Phase 3 NO-GO for GAS distribution |
| Single-slot production binding remains | Phase 3 rotation blocked |
| Audit cannot prove persisted events | prototype remains incomplete |
| Physical/backend identifiers leak into Human workflow | correct projection before acceptance |

## 9. Rollback for Phase 2 itself

Phase 2 contains synthetic data only. Rollback is to stop the isolated prototype, remove its synthetic datastore/artifacts through the approved project cleanup process, and leave PALURU Mini, Apps Script, Secret Manager, Cloud Run, and all production credentials unchanged. Cleanup is not part of Phase 1 and must be explicitly scoped when performed.

## 10. Phase 2 entry decision

**CONDITIONAL GO** after Human accepts the Phase 1 Design Review.

This plan does not authorize creating the new component, installing dependencies, provisioning cloud resources, deploying, accessing credential UIs, or changing credentials.
