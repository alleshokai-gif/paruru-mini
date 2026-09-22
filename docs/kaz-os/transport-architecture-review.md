# PALURU Transport Architecture Review

Status: source implementation and local tests verified; deployment and real-browser acceptance pending
Date: 2026-09-22
Scope: `paruru-mini` PWA and Mini GAS. Cloud Run source changes are a separate repository change and are not authorized by this document.

## Problem

Intermittent PWA-to-GAS failures are currently mitigated in separate code paths, but the evidence needed to classify a failure is split between browser console messages and Apps Script logs. The Human still has to find and copy those logs. Auth bootstrap and Kaz OS reads also duplicate timeout, retry, parse, and error-classification logic.

## Confirmed current lifecycle

### Auth bootstrap

1. `index.html` loads `build.js`, Firebase auth core, Firebase auth runtime, then `app.js`.
2. `initializeAuthenticatedPwa()` creates `PALURUFirebaseAuthRuntime`.
3. The runtime POSTs `auth.config.get` to the GAS Web App.
4. It loads Firebase/GIS, restores Firebase local persistence, and POSTs `auth.session.resolve` with the Firebase auth envelope.
5. `gas/Code.js::doPost()` dispatches to public-config lookup or `authSessionResolve_()`.
6. Session resolution verifies the Firebase token through Identity Toolkit, resolves the server-owned PALURU identity and membership, and returns the actor DTO.

Both auth reads have an 8 second timeout and exactly one retry for timeout/network/5xx/parse transport failures. Business/authentication errors are not retried.

### Kaz OS read

1. The authenticated PWA publishes Projects, Work, TODAY, and INBOX API functions through `paruru:authenticated`.
2. Each function reaches `callHomeControlReadOnlyApi_()` and POSTs to the GAS Web App with `cache: no-store`.
3. `gas/Code.js::doPost()` dispatches to `kazOsProgress_()`.
4. Mini resolves the Firebase actor and enforces the Kaz owner/admin boundary.
5. Projects, Work, and TODAY call the private Cloud Run gateway. INBOX also captures the Family Calendar in GAS, then POSTs the bounded capture to `/v1/inbox`.
6. Mini sanitizes the returned DTO before returning it to the PWA.

Each PWA read has an 8 second timeout and exactly one retry for transport-like failures. A business error is not retried. INBOX already carries an opaque request UUID through GAS to Cloud Run; the other Kaz reads currently do not.

### Kaz OS answer

1. `features/kaz-os/inbox.js` creates one idempotency key for the answer operation.
2. `callAuthenticatedKazOsInboxAnswer_()` sends one non-retrying `kazOs.inbox.answer` write.
3. GAS re-resolves the actor, re-reads all sources, revalidates the question revision and relevant source revisions, and appends one Answer and one controlled Proposal to `Kaz_OS_Decision_Ledger`.
4. If the browser receives `HOME_CONTROL_UNAVAILABLE`, `features/kaz-os/navigation.js` performs one INBOX read-back. It confirms persistence only from a bounded `confirmed_answers` receipt matching `decision_id`, `question_revision`, and `DURABLE_PERSISTED`.
5. A missing receipt remains unresolved. The write is never retried.

### Service worker and browser fetch

- Navigation, HTML, JavaScript, CSS, and manifest requests use network first with cache fallback.
- Images use cache first.
- GAS API calls are POST requests and are not intercepted by the service worker fetch handler.
- `updateViaCache: "none"`, `registration.update()`, `skipWaiting()`, `clients.claim()`, old-cache deletion, and one `controllerchange` reload are present.
- App-shell resources and `build.js` are Build-ID versioned. The current implementation does not retain a safe, persistent record of cache fallback or version-transition events.

## Confirmed failure boundaries

| Boundary | Current behavior | Remaining evidence gap |
|---|---|---|
| app-shell network | network first, then same-origin cache | cache fallback/version transition is not retained |
| auth browser fetch | bounded retry | no request correlation or retained classification |
| Firebase SDK/GIS load | fail closed | distinct from GAS transport but not retained |
| browser to GAS read | bounded retry for selected reads | duplicated auth/Kaz transport code |
| browser to GAS write | no retry | response loss is ambiguous until read-back |
| GAS router/auth | deterministic dispatch and server-side actor resolution | auth and non-INBOX Kaz stage logs are not correlated |
| GAS to Identity Toolkit | business-safe error code | HTTP/parse stage is collapsed into `AUTH_VERIFIER_UNAVAILABLE` |
| GAS Calendar capture | fail closed | INBOX trace exists only in Apps Script logs |
| GAS to Cloud Run | fail closed | Projects/Work/TODAY lack request correlation; Cloud Run logging needs a separate repo change |
| Cloud Run to Notion | source must be complete | exact failing upstream stage is not returned to Mini |
| Mini sanitizer | fail closed | one malformed Decision can currently reject the complete INBOX DTO |
| Decision ledger | append, flush, read-back | persistence health still requires deployed runtime verification |

