# PALURU Central Secret Console — Security Contract

Status: Phase 1 mandatory contract

Priority: this contract overrides convenience, diagnostics, support, and automation behavior

## 1. Absolute rule

Secret values are write-only from the AI/Codex point of view.

Codex/AI must never retrieve, inspect, transcribe, compare, transform, hash, partially display, or place a secret value into a tool call, accessibility dump, terminal output, browser snapshot, chat, source file, Git object, artifact, report, log, trace, metric, audit event, test fixture, issue, or clipboard workflow.

The only permitted secret-value flow is:

```text
Human entry
-> dedicated sensitive input form over HTTPS
-> in-memory Console request handling
-> allowlisted backend adapter
-> approved secret backend / consumer slot
```

No reverse arrow exists through the Console API.

## 2. Prohibited operations

- Script Properties value read-back or `getProperties()` bulk retrieval for administration.
- Secret Manager payload access for inventory, diagnostics, testing, or AI assistance.
- Current/new/old value reveal, download, export, copy, compare, prefix, suffix, length, entropy, or hash endpoints.
- Secret settings-page accessibility dumps, screenshots, DOM extraction, browser automation, or session replay.
- Raw request/response logging, authorization-header logging, environment dumps, exception serialization, or provider error forwarding.
- Reversible encoding, encryption used as display, or values embedded in URLs/query strings/fragments.
- Secret material in source, Git, Markdown, JSON/YAML fixtures, generated reports, build artifacts, test snapshots, or support bundles.
- Arbitrary backend commands or arbitrary HTTP connectivity probes.
- Silent fallback to a legacy management path after a Console error.
- Automatic destruction or irreversible revoke after a partial failure.

Internally, a consumer may read its active credential to perform its normal authenticated request. A target-local adapter may determine configured/missing without returning the value. Those runtime necessities do not create a Console retrieval capability.

## 3. Trust boundaries

| Boundary | Trusted input | Untrusted input | Required control |
| --- | --- | --- | --- |
| Browser -> Console | authenticated session, server-issued CSRF and action nonce | all request fields, DOM state | re-auth/user presence, CSRF, schema/size validation, no-store |
| Console -> Registry | server-normalized metadata | browser IDs, revisions | allowlists, optimistic concurrency, no generic maps |
| Console -> Adapter | server-resolved binding, stable operation ID, transient value handle | adapter/provider response | fixed method set, redaction before serialization |
| Adapter -> backend | one allowlisted target/key/version action | provider errors/timeouts | least privilege, idempotency, uncertain-state reconciliation |
| Console -> Probe | registered probe ID | URLs, headers, bodies from client | server-owned runner; safe result reducer |
| Consumer runtime | active backend value | client identity/role claims | consumer authorization and validation remain authoritative |
| Audit | normalized safe event | request body, provider body, exception text | field allowlist and persistence verification |

PALURU Mini never becomes an admin-plane trust root. A compromised ordinary PWA session cannot list or mutate credentials.

## 4. Human/AI separation

### Human-only actions

- Enter a new credential value.
- Complete recent re-authentication/user-presence verification.
- Approve or reject disabling/revoking the old credential.
- Judge final production acceptance.

### AI-permitted actions

- Read and edit design/source that contains no credential value.
- Work with logical names, backend types, consumer bindings, configured/missing, enabled/disabled, safe connectivity status, rotation metadata, safe audit metadata, and redacted error codes.
- Run synthetic tests using unmistakably synthetic non-production inputs when the test output cannot be confused with a real credential.

### AI-forbidden actions

- Open or inspect the sensitive input page while a value is present.
- Use browser/computer automation to type, paste, submit, inspect, or screenshot a value.
- Call a value-access API, CLI command, Script Properties read, Secret Manager payload read, or raw environment dump.
- Ask the Human to send the value through chat or a terminal command that would expose it to transcripts/history.

Operating procedure: before the Human enters a value, Codex stops UI control. The Human performs the sensitive entry and submits it. Codex may resume only on a redacted status page after the input document has been replaced and the field cleared.

