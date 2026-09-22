# Codex Handoff — PALURU Transport Architecture Review

Status: READY
Priority: HIGH
Date: 2026-09-22

## Goal

Stop spending Human time on intermittent PALURU PWA ↔ GAS failures.

Human should not inspect Apps Script logs, rerun ad-hoc tests, or classify transport failures manually.

## Already Implemented

1. Auth bootstrap read mitigation
   - 8s timeout
   - exactly one retry
   - `auth.config.get`
   - `auth.session.resolve`

2. Kaz OS read mitigation
   - 8s timeout
   - exactly one retry
   - Projects / Work / TODAY / INBOX
   - transport-like failures only

3. INBOX answer ambiguity reconciliation
   - write is never retried
   - on `HOME_CONTROL_UNAVAILABLE`, do one INBOX read-back
   - confirm only via bounded `persistence.confirmed_answers`
   - match decision_id + question_revision + DURABLE_PERSISTED

4. Calendar Decision source-boundary fixes
   - Calendar answer revalidation bound to Calendar revision
   - follow-up question revision bound to Calendar evidence
   - follow-up rebuild from durable proposal target_event_ref, not ephemeral parent Decision

## Required Codex Work

### A. Architecture review

Trace the complete request lifecycle for:

- auth bootstrap
- Kaz OS read
- Kaz OS answer
- service worker / cache interaction
- browser fetch
- GAS web app execution
- Cloud Run gateway where relevant

Identify remaining failure boundaries and duplicated transport logic.

### B. Safe observability

Design and implement automatic, secret-free diagnostics that require no Human log hunting.

At minimum capture:

- request class / action
- client request correlation id or safe suffix
- attempt number
- elapsed time
- timeout vs network vs HTTP vs parse vs business error
- backend stage when available
- build id
- success / reconciled / unresolved outcome

Do not capture:

- tokens
- Firebase ID token
- UID/email
- raw Calendar IDs
- event titles
- private payload bodies

### C. Failure isolation

Verify one broken Decision/follow-up cannot take down all INBOX unless source completeness is genuinely unsafe.

### D. Tests

Add deterministic tests for:

- cold PWA start
- warm start
- one transient read failure then success
- two consecutive read transport failures
- write persisted but response lost
- write not persisted and response lost
- reload/process restart after persisted answer
- unrelated source revision change
- parent ephemeral Decision disappearance
- service worker version transition

### E. Acceptance

No Human debugging required.

Human acceptance is limited to normal use:
- open PALURU
- open INBOX
- answer a Calendar partial-window question

Expected:
- transient read failure self-recovers
- persisted answer never appears as permanent failure just because response was lost
- no duplicate writes
- no stale card after confirmed persistence
- diagnostics are automatically available to AI/Codex without Human copying logs