## Implementation plan in this repository

1. Add one bounded, allowlist-only browser transport diagnostic ledger shared by auth, Kaz, and service-worker lifecycle events.
2. Store only safe records in local storage so a cold reload does not erase the preceding failure.
3. Show the records read-only in Settings so Codex can inspect the connected browser without the Human copying console output.
4. Add an opaque request UUID to every auth/Kaz read and reuse it across the one retry.
5. Record attempt, elapsed time, classification, HTTP status, safe error code, Build ID, and terminal outcome.
6. Preserve the non-retrying answer path and add `reconciled` or `unresolved` terminal records after the one read-back.
7. Add safe, correlated Mini GAS stage logs without tokens, actor identity, payload bodies, Calendar IDs, event titles, or private source data.
8. Keep existing Cloud Run contracts unchanged in this repository. A separate Context-repository change is required to add request-suffix/stage logs there.

## Impact and side effects

- The browser stores at most 64 small diagnostic records under one versioned local-storage key.
- Settings gains a collapsed read-only diagnostics section. It has no upload, copy, or mutation control.
- Auth and Kaz request bodies gain one opaque `request_id`; server identity and authorization remain server-owned.
- GAS emits structured safe metadata to its normal execution log. No Spreadsheet schema is created or changed.
- No retry is added to a write, and no legacy fallback is added.

## Rollback

Revert the transport diagnostics module, its script/app-shell references, the auth/Kaz/SW instrumentation, GAS trace helper, tests, and Build-ID release change. No persisted business data or Spreadsheet schema needs rollback. Browser-local diagnostic entries become unreachable and may be removed by the browser normally.

## Acceptance tests before implementation is considered complete

- cold PWA start
- warm PWA start
- one transient read failure followed by success
- two consecutive read transport failures
- write persisted but response lost
- write not persisted and response lost
- reload/process restart after persisted answer
- unrelated source revision change
- parent ephemeral Decision disappearance
- service-worker version transition and cache fallback
- malformed single Decision isolation while valid Decisions remain available
- genuine incomplete/unsafe source still fails closed
- diagnostic field allowlist and secret/private-data leakage test

Deployment and real-browser/PWA acceptance remain Human-controlled and are not performed by Codex.

## Implementation result in this branch

- Added a browser-local, allowlist-only diagnostic ledger capped at 64 records and a collapsed read-only Settings view.
- Correlated auth and Kaz requests with an opaque UUID reused across the single retry, plus an explicit bounded attempt number.
- Classified browser failures as timeout, network, HTTP, parse, business, cache, or unknown without retaining request bodies, identity, tokens, Calendar IDs, or event text.
- Added service-worker activation and cache-fallback diagnostics while preserving network-first app shell behavior and the existing update lifecycle.
- Added Mini GAS stage logs with only fixed safe fields. Projects, Work, and TODAY forward the safe request suffix to the existing Cloud Run boundary; Cloud Run consumption remains a separate repository change.
- Preserved the non-retrying answer write and recorded either `reconciled` or `unresolved` after the one bounded read-back.
- Verified that a persisted Calendar follow-up whose target event disappears is omitted without taking down unrelated valid Decisions. A malformed upstream Decision still fails closed because the source claiming completeness is unsafe.
- Updated PWA Build ID to `v20260922-transport-diagnostics-v1` and Mini GAS Build ID to `mini-20260922-transport-diagnostics-v1`.

## Local verification

All 101 repository `test/*.test.js` files pass. The deterministic transport coverage includes:

- cold and warm diagnostic-ledger start;
- one transient Kaz read failure followed by success;
- two consecutive Kaz read transport failures with exactly one retry;
- bounded auth timeout, network, 5xx, parse, and business-error behavior;
- write persisted but response lost, and write not persisted with response lost;
- process restart, unrelated revision change, and parent Decision disappearance;
- missing follow-up target isolation and genuinely unsafe source fail-closed behavior;
- service-worker activation, old-cache removal, client claim, and cache fallback;
- browser and GAS diagnostic allowlists with secret/private-data leakage assertions.

This is not production acceptance. The user must deploy the PWA and GAS, then perform the normal-use acceptance flow from the handoff. Cloud Run stage logging is still unimplemented because that source lives in a separate repository and was outside this change authorization.