## 5. Identity and authorization

- Console access requires an authenticated Human identity; anonymous access is forbidden.
- Viewer/operator/approver capabilities are server-derived and deny by default.
- Every secret mutation requires recent re-authentication or a user-presence assertion bound to the exact logical credential and action.
- Old-disable/revoke requires a separate one-time approval after fresh successful probes.
- Browser-supplied role, actor, backend, target, property key, resource name, probe URL, and consumer identity are never authorization inputs.
- Production and non-production registries, identities, projects/targets, and sessions are isolated.
- Runtime identities receive only the permissions needed for their individual binding. For Secret Manager, prefer secret-level `roles/secretmanager.secretAccessor` rather than project-wide access.
- Apps Script API `scripts.run` is not designed for service accounts. Any Human-delegated OAuth design must document scopes, token lifetime/storage, consent, revocation, target restrictions, and blast radius before approval.

## 6. Sensitive browser form

The secret-entry document:

- loads no third-party JavaScript, analytics, fonts, tags, error reporters, or session replay;
- uses a strict same-origin CSP and `frame-ancestors 'none'`;
- sends only a JSON body to the single write-only route over HTTPS;
- marks the field to discourage autocomplete and spellcheck, while not relying on browser hints as a security control;
- never copies the value into URL, title, DOM attributes, hidden fields, client logs, local/session storage, IndexedDB, service-worker cache, or application state stores;
- prevents double submission and clears/replaces the document after response;
- does not expose show/reveal, copy, prefix/suffix preview, or strength-meter features;
- applies a category-specific maximum request size; and
- shows only accepted/rejected, never detailed value validation feedback.

The normal metadata UI never receives the value and cannot reconstruct it.

## 7. Server and adapter handling

- Disable request-body capture before the framework/APM layer for the secret-input route.
- Do not interpolate the value into exceptions, structured fields, spans, metrics, filenames, command arguments, environment variables used by child processes, or provider labels.
- Use fixed adapter calls rather than shell commands.
- Keep the value in the smallest possible scope and release references immediately after the adapter returns.
- Use locks and stable operation IDs; never derive idempotency from the value.
- Redact at the boundary, before provider responses or exceptions enter shared handling.
- On uncertain result, record `OPERATION_STATE_UNKNOWN`; do not blindly retry with a new operation.
- For GAS, mutate only an allowlisted property/slot and never use bulk read/delete-all behavior.
- For Secret Manager, add a version through the API and return only an opaque adapter-owned revision alias.

Memory zeroization is not guaranteed by managed runtimes. The design therefore minimizes copies, lifetime, and observability, and never claims cryptographic erasure of process memory.

## 8. Audit contract

Allowed audit fields:

```text
eventId, occurredAt, actorId, actorRole, authMethod,
action, credentialId, rotationId, bindingId, consumerId,
previousState, nextState, outcome, safeCode,
idempotencyReference, requestId, approvalId,
backendType, adapterOperationAlias, consumerBuildAlias, elapsedMs
```

Forbidden audit fields:

```text
request/response body, headers, cookies, query strings,
secret/token/key/password/value, value length, prefix/suffix/hash,
provider raw errors, environment/property dumps, endpoint URL,
Script ID, Spreadsheet ID, Calendar/Inbox/health/personal content
```

Audit is append-only at the application contract. A state mutation is not reported healthy until its corresponding event is durably readable by event/rotation/request ID. Secret Manager Cloud Audit Logs provide provider evidence for version and access operations; Data Access logging configuration must be explicitly verified where relied upon.

## 9. Redacted diagnostics contract

Diagnostics are built from a field allowlist, not a blacklist. The maximum response is:

```json
{
  "credentialId": "logical-id",
  "bindingId": "binding-id",
  "consumerId": "consumer-id",
  "backendType": "backend-type",
  "configured": true,
  "enabled": true,
  "connectionStatus": "pass",
  "safeCode": "PASS",
  "stage": "connectivity_probe",
  "elapsedMs": 120,
  "checkedAt": "2026-09-17T00:00:00+09:00",
  "requestIdSuffix": "safe-suffix",
  "buildId": "consumer-provided-build-alias"
}
```

