# PALURU Central Secret Console — Architecture

Status: Phase 1 Design Review candidate

Reviewed baseline: 2026-09-17 (Asia/Tokyo)

Scope: design only. No credential value was read or changed, and no production code or deployment was changed.

## 1. Decision

PALURU Central Secret Console is an **independent admin plane**. It is not a PALURU Mini screen, route, or runtime responsibility. Human operators use one logical-credential UI, while physical storage remains hybrid and migrates incrementally.

```text
Human operator
    |
    | authenticated browser session + explicit user presence
    v
Secret Console UI                     (independent admin plane)
    |
    v
Secret Console Admin API
    |-- Registry Store                (metadata only; never secret material)
    |-- Rotation Coordinator          (state and orchestration)
    |-- Audit Ledger                  (append-only redacted events)
    |-- Connectivity Probe Runner     (allowlisted safe probes)
    `-- Secret Backend Port
         |-- GAS Script Properties Adapter
         `-- Google Secret Manager Adapter
                  |
                  `-- Cloud Run binding/revision activation

PALURU Mini runtime ----------------- separate consumer plane
Kaz OS gateway ---------------------- separate consumer plane
Other HomeApps ---------------------- separate consumer planes
```

The Console owns credential administration orchestration. Each consumer continues to own authorization, validation, business rules, and runtime use of its credential. The Console cannot turn a failed credential update into a successful runtime result.

## 2. Verified baseline and limits

The repository code shows that `KAZ_OS_PROGRESS_READ_TOKEN` is currently read by the three Mini consumer paths in `gas/KazOsProgress.js`, `gas/KazOsProjects.js`, and `gas/KazOsInbox.js`. The Kaz OS gateway source reads the corresponding bearer from its server environment. This establishes one logical credential with multiple physical bindings.

This Phase 1 review did **not** inspect Script Properties values, Secret Manager payloads, the credential settings UI, or production connectivity. It does not claim that the locally documented Kaz OS gateway is deployed or currently reachable.

## 3. Goals and non-goals

### Goals

- Give the Human one UI organized by stable logical `credentialId` values.
- Hide physical property keys, resource identifiers, versions, and adapter commands from normal UI flows.
- Support Script Properties during staged migration and prefer Secret Manager for Cloud Run workloads.
- Make status, rotation, partial failure, rollback, connectivity, and audit visible without revealing secret material.
- Preserve each consumer's current runtime contract until that consumer receives a separately reviewed migration.
- Make every mutation explicit, idempotent, scoped to one credential rotation, and fail closed.

### Non-goals

- Moving every credential to one backend in a Big Bang.
- Adding root credential administration to PALURU Mini.
- Returning, exporting, comparing, hashing, previewing, or recovering credential values.
- Automatically rotating external-provider credentials without a provider-specific approved workflow.
- Treating an adapter write as connectivity or end-to-end acceptance.
- Renaming a physical Script Property as part of the logical-name introduction.

## 4. Source-of-truth boundaries

| Data | Source of truth | Secret material allowed |
| --- | --- | --- |
| Logical credential definition | Credential Registry | No |
| Consumer binding metadata | Binding Registry | No |
| Rotation workflow state | Rotation Store | No |
| Secret payload | Selected backend only | Yes, but never returned through Console APIs |
| Runtime authorization/business rules | Consumer service | No new authority delegated to Console |
| Audit events | Append-only Audit Ledger; provider audit logs where available | No |
| Human-facing status | Derived redacted projection | No |

Registry records may contain stable aliases such as `script_target_ref` or `secret_ref`. A separate server-only target resolver maps those aliases to physical resource identifiers. Normal UI and metadata responses do not expose Script IDs, raw URLs, project numbers, property keys, environment variable names, or secret version resource names.

## 5. Core contracts

### 5.1 Registry

The Registry maps a logical credential to one or more bindings. It never stores secret content, an encoded form, prefix/suffix, or a secret-derived fingerprint. The normative model is in [credential-registry.schema.md](credential-registry.schema.md).

### 5.2 Rotation Coordinator

The coordinator:

1. validates the credential and binding set;
2. creates one rotation with an immutable binding snapshot;
3. accepts one Human-entered value through the write-only endpoint;
4. invokes adapters in the declared rollout order;
5. records redacted results per binding;
6. runs only allowlisted connectivity probes;
7. requires Human approval before disabling the old credential;
8. closes only after regression checks; and
9. starts rollback on partial or verification failure according to the binding capabilities.

The coordinator never requests a current value from an adapter and never supplies a secret to a log, error, metric, trace, audit event, or response serializer.

### 5.3 Secret Backend Port

Every adapter implements this behavior contract. Method names are conceptual; they are not public HTTP routes.

| Operation | Input | Redacted output | Required behavior |
| --- | --- | --- | --- |
| `inspectStatus` | binding metadata | configured/missing, enabled/disabled, connection state | No value read-back; no bulk property read |
| `stage` | rotation context plus write-only value handle | operation ID, stage status, backend revision alias | Idempotent by operation ID |
| `activate` | staged operation ID | activation status | Fail closed if stage is absent or stale |
| `verifyBinding` | binding and allowlisted probe ID | pass/fail, safe code, elapsed time | No echo or provider raw body |
| `disablePrevious` | rotation ID plus Human approval ID | disabled/not-supported/failure | Must not destroy on first disable |
| `rollback` | rotation and adapter-owned revision/slot references | rolled-back/failure | No value returned |

An adapter declares capabilities before a rotation starts:

```text
stage | atomic_activate | versioned | dual_slot | disable_previous |
rollback_before_revoke | rollback_after_revoke | status_probe | connectivity_probe
```

The coordinator refuses a plan whose required rollback or verification capability is absent. It does not silently fall back to direct replacement.

## 6. Backend-specific behavior

### 6.1 GAS Script Properties Adapter

Apps Script Script Properties are script-scoped string key/value storage. They do not natively provide Secret Manager-style version activation and rollback. The adapter therefore follows these rules:

- use a target-local, allowlisted write function that maps an opaque binding ID to one server-controlled property key;
- change only that one property/slot; never call a delete-all or replace-all operation;
- return only configured/missing and redacted operation status;
- guard mutation with a script lock and an idempotency operation record;
- never return the old, staged, or active value;
- forbid direct replacement when the rotation requires staged verification and rollback;
- require a reviewed dual-slot or equivalent compensation design before a production rotation; and
- keep the physical property name decision separate from the logical credential name.

The production transport to the target-local function is **not yet selected**. The Apps Script API `scripts.run` requires user OAuth, a common standard Cloud project, and an API-executable deployment, and it does not support service accounts. A public Web App management route would introduce a new high-risk authentication surface. Phase 3 preflight must compare those choices and approve one before production code is changed. Phase 2 uses only a synthetic adapter.

### 6.2 Google Secret Manager Adapter

The adapter adds a new secret version and records only its opaque version alias in rotation state. It grants no new project-wide access. Runtime identities receive the minimum accessor role on individual secrets.

For Cloud Run:

- environment-variable injection uses a pinned version and requires a new revision to activate;
- volume delivery may observe a newer version, but production rotations still use an explicit version/activation record for deterministic rollback;
- `latest` is not used for an environment-variable binding;
- the previous version is disabled only after Human approval and successful regression; and
- destruction is a later retention action, never part of the first revoke step.

Google Cloud audit logs complement, but do not replace, the Console audit ledger.

## 7. Redacted diagnostics

A diagnostic record contains only:

```text
credentialId, bindingId, consumerId, backendType,
configured, enabled, connectionStatus,
safeCode, stage, elapsedMs, checkedAt,
rotationId, requestIdSuffix, buildId (when the consumer provides one)
```

It must not contain request/response bodies, authorization headers, environment dumps, property collections, secret length, prefix, suffix, hashes, physical URLs, Script IDs, tokens, Calendar/Inbox/health content, or provider error text that could contain user input.

Connectivity is three separate facts:

1. backend write acknowledged;
2. binding status reports configured;
3. allowlisted consumer smoke passes.

Only the third may be shown as `connectivity=pass`. None implies end-user acceptance.

## 8. First PoC design: `kaz_os_read`

The proposed stable logical ID is `kaz_os_read`. It represents the private bearer used by these consumer routes:

- `/v1/progress`
- `/v1/projects`
- `/v1/inbox`

Proposed binding roles, without fixing physical names:

| Binding | Consumer | Backend | Role |
| --- | --- | --- | --- |
| `kaz_os_read.mini` | PALURU Mini GAS | Script Properties | outbound bearer supplied to all three routes |
| `kaz_os_read.gateway` | Kaz OS read gateway | Secret Manager plus Cloud Run binding | inbound bearer accepted by the gateway |

The safe overlap design requires old and new credentials to coexist temporarily at both bindings. A single-slot overwrite is not acceptable because it cannot provide the required staged smoke and rollback without retaining the old value. Before Phase 3, a separate design review must approve:

- the GAS write transport and Human OAuth boundary;
- target-local dual-slot/active-slot behavior or another reversible mechanism;
- gateway dual-acceptance during the overlap window;
- a probe that tests the staged credential without putting it in a URL, response, log, or AI-controlled tool transcript;
- exact old-disable and emergency re-enable behavior; and
- retention time before old material may be destroyed.

Phase 3 sequencing is then:

```text
preflight
-> create rotation
-> Human enters new value in Console
-> stage both bindings
-> verify staged path
-> activate Mini new slot
-> Progress / Projects / Inbox smoke
-> Human old-disable approval
-> disable old acceptance
-> regression
-> close or rollback
```

The Console must show one logical credential and three connectivity probes; the Human does not enter or select backend property names.

## 9. Rollback model

Rollback is capability-driven and preserves partial state.

- Before old disable: reactivate the previous binding/version and keep the new stage for diagnosis or explicit cleanup.
- After reversible old disable: re-enable the previous provider version/credential, reactivate prior bindings, and rerun the same probes.
- After irreversible provider revocation: automatic rollback is impossible. The rotation cannot enter that step unless a separately approved replacement/emergency procedure exists.
- On partial distribution: do not continue to smoke or revoke. Roll back only bindings already activated; leave untouched bindings untouched.
- On audit persistence failure: treat the mutation as failed/unknown and stop. A caught audit error is not healthy operation.

Rollback never deletes unrelated properties, versions, revisions, or user data.

## 10. Audit model

Every state-changing request produces an append-only redacted event with:

- event ID and `rotationId`;
- ISO 8601 time rendered in `Asia/Tokyo`;
- authenticated Human actor ID and authorization method;
- action, credential ID, binding ID when applicable;
- prior and resulting workflow states;
- success/failure plus allowlisted safe code;
- idempotency key reference and correlation/request ID;
- approval ID for old-disable actions; and
- build/revision aliases needed for rollback.

The event excludes secret values, secret-derived data, raw provider responses, request bodies, headers, browser storage, personal data, and infrastructure identifiers not needed by the operator.

## 11. Human and AI responsibilities

| Actor | May do | Must not do |
| --- | --- | --- |
| Human | authenticate, choose logical credential, enter a new value, approve old disable, judge acceptance | paste values into chat, logs, source, issue text, or test artifacts |
| Console UI/API | accept a value transiently, write it to an approved adapter, return redacted status | provide read/export/reveal endpoints or persist request bodies |
| Adapter | perform one allowlisted backend mutation and safe status/probe | return old/new values, bulk-read properties, or widen access |
| Consumer | use the active value and enforce its own runtime policy | trust Console metadata as runtime authorization |
| Codex/AI | work with logical names, binding/status metadata, safe codes, and design/test artifacts | access the secret input UI, accessibility dump it, retrieve payloads, or run read-back commands |

## 12. Decision gates

Phase 1 decision: **CONDITIONAL GO for Phase 2 synthetic prototype only**.

Conditions before any Phase 3 production credential change:

1. approve the concrete GAS write transport;
2. approve reversible overlap for both PoC bindings;
3. implement and test no-read/no-echo/no-log controls;
4. define operator identity, session, re-authentication, CSRF, and user-presence controls;
5. verify actual audit persistence, not only caught logging calls;
6. prepare exact Progress/Projects/Inbox acceptance and rollback evidence; and
7. obtain explicit Human approval immediately before production rotation.

## 13. References

- [Apps Script Properties Service](https://developers.google.com/apps-script/guides/properties)
- [Execute functions with the Apps Script API](https://developers.google.com/apps-script/api/how-tos/execute)
- [Secret Manager overview](https://cloud.google.com/secret-manager/docs/overview)
- [Secret Manager access control](https://cloud.google.com/secret-manager/docs/access-control)
- [Secret Manager audit logging](https://cloud.google.com/secret-manager/docs/audit-logging)
- [Configure secrets for Cloud Run services](https://cloud.google.com/run/docs/configuring/services/secrets)
