# Private Broker Non-production PoC

Status: local synthetic implementation only. No production credential, Mini
Script Property, Apps Script deployment, Cloud Run revision, Secret Manager
version, or public `doPost` is changed by this component.

## Pre-implementation record

- Problem: validate `poll -> lease -> redeem -> ACK` without moving PALURU Mini
  to a standard Cloud project or adding an admin action to its anonymous Web
  App.
- Confirmed cause of the transport re-evaluation: `scripts.run` requires a
  common standard Cloud project, an API executable, and Human OAuth covering
  the script scopes. Those are transport costs, not Secret Console
  requirements.
- Implementation direction: an isolated broker with Google OIDC verification,
  safe durable operation metadata, an external synthetic secret store seam,
  and an isolated Apps Script trigger handler.
- Impact boundary: only this directory is added. Existing `gas/`, public
  `doPost`, production configuration, and cloud resources are out of scope.
- Side effects: local tests create randomized temporary files and delete them.
  They never persist a token, identity claim, email, or synthetic payload.
- Rollback: remove this isolated directory. No production state rollback is
  required.
- Acceptance targets: owner/audience/expiry verification, lease serialization,
  retry and crash recovery, trigger idempotency, restart recovery against the
  durable-store seam, safe failure on datastore errors, and zero leakage.

## Architecture

```text
Synthetic console
  -> external synthetic secret store (payload)
  -> durable operation store (safe metadata only)
  -> private broker
  <- Google-signed OIDC
isolated Apps Script time-trigger handler
  -> synthetic A/B Script Properties
```

The broker state contains only:

```text
operation_id, state, lease_alias, lease_owner_alias,
lease_expires_at, attempt_count, acknowledged,
created_at, updated_at, safe_error_code, secret_version_alias
```

`secret_version_alias` is an opaque reference. The payload remains in the
external secret-store seam and is read only during an authenticated redeem.

The private HTTP contract is:

```text
POST /v1/operations/poll
POST /v1/operations/lease
POST /v1/operations/redeem
POST /v1/operations/ack
GET  /v1/operations/{operation_alias}/status
```

Authentication is evaluated before route selection, including unknown routes.
The application then verifies the Google signature, issuer, expiry, exact
custom audience, and the SHA-256 digest of an expected opaque `sub`. The raw
subject is not stored in broker configuration or state. Identity claims are
discarded and only `owner_binding` crosses into broker logic.

One lease can return the payload once. If the process stops immediately after
redeem, the same operation can receive a new lease only after expiry. If Mini
has already written or activated the synthetic slot, its safe apply-stage
marker resumes without redeeming or writing the payload again.

## Scope candidate

The isolated manifest deliberately requests only:

```text
openid
https://www.googleapis.com/auth/script.external_request
https://www.googleapis.com/auth/script.storage
```

The broker binds the owner with stable `sub`, not email, so application-level
verification does not need `userinfo.email`. Whether an email-less Apps Script
ID token passes the Cloud Run IAM front door remains a live Google acceptance
gate. This local PoC does not claim that the scope can yet be removed in a
deployed private service.

## Local commands

```text
npm test
```

No dependency installation, Google credential, cloud resource, or network
access is required by the test suite.

## Local verification versus Google acceptance

The local suite uses runtime-generated RSA keys to execute the same RS256,
issuer, expiry, audience, and owner-subject validation path used for Google
tokens. It also simulates trigger overlap and failure injection.

The following claims require a Human-created, isolated Google PoC and are not
made by local tests:

- `ScriptApp.getIdentityToken()` is accepted by a private Cloud Run service;
- Cloud Run IAM accepts an `openid`-only token without `userinfo.email`;
- an actual installable trigger fires as the expected owner;
- Firestore survives a real Cloud Run instance replacement; and
- Cloud Run, Apps Script, Firestore, and audit logs contain no sensitive data.

No deploy command is included or run by Codex. Production use is forbidden.