`requestIdSuffix` is generated from a non-secret correlation ID, never from credential material.

## 10. Threat review

| Threat | Impact | Required mitigation | Residual risk / gate |
| --- | --- | --- | --- |
| Compromised ordinary PALURU/PWA session | root credential mutation | physically separate admin plane; no Console routes in Mini | Console identity still needs strong protection |
| XSS or third-party script on input page | secret theft | isolated document, strict CSP, no third parties, output encoding | browser/extension compromise remains |
| CSRF/replayed mutation | unauthorized change | same-origin CSRF, action nonce, re-auth, idempotency, revision check | stolen authenticated browser session |
| Logs/APM capture request body | durable leakage | route-level body capture disabled; allowlisted telemetry; tests | infrastructure defaults must be verified live |
| AI/computer-use inspection | transcript leakage | Human-only entry procedure; no reveal/read endpoint; stop UI automation | Human process error |
| Over-privileged Console identity | broad compromise | per-target/secret least privilege; separate environments | GAS transport decision unresolved |
| Single-slot GAS overwrite | outage and no rollback | production direct replace forbidden; dual-slot/equivalent required | requires consumer code review in Phase 3 |
| Partial multi-binding activation | auth mismatch/outage | ordered operations; stop; reverse rollback; old remains valid | rollback can fail and require manual recovery |
| Secret Manager `latest` drift | unintended activation | pin env-var versions; explicit revision activation | volume semantics require separate verification |
| Probe as SSRF/data exfiltration | internal access/leak | registry-defined runners only; no client URL/headers/body | runner code must remain narrowly scoped |
| Provider raw error reflection | secret/metadata leak | boundary redaction and safe error catalog | provider SDK changes need regression tests |
| Audit failure hidden | untraceable mutation | fail/unknown state; durable read-back check | audit-store outage blocks rotations |
| Old credential destroyed too early | irreversible outage | disable before destroy; Human approval; retention | external provider may not support re-enable |
| Inventory falsely considered complete | unmanaged credentials remain | per-repository and live-binding evidence; preserve `unknown` | full inventory is deferred beyond Phase 1 |

## 11. Mandatory security tests

Before production use:

1. Assert every response and audit record omits submitted synthetic input and all derived forms.
2. Assert access/error/APM logs omit the secret-input body on success, validation failure, adapter failure, and timeout.
3. Assert no GET/reveal/export/raw/debug endpoint exists.
4. Assert property/status inspection returns boolean/enums only and never uses a bulk property read.
5. Assert provider raw errors are replaced by safe codes.
6. Assert arbitrary probe URLs, headers, methods, and bodies are rejected.
7. Assert CSRF, stale user presence, stale revision, expired approval, and idempotency conflict fail closed.
8. Assert partial distribution stops and rolls back only changed bindings.
9. Assert audit persistence failure blocks success.
10. Assert mock mode cannot resolve production targets or credentials.
11. Run repository secret scanning without printing matching values.
12. After deployment, verify actual redacted audit retrieval and consumer connectivity; code presence alone is insufficient.

## 12. Official basis

- Apps Script stores Script Properties per script and exposes get/set APIs: [Properties Service](https://developers.google.com/apps-script/guides/properties).
- Apps Script remote execution requires Human OAuth/common Cloud project and does not support service accounts: [Execute functions with the Apps Script API](https://developers.google.com/apps-script/api/how-tos/execute).
- Secret Manager provides versions, IAM, disable/enable, rollback support, and audit integration: [Secret Manager overview](https://cloud.google.com/secret-manager/docs/overview), [access control](https://cloud.google.com/secret-manager/docs/access-control), [audit logging](https://cloud.google.com/secret-manager/docs/audit-logging).
- Cloud Run environment-variable secrets are resolved at instance startup and should be pinned to a version: [Configure secrets for services](https://cloud.google.com/run/docs/configuring/services/secrets).
