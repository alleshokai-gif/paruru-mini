# PALURU Central Secret Console — Credential Registry Schema

Status: Phase 1 normative schema

Schema version: `secret-console-registry/v1`

Scope: metadata only. Secret material is invalid in every record defined here.

## 1. Invariants

1. `credentialId` is a stable logical identifier and is independent of backend names.
2. One credential may have many bindings, but every binding belongs to exactly one credential and one environment.
3. Normal UI operates on `credentialId`; it does not accept a property key, secret resource name, URL, Script ID, project ID, or environment variable name from the Human.
4. Physical target details are resolved from server-controlled aliases.
5. Registry, binding, rotation, diagnostic, and audit records contain no value, encoded value, prefix/suffix, length, or value-derived fingerprint.
6. A binding cannot be activated if its adapter capability set does not satisfy the credential's rotation policy.
7. Updates use optimistic concurrency through `revision`; stale updates fail closed.
8. Timestamps are RFC 3339. The Console renders and records Human-facing audit time in `Asia/Tokyo`.

## 2. Credential record

```yaml
schemaVersion: secret-console-registry/v1
credentialId: kaz_os_read
displayName: Kaz OS read access
description: Private read-path authentication for the Kaz OS gateway
environment: production
category: internal_shared_secret
status: active
ownerTeam: homeapps
rotationPolicyId: internal-shared-standard-v1
bindingIds:
  - kaz_os_read.mini
  - kaz_os_read.gateway
connectivityProbeIds:
  - kaz_os_read.progress
  - kaz_os_read.projects
  - kaz_os_read.inbox
lastRotatedAt: null
nextRotationDueAt: null
createdAt: 2026-09-17T00:00:00+09:00
updatedAt: 2026-09-17T00:00:00+09:00
revision: 1
```

The example contains identifiers and metadata only. It does not assert current production configuration.

### Fields

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `schemaVersion` | string | yes | exactly `secret-console-registry/v1` |
| `credentialId` | string | yes | `^[a-z][a-z0-9_]{2,63}$`; immutable |
| `displayName` | string | yes | 1–80 characters; no secret material |
| `description` | string | yes | 1–300 characters; no physical value or endpoint |
| `environment` | enum | yes | `development`, `staging`, `production` |
| `category` | enum | yes | see below |
| `status` | enum | yes | `draft`, `active`, `rotation_due`, `blocked`, `disabled`, `retired` |
| `ownerTeam` | string | yes | stable organizational alias |
| `rotationPolicyId` | string | yes | foreign key to approved policy |
| `bindingIds` | string[] | yes | 1–32 unique IDs |
| `connectivityProbeIds` | string[] | yes | 0–32 unique allowlisted probes |
| `lastRotatedAt` | timestamp/null | yes | metadata, not proof of acceptance |
| `nextRotationDueAt` | timestamp/null | yes | policy output |
| `createdAt`, `updatedAt` | timestamp | yes | RFC 3339 |
| `revision` | positive integer | yes | optimistic-concurrency version |

Allowed `category` values:

```text
internal_shared_secret
external_provider_api_key
oauth_client_secret
webhook_secret
service_credential
encryption_key_reference
other_review_required
```

`encryption_key_reference` is registry metadata only; encryption keys themselves are not accepted by this schema.

## 3. Binding record

```yaml
schemaVersion: secret-console-binding/v1
bindingId: kaz_os_read.mini
credentialId: kaz_os_read
consumer:
  consumerId: paluru-mini
  displayName: PALURU Mini
  environment: production
  role: outbound_authentication
backend:
  type: gas_script_properties
  targetRef: gas-target-paluru-mini
  keyRef: binding-key-kaz-os-read
  deliveryMode: consumer_local_write
activation:
  mode: dual_slot_required
  rolloutOrder: 20
  required: true
capabilitiesRequired:
  - stage
  - dual_slot
  - rollback_before_revoke
  - status_probe
  - connectivity_probe
status: unverified
lastAppliedRotationId: null
lastVerifiedAt: null
createdAt: 2026-09-17T00:00:00+09:00
updatedAt: 2026-09-17T00:00:00+09:00
revision: 1
```

`targetRef` and `keyRef` are opaque aliases. The redacted UI projection omits both.

### Common fields

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `schemaVersion` | string | yes | exactly `secret-console-binding/v1` |
| `bindingId` | string | yes | unique; immutable |
| `credentialId` | string | yes | existing credential foreign key |
| `consumer.consumerId` | string | yes | stable consumer alias |
| `consumer.displayName` | string | yes | Human-readable |
| `consumer.environment` | enum | yes | must equal credential environment unless explicitly reviewed |
| `consumer.role` | enum | yes | `inbound_authentication`, `outbound_authentication`, `provider_access`, `signing`, `other_review_required` |
| `backend.type` | enum | yes | `gas_script_properties`, `google_secret_manager` |
| `backend.targetRef` | string | yes | server-only target alias |
| `backend.keyRef` | string | yes | server-only key/resource alias |
| `backend.deliveryMode` | enum | yes | backend-specific allowlist |
| `activation.mode` | enum | yes | `version_pin`, `dual_slot_required`, `manual_review_required` |
| `activation.rolloutOrder` | integer | yes | 0–1000; ties are rejected for dependent bindings |
| `activation.required` | boolean | yes | failure blocks rotation when true |
| `capabilitiesRequired` | string[] | yes | subset of declared adapter capabilities |
| `status` | enum | yes | `unverified`, `configured`, `missing`, `degraded`, `disabled`, `blocked` |
| `lastAppliedRotationId` | string/null | yes | workflow reference only |
| `lastVerifiedAt` | timestamp/null | yes | safe-probe time |
| timestamps / `revision` | scalar | yes | same concurrency rules as credential |

