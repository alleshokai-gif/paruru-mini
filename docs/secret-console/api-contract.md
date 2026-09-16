# PALURU Central Secret Console — API Contract

Status: Phase 1 normative contract

API prefix: `/admin/secret-console/v1`

Audience: authenticated Human operator and the Console UI only

## 1. Contract rules

- The API is part of the independent Secret Console admin plane, not PALURU Mini.
- Every route is authenticated, authorized, same-origin, HTTPS-only, and `Cache-Control: no-store, private`.
- Mutation routes require CSRF protection, a recent Human re-authentication/user-presence assertion, an idempotency key, and an optimistic-concurrency revision.
- The secret-input request is write-only. Its body is excluded from access logs, traces, error reports, analytics, replay tools, support dumps, and audit payloads.
- Responses never contain a submitted/current/previous value, encoded value, prefix/suffix, length, hash, comparison result, or provider raw response.
- Unknown errors become an allowlisted generic code. Known safe adapter codes are preserved.
- There is no automatic fallback to another backend or management path.

## 2. Authentication and roles

| Role | Allowed operations |
| --- | --- |
| `secret_console_viewer` | redacted credential, binding-summary, connectivity, rotation-state, and audit reads |
| `secret_console_operator` | viewer operations; create rotation; submit new value; stage/distribute/verify/rollback |
| `secret_console_approver` | viewer operations; approve or reject old-disable; cannot submit a value in the same rotation when separation of duties is enabled |

Phase 2 may use one Human with both operator and approver roles for synthetic data, but the API retains distinct actions and audit events. Production role assignment is a Phase 3 gate.

The server obtains actor identity from its trusted authentication layer. It rejects actor IDs, roles, scopes, target refs, property keys, resource names, probe URLs, and backend types supplied by the browser when those fields are server-resolved.

## 3. Common headers

Requests:

```text
Content-Type: application/json
X-CSRF-Token: session-bound token
Idempotency-Key: unique operation key       # mutations only
If-Match: "record-revision"                  # state mutations only
```

Responses:

```text
Cache-Control: no-store, private
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; form-action 'self'; frame-ancestors 'none'
```

The secret-input page additionally disables third-party scripts, analytics, session replay, autocomplete persistence, and browser form restoration.

## 4. Response envelopes

Success:

```json
{
  "success": true,
  "data": {},
  "requestId": "redacted-correlation-id"
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "ROTATION_STATE_CONFLICT",
    "message": "The rotation cannot perform this action in its current state."
  },
  "requestId": "redacted-correlation-id"
}
```

`message` is selected from a server-side catalog. Provider error messages, stack traces, request bodies, and field values are not returned.

## 5. Read endpoints

### `GET /credentials`

Returns the redacted inventory projection.

