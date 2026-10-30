# Family Inbox / Health cloud service credentials

## Decision and scope

The 2026-10-30 exposure came from an unfiltered Apps Script settings accessibility
snapshot. Disabled input controls included plaintext Script Property values.
Manual replacement in those same settings was rejected by the user.

The existing School Gemini, Signage TTS and Mini Kaz OS readers access Google
Secret Manager with the deploying owner's existing Google OAuth identity. Reuse
that pattern for Mini. Secret Manager is the only persistent plaintext source for
FAMILY_INBOX_SERVICE_TOKEN and HEALTH_SERVICE_TOKEN in project paluru-bus.

| Consumer | Credential handling | Google scope change |
| --- | --- | --- |
| Mini Family Inbox gateway | Reads the pinned cloud version in request memory | None |
| Mini Health / Pet Health gateway | Reads the pinned cloud version in request memory | None |
| Family Inbox receiver | Constant-time SHA-256 verifier rendered from that cloud version | None |
| Health receiver | Constant-time SHA-256 verifier rendered from that cloud version | None |
| School worker / PC Review | Existing separate credentials, unchanged | None |

Receivers authenticate an existing bearer field; they do not need the plaintext
credential or Cloud API access. A direct Secret Manager reader on each receiver
was evaluated in unpublished HEAD. Health's preflight required additional OAuth
consent. That unnecessary scope was abandoned before changing the published
service. Keep all receiver manifests at their existing scopes and public Web App
settings. No new service account, broker, admin operation or auth route is added.
Firebase, family/member authorization, roles and API schemas are unchanged.

This addresses the Context CAPA Human-work Escalation Trigger: reassess existing
successful implementations before asking a person for credential operations.
The user explicitly authorized this scoped storage and verifier migration.

## Safety and release contract

- Pin cloud version metadata in both ServiceSecretManager and ServiceTokenVerifier.
  Adding a cloud version alone must not change a running caller's credential.
- Render receiver verifiers only in reviewed deployment directories outside Git:
  `node scripts/render-service-token-verifier.mjs <deployment-directory>`.
  The tool validates reference names, captures gcloud stdout in memory, and emits
  only a logical service name, version and boolean. Production verifiers and
  plaintext credentials are never committed or printed.
- The unrendered verifier template fails closed. Secret Manager errors fail with
  CONFIGURATION_ERROR; never silently fall back to a Script Property or cache.
- A verified production request removes only its matching legacy service-token
  property. Mini retires the caller property only after a successful upstream
  envelope; receivers retire theirs only after matching the new verifier.
- Unauthenticated requests cannot change configuration. No business rows/files are
  modified by credential cleanup. Keep all unrelated Script Properties unchanged.
- Family Inbox acceptance credentials must remain distinct from the effective
  service verifier as well as the separate worker and PC Review credentials.

## Cutover and recovery

1. Preserve current HEAD and the published version separately, including manifest,
   scopes and Web App settings. HEAD can omit published deployment metadata.
   Merge only reviewed authentication files and preserve unrelated HEAD work.
2. Generate independent credentials with 32 random bytes; send to Secret Manager
   over stdin, never command arguments or plaintext temporary files. Verify cloud
   readback in memory. Record resource names/version metadata only.
3. Keep the existing time-bounded new/old overlap while validating cloud access.
   Deploy Mini first using the same new values already accepted by receivers.
4. Verify live Mini Family Inbox and Health/Pet requests with existing data.
   Deploy rendered receivers with a single verifier, removing the temporary overlap.
5. Verify direct new accepted / old rejected for both services, independent worker
   and PC Review auth, and safe write validation before persistence. Do not upload
   another PDF or modify health data to test credentials.
6. Independently pull final published sources and compare with the reviewed release.
   Read only presence booleans for the legacy property names in all three settings.
   Compare business data to the pre-cutover snapshot; do not overwrite concurrent
   legitimate changes. Confirm the scheduled worker also runs naturally.

Before caller cutover, rollback can restore the preserved source/published version.
After legacy properties have been retired, old property-based versions are not a
self-contained rollback. Preserve the working cloud-backed Mini version and both
rendered receiver release directories. Roll back to those cloud-backed versions,
keeping the pinned cloud secret version enabled. Never re-enable a leaked token
as routine recovery. A later rotation repeats a reviewed overlap, pinned-version
change and old rejection sequence; do not blindly change the pinned version.

## Secret-safe inspection and evidence

Never emit settings AX trees, screenshots, body text, input values, raw cloud
responses or child-process errors. First select exact allowed keys and return
presence booleans only. Do not log token prefixes, lengths or hashes. Credential
values may exist in authorized request memory; never in argv, Git or exceptions.

The original incident records remain in managed local session history. Do not edit
that history to make a scan pass. Revoke both exposed values and remove temporary
handoff artifacts after verification. Record any incomplete residual-file scan.

Final evidence must distinguish staging, published code, live business reads,
old-token rejection, safe write validation, unchanged data and UI acceptance.
A test, cloud version creation or successful deployment alone is not completion.