### Backend discriminators

For `gas_script_properties`:

```yaml
backend:
  type: gas_script_properties
  targetRef: gas-target-alias
  keyRef: property-key-alias
  deliveryMode: consumer_local_write
```

Rules:

- `deliveryMode` is `consumer_local_write`.
- The adapter may resolve exactly one allowlisted property key.
- Bulk property reads/writes and delete-all are forbidden.
- `activation.mode=dual_slot_required` is mandatory for a reversible production rotation unless a separate design review approves an equivalent versioned strategy.
- Transport authentication is part of target configuration and is never supplied in a registry request.

For `google_secret_manager`:

```yaml
backend:
  type: google_secret_manager
  targetRef: gcp-project-alias
  keyRef: secret-resource-alias
  deliveryMode: cloud_run_env_pinned
```

Allowed delivery modes:

```text
cloud_run_env_pinned
cloud_run_volume_versioned
runtime_api_versioned
```

Rules:

- `cloud_run_env_pinned` requires an explicit numeric version alias in adapter-owned rotation state and a new Cloud Run revision for activation.
- `latest` is rejected for environment-variable delivery.
- IAM is granted at the individual secret where practical.
- Project number, secret resource name, version name, service account email, and environment variable name are excluded from redacted projections.

## 4. Rotation policy record

```yaml
schemaVersion: secret-console-rotation-policy/v1
rotationPolicyId: internal-shared-standard-v1
requiresStaging: true
requiresConnectivity: true
requiresHumanRevokeApproval: true
requiresRollbackBeforeRevoke: true
minimumSuccessfulProbes: all_required
partialFailurePolicy: stop_and_rollback_activated
oldMaterialAction: disable_then_retain
destructionDelayDays: null
```

| Field | Allowed values / rule |
| --- | --- |
| `requiresStaging` | boolean; production is normally `true` |
| `requiresConnectivity` | boolean |
| `requiresHumanRevokeApproval` | must be `true` for production |
| `requiresRollbackBeforeRevoke` | boolean |
| `minimumSuccessfulProbes` | `all_required` only in v1 |
| `partialFailurePolicy` | `stop_and_rollback_activated` or `stop_for_manual_recovery` |
| `oldMaterialAction` | `disable_then_retain`, `provider_revoke`, `manual_review_required` |
| `destructionDelayDays` | null or reviewed non-negative integer; destruction is never automatic in v1 |

## 5. Connectivity probe record

```yaml
schemaVersion: secret-console-probe/v1
probeId: kaz_os_read.projects
credentialId: kaz_os_read
consumerId: kaz-os-read-gateway
kind: server_side_http
runnerRef: probe-runner-kaz-projects
required: true
safeResultCodes:
  - PASS
  - AUTH_FAILED
  - SOURCE_FAILED
  - TIMEOUT
timeoutMs: 10000
```

The runner implementation, endpoint, headers, and request body are server-controlled and absent from the record returned to the browser. A probe response is reduced to a safe code, elapsed time, and time. Provider payloads are discarded before audit/response serialization.

## 6. Rotation record

Rotation records contain state and opaque operation references, never payloads.

```yaml
schemaVersion: secret-console-rotation/v1
rotationId: rot_example_identifier
credentialId: kaz_os_read
credentialRevision: 1
bindingRevisionSnapshot:
  kaz_os_read.mini: 1
  kaz_os_read.gateway: 1
state: input_pending
bindingStates:
  kaz_os_read.mini: pending
  kaz_os_read.gateway: pending
secretInputAcceptedAt: null
revokeApprovalId: null
startedBy: human-operator-alias
startedAt: 2026-09-17T00:00:00+09:00
updatedAt: 2026-09-17T00:00:00+09:00
revision: 1
```

Forbidden fields include `value`, `secret`, `payload`, `token`, `authorization`, `fingerprint`, `hash`, `prefix`, `suffix`, and any generic map capable of bypassing the schema.

## 7. Redacted UI projection

The list/detail endpoints expose only:

```json
{
  "credentialId": "kaz_os_read",
  "displayName": "Kaz OS read access",
  "status": "active",
  "backendSummary": ["Script storage", "Cloud secret storage"],
  "consumers": ["PALURU Mini", "Kaz OS read gateway"],
  "lastRotatedAt": null,
  "connectivity": "unverified",
  "rotationState": null
}
```

The Human can understand placement and status, but does not manage backend-specific identifiers.

## 8. Validation and migration rules

- Unknown fields are rejected in mutation requests and registry imports.
- Existing records are migrated additively by `schemaVersion`; silent reinterpretation is forbidden.
- Removing a binding is a reviewed lifecycle operation, not an ordinary registry edit.
- A physical rename creates a separate binding migration; changing `credentialId` does not rename storage.
- `disabled` and `retired` credentials remain in audit references.
- A registry update cannot occur while a rotation is active unless it is an emergency action with its own audit event.
- Inventory completeness is not claimed until each consumer repository and live binding is separately verified without reading values.