Query parameters are limited to allowlisted `environment`, `status`, and opaque page cursor. Search terms are not reflected into logs.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "credentialId": "kaz_os_read",
        "displayName": "Kaz OS read access",
        "status": "active",
        "backendSummary": ["Script storage", "Cloud secret storage"],
        "consumers": ["PALURU Mini", "Kaz OS read gateway"],
        "lastRotatedAt": null,
        "connectivity": "unverified",
        "activeRotationId": null,
        "revision": 1
      }
    ],
    "nextCursor": null
  },
  "requestId": "example-request-id"
}
```

### `GET /credentials/{credentialId}`

Returns the same credential metadata plus redacted binding summaries and registered probes. It omits `targetRef`, `keyRef`, Script ID, URL, project/resource names, environment variable names, and provider version identifiers.

### `GET /rotations/{rotationId}`

Returns state, safe per-binding status, probe status, timestamps, approvals, and permitted next actions. It has no input-status field that reveals length, shape, or comparison of a value. The only allowed input receipt fact is `secretInputAccepted: true|false`.

### `GET /rotations/{rotationId}/audit`

Returns append-only redacted events for that rotation. General provider logs are never proxied through this API.

## 6. Mutation endpoints

### `POST /credentials/{credentialId}/rotations`

Creates a rotation after validating registry revisions and adapter capabilities.

Request:

```json
{
  "reasonCode": "SCHEDULED_ROTATION",
  "credentialRevision": 1
}
```

Response data:

```json
{
  "rotationId": "rot_example_identifier",
  "state": "input_pending",
  "secretInputAccepted": false,
  "permittedActions": ["submit_secret", "cancel"]
}
```

Free-form incident details are not accepted by this API. They belong in a separately access-controlled incident system and must not contain secret values.

### `POST /rotations/{rotationId}/secret-input`

Accepts a new credential value from the Human. This is the only endpoint whose request may contain secret material.

Normative request shape:

```text
{
  secretValue: write-only string
}
```

The contract intentionally provides no example string. Rules:

- maximum request size is set per credential category before body parsing;
- the server rejects multipart, query-string, URL fragment, and header delivery;
- the route bypasses body/access tracing and never stores the body in the rotation record;
- validation returns only `SECRET_INPUT_INVALID`, never which substring, length, prefix, or suffix failed;
- the in-memory buffer is released immediately after adapter staging completes or fails;
- retries require the same `Idempotency-Key`; an uncertain result transitions to `manual_recovery_required` rather than prompting blind duplicate creation; and
- success clears the input element and replaces the secret-entry document so browser history cannot restore it.

Response:

```json
{
  "success": true,
  "data": {
    "rotationId": "rot_example_identifier",
    "state": "staged",
    "secretInputAccepted": true,
    "bindingResults": [
      {"bindingId": "kaz_os_read.mini", "status": "staged"},
      {"bindingId": "kaz_os_read.gateway", "status": "staged"}
    ]
  },
  "requestId": "example-request-id"
}
```

### `POST /rotations/{rotationId}/distribute`

Activates the approved staged plan in fixed rollout order. It does not accept binding names or backend parameters from the browser.

Request:

```json
{"expectedState": "staged"}
```

Partial success produces `DISTRIBUTION_PARTIAL` and a non-success response with redacted per-binding results. The server does not continue to probes or old disable.

### `POST /rotations/{rotationId}/verify`

Runs all registered required probes. The browser cannot supply a URL, headers, request body, command, or probe implementation.

Request:

```json
{"probeSet": "required"}
```

Response items contain `probeId`, `status`, `safeCode`, `elapsedMs`, and `checkedAt` only.

### `POST /rotations/{rotationId}/revoke-approval`

Records an explicit Human decision after verification.

```json
{
  "decision": "approve",
  "expectedState": "revoke_approval_pending"
}
```

Approval is single-use, bound to the rotation and immutable binding snapshot, and expires before execution if registry/binding revisions change.

### `POST /rotations/{rotationId}/disable-previous`

Requires a valid approval. It disables rather than destroys old material where the provider supports that distinction. An irreversible provider revoke requires a provider-specific reviewed action and cannot be inferred from this generic route.

### `POST /rotations/{rotationId}/regression-verify`

Runs the fixed post-disable probe set. Only a successful required set can move the rotation to `closed`.

### `POST /rotations/{rotationId}/rollback`

Starts rollback using adapter-owned version/slot references. The request contains a safe reason code and expected state, not secret material or backend targets.

```json
{
  "reasonCode": "CONNECTIVITY_FAILED",
  "expectedState": "verification_failed"
}
```

### `POST /rotations/{rotationId}/cancel`

Allowed only before any binding activation. Staged backend artifacts are retained or disabled according to the adapter cleanup policy; nothing is silently destroyed.

## 7. Status and connectivity endpoint

### `POST /credentials/{credentialId}/connectivity-checks`

This is a state-changing audit event even though it does not rotate a value. It invokes only registered probes and returns safe results. It cannot be used as an arbitrary HTTP client.

The endpoint is unavailable while a rotation is in a state where an active/staged credential choice would be ambiguous. Rotation-specific verification must be used instead.

## 8. Safe error catalog

| Code | Meaning |
| --- | --- |
| `AUTHENTICATION_REQUIRED` | no valid Human session |
| `FORBIDDEN` | actor lacks the required Console role |
| `USER_PRESENCE_REQUIRED` | re-authentication/user-presence assertion absent or stale |
| `CSRF_REJECTED` | same-origin mutation check failed |
| `NOT_FOUND` | logical resource not available to actor |
| `REVISION_CONFLICT` | registry or workflow snapshot changed |
| `IDEMPOTENCY_CONFLICT` | key reused for a different safe operation context |
| `SECRET_INPUT_INVALID` | category validation failed; no detail returned |
| `ADAPTER_CAPABILITY_MISSING` | safe rotation requirements cannot be met |
| `STAGE_FAILED` | one or more adapters failed staging |
| `DISTRIBUTION_PARTIAL` | activation succeeded for only a subset |
| `CONNECTIVITY_FAILED` | required allowlisted probe failed |
| `APPROVAL_REQUIRED` | old-disable has no valid approval |
| `ROLLBACK_FAILED` | one or more compensating actions failed |
| `AUDIT_PERSISTENCE_FAILED` | durable audit event could not be confirmed |
| `OPERATION_STATE_UNKNOWN` | backend result is uncertain; manual recovery required |
| `INTERNAL_ERROR` | unknown failure with no raw details |

## 9. Explicitly forbidden API surface

The following routes or equivalents must never exist:

```text
GET  /credentials/{id}/value
GET  /credentials/{id}/export
POST /credentials/{id}/reveal
POST /credentials/{id}/compare
POST /credentials/{id}/hash
GET  /backends/{id}/raw
GET  /debug/request-bodies
GET  /debug/environment
```

There is also no general-purpose adapter command endpoint, arbitrary probe endpoint, raw provider proxy, property-list endpoint, or secret search.

## 10. Phase 2 mock mode

Phase 2 serves the same DTOs and state transitions with synthetic credential values and fake target aliases. The mock adapter must still enforce no read-back, no response echo, idempotency, redacted diagnostics, audit persistence, partial-failure injection, and rollback transitions.

Mock mode is visibly labeled and cannot load a production registry, production target resolver, Cloud credential, Apps Script OAuth grant, or production network egress configuration.
