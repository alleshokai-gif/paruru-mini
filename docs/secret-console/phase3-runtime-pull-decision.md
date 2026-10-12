# PALURU Central Secret Console — Phase 3 transport decision

Status: **Accepted for pull-capable consumers / production implementation pending**

Reviewed: 2026-10-12 (Asia/Tokyo)

## Decision

For consumers that can authenticate to Google Cloud with their own Google identity and can safely read a specific Secret Manager secret at runtime, **do not distribute a secret into the consumer's local configuration**.

Use this pattern instead:

```text
Human Secret Console
  -> Google Secret Manager (canonical secret value/version)
       |-> Cloud Run: secret binding
       `-> GAS consumer: Google OAuth identity + secret-level IAM -> Secret Manager access
```

The Human manages the logical credential only in Secret Console. Secret Manager is the only secret-value source of truth. GAS Script Properties contain only non-secret routing/configuration metadata.

This is the preferred Phase 3 transport for RAW Daily Capture and any later GAS consumer where runtime pull is acceptable.

## Why this replaces the previous distribution proposal

The earlier Phase 3 candidate focused on pushing/staging the same value into both Secret Manager and GAS Script Properties. That preserves rollback control but recreates the operational problem the Console is meant to solve: every new GAS becomes another physical copy that must be installed, reconciled, and rotated.

For RAW Daily Capture, the consumer runs only on a daily schedule. One Secret Manager read at run start is an acceptable dependency and is materially simpler than maintaining a local GAS secret copy.

The Google OAuth access token used by GAS is obtained at runtime with `ScriptApp.getOAuthToken()`. It is never stored by Secret Console. Secret Manager IAM remains the authorization boundary. A GAS identity receives only `roles/secretmanager.secretAccessor` on the specific logical secret it consumes.

## Human acceptance requirement

> ワイはその画面以外見ん

For normal setup and rotation, Kaz must not need to open individual Apps Script Script Properties pages to paste or rotate secret values.

Non-secret Script Properties such as endpoint URL, account role, project ID, or logical secret name may still exist, but they are not credential copies and should be deployed/configured through normal source/deployment automation where practical.

## Credential lifecycle

### Create / initial setup

1. Human creates or approves the logical credential in Secret Console.
2. Console adapter creates the Secret Manager secret/version without returning its value.
3. Cloud Run runtime identity is bound to the secret as needed.
4. GAS consumer Google identities receive secret-level accessor IAM only.
5. GAS reads the active version at run start and uses it transiently.
6. Probes verify the consumer and Cloud Run agree.

### Rotation

1. Human enters a new value only in Secret Console.
2. Console adds a new Secret Manager version.
3. Server-side consumers are deployed/restarted with the reviewed active version policy.
4. Pull-capable GAS consumers read the newly active version on their next authorized run.
5. Connectivity/regression checks pass.
6. Human approves old-version disable.
7. Rollback re-enables the prior Secret Manager version and restores the server binding if needed.

No Script Properties credential rewrite occurs.

## Security boundary

- AI/Codex never reads a Secret Manager payload.
- Secret Console never exposes a reveal/read/export endpoint.
- GAS may read only the specific secret required by its runtime contract.
- GAS must not log, return, persist, hash, or place the secret in Script Properties.
- OAuth tokens and secret values must not be written to logs or error text.
- Secret access is scoped per Google principal and per secret, not project-wide where avoidable.
- Secret Manager access failures fail the consumer run closed.

## When NOT to use runtime pull

Runtime pull is not universal. Use another reviewed transport only when:

- the consumer cannot authenticate to Secret Manager without adding a worse credential;
- runtime availability requires a local secret copy;
- provider APIs require a local format/state that cannot be derived at runtime; or
- latency/rate/cost makes Secret Manager access operationally inappropriate.

Those consumers may use a one-time broker or target-local dual-slot adapter, but only after a separate design review. `scripts.run` remains non-default and must justify its Cloud Project/OAuth cost.

## First production consumer: RAW Daily Capture

Accepted data plane:

```text
main GAS / school GAS
  -> read Gmail/Calendar locally
  -> fetch KAZ_CONTEXT_INGEST_TOKEN from Secret Manager using Google identity
  -> POST bounded provider fields to Kaz Context Cloud Run
  -> existing Python classification/minimization
  -> GitHub RAW / Saved
```

Secret-value copies:

- Secret Manager: **1 canonical value/version chain**
- Cloud Run: injected runtime binding only
- main GAS Script Properties: **0**
- school GAS Script Properties: **0**
- Git/source/logs/AI-visible artifacts: **0**

## Acceptance gates

Phase 3 for this transport is not DONE until:

1. Secret Manager canonical secret exists and is not exposed to AI.
2. Main and school Google principals have only secret-level accessor permission.
3. Both GAS collectors can read the secret without Script Property copies.
4. Cloud Run uses the same canonical secret through Secret Manager binding.
5. Main GAS -> Cloud Run -> GitHub succeeds.
6. School GAS -> Cloud Run -> GitHub succeeds.
7. Duplicate/replay behavior is deterministic.
8. Rotation to a new Secret Manager version is demonstrated without editing individual GAS Script Properties.
9. Old-version disable/rollback is demonstrated.
10. Redacted audit/reconciliation evidence is durable.

## RAW Daily Capture resume point

After these gates pass, return to Kaz Context Issue #50 / PR #49 checkpoint and resume Production Acceptance. The previous ChatGPT real-provider batch write path remains retired.
