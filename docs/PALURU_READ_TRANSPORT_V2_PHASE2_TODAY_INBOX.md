# PALURU Read Transport V2 — Phase 2 TODAY / INBOX design and PoC plan

Status: design and PoC plan only. No production route, PWA flag, GAS,
Cloud Run traffic, credential, Calendar ACL, Spreadsheet permission, writer,
or Dynamic Daily Planning V2 behavior is changed by this document.

## 1. Decision and scope

The target read flow is:

```text
PWA
  -> authenticated paluru-read-transport-v2
       -> Notion read adapters
       -> Google Calendar read adapter
       -> Decision Ledger read adapter
       -> TODAY / INBOX deterministic projection
  -> PWA sanitizer and render
```

GAS is not a PWA-to-Cloud-Run relay in the target flow. It remains the
endpoint for Kaz Answer persistence, Calendar mutation, registration/link,
Google-native administration, and other write paths. A narrowly scoped GAS
Calendar or Sheets read adapter is allowed only as a measured Google-native
upstream when direct Google API access is not approved; it must never proxy the
request onward to another read backend.

Phase 2 covers TODAY and INBOX reads. It excludes Answer, Decision Ledger
writes, Calendar mutation, Dynamic Daily Planning V2 changes, and production
cutover.

## 2. Evidence inventory

The current production Mini read flow is implemented by:

- `app.js`: PWA TODAY and INBOX calls remain on `callHomeControlReadOnlyApi_`.
- `gas/Code.js` and `gas/KazOsProgress.js`: routing, Firebase actor resolution,
  owner authorization, sanitizer, and response.
- `gas/KazOsToday.js`: Calendar capture, Decision Ledger classifications,
  backend POST, and TODAY sanitizer.
- `gas/KazOsInbox.js`: Calendar capture, backend POST, and INBOX sanitizer.
- `gas/KazOsInboxAnswer.js`: Decision Ledger reads and projection, Answer
  revalidation, and the only Kaz Decision Ledger persistence path.
- `kaz-context/tools/kaz-os/live_gateway.py`: fresh Notion reads, Planning
  Readiness, TODAY planning, Secretary questions, and optional Context
  Gardener projection.
- `kaz-context` branch `codex/paluru-read-transport-v2-phase1`:
  authenticated `/v2/read/projects` and `/v2/read/work`, direct Firebase
  verification, actor/membership resolution, rate limit, safe timing, and
  complete-snapshot caching.

### 2.1 Source and dependency matrix

| Dependency | TODAY | INBOX | Current owner | Read/write behavior |
|---|---|---|---|---|
| Firebase token | required | required | GAS | account lookup plus revoked/disabled/provider validation; read-only external verification |
| Home identity/membership | required | required | GAS Sheets | reads `Home_Identities` and `Home_Members` |
| Script Properties | Calendar ID, gateway URL/token, feature flags | same | GAS | configuration read only |
| Notion Projects | indirect | direct | Cloud Run | fresh official API read |
| Notion Work Items | direct | direct | Cloud Run | fresh official API read |
| Family Calendar | constraints and availability | Calendar questions | GAS `CalendarApp` | one 36-hour event read; no Calendar mutation |
| Decision Ledger | Calendar classifications; future planning evidence is outside this phase | suppress answered questions, construct follow-ups, expose receipts | GAS Sheets | read during display; append only during Answer |
| Human Answer | evidence only | question state and receipts | GAS | Answer POST revalidates and appends one ledger row |
| Context Gardener | none | optional advisory questions | Cloud Run/GitHub | read-only and failure-isolated |
| PWA diagnostics | safe timing only | safe timing only | browser localStorage | bounded local diagnostic write, not an operational data write |

## 3. Read-side mutation audit

The current TODAY and INBOX read operations perform **zero Notion, Calendar,
Context, or Decision Ledger business writes**.

The following state changes do occur during a read and must not be confused
with business persistence:

- GAS may put a successful actor mapping in `CacheService` for eight seconds.
- the Phase 1 direct service may update bounded in-memory actor, rate-limit,
  and complete-snapshot caches;
- GAS and Cloud Run emit allowlisted operational logs;
- PWA diagnostics store up to 64 safe metadata records in localStorage;
- sanitizer and `applyKazOsDecisionLedger_()` mutate only an in-memory DTO
  copy.

`buildKazOsCalendarCapture_()` calls `CalendarApp.getEvents()` only.
`readKazOsDecisionLedger_()` calls `getValues()` only. Schema setup and
`persistKazOsAnswer_()` call `setValues()`/`flush()`, but neither is invoked by
a read. Calendar create/update/delete functions exist elsewhere and are not
reachable from TODAY or INBOX reads.

The Phase 2 endpoints must expose `writes: {notion: 0, calendar: 0, context: 0}`
where the DTO contract provides it. They must have no writer dependency, and
tests must fail if a writer mock is invoked.

## 4. TODAY Direct design

### 4.1 Current data flow

```text
PWA Firebase session
  -> GAS kazOs.today.get
     -> Firebase account verification
     -> Home_Identities + Home_Members read
     -> owner/admin authorization
     -> CalendarApp family Calendar getEvents(36h)
     -> Kaz_OS_Decision_Ledger read -> Calendar classifications
     -> POST /v1/today with calendar_capture + classifications
        -> Notion Projects + Work Items
        -> TODAY planner
     -> GAS V1 sanitizer
  -> PWA render
```

Production currently consumes `kaz-today-plan-v1`. Dynamic Daily Planning V2
is frozen and is not part of this migration.

### 4.2 Direct data flow

```text
PWA Firebase session
  -> GET /v2/read/today
     -> existing Direct V2 Firebase verification
     -> existing actor/membership and exact Kaz authorization
     -> one actor-scoped complete Notion Projects + Work snapshot
     -> CalendarSnapshotReader
     -> DecisionLedgerReader -> Calendar classification projection
     -> existing V1 TODAY planner
     -> server DTO validation and zero-write assertion
  -> PWA V1 TODAY sanitizer -> render
```

The endpoint accepts no Calendar, classification, actor, or planning payload
from the browser. Those inputs are resolved server-side after authorization.

### 4.3 Processing moved to Cloud Run

- Firebase verification, actor mapping, authorization, CORS, rate limiting,
  correlation, and safe timing from Phase 1.
- Notion Projects/Work snapshot acquisition and same-request reuse.
- normalized Calendar capture validation and revision generation.
- Decision Ledger classification projection.
- the existing deterministic V1 TODAY planner.
- final response size, completeness, freshness, and zero-write validation.

### 4.4 Processing left on GAS

- `kazOs.inbox.answer`, Answer-time source revalidation, Decision Ledger append,
  idempotency, and read-back receipt;
- Decision Ledger schema setup/admin;
- Calendar create/update/delete and every other Google-native mutation;
- registration/link and unrelated PALURU writes.

The legacy `kazOs.today.get` read remains deployed as the explicit `GAS`
rollback selection. There is no same-request fallback or dual read.

### 4.5 Google Calendar read

Preferred target: Google Calendar API from the dedicated runtime service
account with `calendar.readonly`, access to exactly the configured Family
Calendar, a Calendar ID held only in Secret Manager/env reference, and no
domain-wide delegation. The adapter must preserve the current 36-hour JST
horizon, event bound of 200, hashed event references, all-day semantics,
transparency, completeness receipt, and zero-write receipt.

External prerequisite: confirm that the Family Calendar can be shared
read-only with the runtime service account under the applicable Google account
policy. This permission must not be added during the design phase.

If direct Calendar API access is not approved, the measured alternative is a
dedicated GAS `calendar.snapshot.get` integration endpoint. It may read and
return one normalized snapshot, but may not call the Kaz backend or perform a
write. This alternative retains GAS execution tail and therefore must meet the
same latency gate; it is not an automatic fallback.

### 4.6 Cache policy

- Firebase revocation/disabled validation remains per request.
- actor cache: retain the Phase 1 positive-only 8-second bounded cache.
- Notion snapshot: reuse only a complete actor-isolated snapshot for 5–15
  seconds; failures and partial snapshots are never cached.
- Calendar: no cache in the first PoC. A later 5-second maximum complete-only
  cache may be evaluated, keyed by actor/home, Calendar scope, and horizon.
- Decision Ledger: no cache in the first PoC. A stale classification must not
  outlive a Human Answer receipt.
- final TODAY DTO: not cached in Phase 2 PoC.

### 4.7 Security and authentication boundary

- Firebase signature, issuer, audience, expiry, auth time, provider,
  revoked, and disabled checks on every request.
- server-owned identity/membership mapping and exact existing Kaz admin/owner
  authorization; browser role/member values are never trusted.
- exact-origin CORS, GET/OPTIONS only, per-actor rate limit, no cookies.
- raw token, token fingerprint, identity, Calendar ID/title/body, Notion
  content, ledger content, and response payload are absent from logs.
- Calendar and Sheets scopes are read-only and bound to the dedicated runtime
  service account.

### 4.8 DTO contract

The first direct endpoint returns exactly the production V1 contract:
`kaz-today-plan-v1`, `mode=read_only`, complete `work_items` and `calendar`
sources, current policy fields, NOW/NEXT/waiting/availability/calendar state,
and zero writes. The browser runs an allowlist validator equivalent to
`sanitizeKazOsToday_()` before render.

No `planning` key, V2 DTO, Progressive Estimate, candidate change, or V2
sanitizer change is allowed in this phase.

### 4.9 Failure modes

| Failure | Result |
|---|---|
| invalid/expired/revoked/disabled token | 401, safe auth code |
| unmapped/inactive/unauthorized actor or CORS denial | 403 |
| rate limit | 429 |
| Calendar inaccessible, incomplete, malformed, or over bound | 503 `CALENDAR_SOURCE_UNAVAILABLE` |
| Decision Ledger unavailable or schema mismatch | PoC fails closed with 503 `LEDGER_SOURCE_UNAVAILABLE` |
| Notion Projects/Work incomplete | 503 source-specific code |
| planner/DTO mismatch or oversized response | 503 safe contract code |

The proposed ledger failure behavior is stricter than the current TODAY helper,
which can treat an unavailable ledger as no current classification evidence.
Failing closed avoids silently dropping accepted classifications. This is a
design decision to approve before implementation; it is not changed here.
Unknown/unclassified Calendar events are never treated as free time.

### 4.10 Minimal TODAY PoC

Add hidden `GET /poc/read-v2/today` to a non-production dedicated service.
Use real Firebase auth, the existing actor boundary, real read-only Notion,
and either an explicitly approved non-production Calendar shared to the
runtime service account or a synthetic Calendar adapter for local contract
tests. Use a synthetic/read-only Decision Ledger fixture locally, then a
read-only non-production Sheet for integration. Return V1 only. Do not expose
the route in production PWA configuration.

### 4.11 TODAY acceptance

- auth/security/CORS/rate-limit negative matrix passes;
- V1 DTO and current PWA sanitizer compatibility pass;
- Calendar horizon, hashing, all-day, transparency, source revision,
  completeness, unknown-event fail-closed behavior, and 200-event bound match;
- current classifications produce the same deterministic availability result;
- Notion/Calendar/Context/Sheets business writes are zero;
- no payload/private-data leakage and safe request correlation is queryable;
- cold sample recorded separately; 30 warm browser reads have failure 0,
  median <= 1.2 seconds and p95 <= 2.0 seconds;
- no production route, PWA flag, V2 planner, or Answer change.

### 4.12 TODAY rollback

During a future cutover, rollback selects `GAS` for subsequent TODAY reads,
reloads the PWA, and runs one legacy TODAY smoke. It does not replay the failed
read, change credentials, mutate Calendar/ledger data, or affect Projects,
Work, INBOX, Answer, or writes.

## 5. INBOX Direct design

### 5.1 Current data flow

```text
PWA Firebase session + opaque request ID
  -> GAS kazOs.inbox.get
     -> Firebase account verification
     -> Home_Identities + Home_Members read
     -> owner/admin authorization
     -> CalendarApp family Calendar getEvents(36h)
     -> POST /v1/inbox
        -> Notion Projects + Work Items
        -> Planning Readiness + Secretary questions
        -> optional Context Gardener read
     -> GAS INBOX sanitizer
     -> Kaz_OS_Decision_Ledger read
        -> remove answered questions
        -> add calendar follow-up
        -> add bounded receipts/feedback
  -> PWA render
```

Answer is a separate GAS write. It re-reads the current sources, reconstructs
the question, validates decision/question/source revisions and expiry, then
appends one idempotent ledger row. Operational Notion/Calendar/Context sources
remain unchanged.

### 5.2 Direct data flow

```text
PWA Firebase session
  -> GET /v2/read/inbox
     -> Direct V2 auth/actor/authorization
     -> one shared complete Notion + Calendar snapshot
     -> Planning Readiness + Secretary questions
     -> Decision Ledger read and deterministic projection
     -> optional Context Gardener attachment
     -> server DTO validation and zero-write assertion
  -> PWA INBOX sanitizer -> render

PWA Human Answer
  -> unchanged GAS kazOs.inbox.answer
     -> fresh source revalidation
     -> unchanged idempotent Decision Ledger append
```

### 5.3 Processing moved to Cloud Run

- all common Direct V2 auth/read infrastructure;
- Notion and Calendar snapshot assembly;
- Planning Readiness and Secretary question generation;
- read-only Decision Ledger parsing, stale/expired filtering, answered-question
  suppression, follow-up construction, receipt/feedback projection;
- optional Context Gardener read with the current failure isolation;
- final `kaz-secretary-inbox-0.1` validation and response bounds.

### 5.4 Processing left on GAS

- all Human Answer validation, fresh re-read, idempotency lock, ledger append,
  flush/read-back, and controlled proposal persistence;
- Decision Ledger schema setup/admin and retention operations;
- Calendar and every other operational mutation.

The legacy INBOX GET remains only as the explicit route-level rollback.

### 5.5 Google Calendar read

INBOX uses the same `CalendarSnapshotReader` as TODAY. One logical request
must not fetch the Calendar twice. The event reference and Calendar source
revision algorithm must be identical because question and Answer revision
binding depends on them.

### 5.6 Cache policy

Common auth, actor, Notion, and Calendar rules match TODAY. Decision Ledger and
the final INBOX DTO are not cached in the first PoC. This preserves immediate
question disappearance and response-loss receipt visibility after a GAS
Answer. A later ledger cache is allowed only after a cross-service
invalidation/maximum-staleness review; failure and partial data are never
cached.

### 5.7 Security and authentication boundary

The TODAY rules apply. In addition:

- the direct endpoint is GET-only and has no Answer method;
- the DTO contains controlled proposals/receipts only in their existing
  bounded public shape, never raw ledger rows;
- question identity is bound to the same source revisions as the GAS Answer
  revalidation path;
- no request can cause `setValues`, `appendRow`, `flush`, Calendar mutation,
  Notion mutation, or Context mutation.

### 5.8 DTO contract

Return `kaz-secretary-inbox-0.1` after ledger projection. Preserve source
health, Projects/Work/calendar bounded rows, at most 20 Secretary questions,
optional Context Gardener questions under their existing bound, expiry,
`controlled_proposal` persistence metadata, bounded confirmed-answer receipts,
and `writes={notion:0,calendar:0,context:0}`.

The browser must validate the complete allowlist before render. The direct and
GAS implementations must share canonical revision test vectors for decision
ID, question revision, Calendar event reference, source-revision-specific
binding, follow-up revision, and expiry. Copying the algorithm without shared
vectors is not sufficient.

### 5.9 Failure modes

Auth, actor, CORS, rate limit, Calendar, Notion, response size, and contract
failures match TODAY. Ledger unavailable/schema mismatch is always fail closed
for INBOX when Answer is enabled; otherwise answered questions could reappear.
Context Gardener retains its current advisory isolation: its failure may omit
only Gardener questions and must not hide an otherwise complete operational
INBOX. A revision-parity mismatch is `INBOX_REVISION_CONTRACT_INVALID` and
blocks direct cutover.

### 5.10 Minimal INBOX PoC

Start only after Calendar and Decision Ledger readers pass independently.
Add hidden `GET /poc/read-v2/inbox` to the non-production service. Use the same
snapshot assembler as TODAY, real Firebase auth, read-only integration sources,
and no Answer control. Context Gardener is disabled in the first integrated
PoC and added as a separate optional regression stage.

Run deterministic fixture parity against the GAS question/revision/ledger
projection before any real data measurement. Real authenticated measurement
is read-only; do not answer a question or write a test ledger row.

### 5.11 INBOX acceptance

- security and source-completeness matrix passes;
- current INBOX DTO sanitizer accepts the result;
- decision ID, question revision, expiry, answered suppression, follow-up,
  stale-source invalidation, and receipt parity match shared test vectors;
- DONE/CANCELLED/state-change stale questions and expired questions remain
  hidden under the existing contracts;
- response question bounds hold and write counters are zero;
- Answer endpoint, retry policy, and Decision Ledger are unchanged;
- 30 warm browser reads have failure 0, median <= 1.2 seconds and p95 <= 2.0
  seconds, with cold sample separate;
- no production route, PWA flag, V2 planner, or Human Answer execution.

### 5.12 INBOX rollback

Future rollback selects `GAS` for subsequent INBOX reads, reloads the PWA, and
runs one legacy INBOX smoke. Answer remains GAS before, during, and after the
rollback. No read is replayed and no ledger row is deleted or rewritten.

## 6. Shared Phase 2 read foundation

Implement once and reuse for TODAY and INBOX:

1. the existing Firebase/actor/owner authorization, CORS, rate limit, and safe
   correlation boundary;
2. an actor-scoped `ReadSnapshotAssembler` that obtains one internally
   consistent Projects/Work/Calendar/Ledger set;
3. `CalendarSnapshotReader` with a direct API and an explicit adapter interface;
4. `DecisionLedgerReader` using Sheets API read-only scope and exact immutable
   header validation;
5. canonical revision vectors shared by Python backend tests and Mini/GAS JS
   tests;
6. server and PWA DTO validators for TODAY V1 and INBOX;
7. stage timing for Firebase, actor, Notion Projects, Work Items, Calendar,
   ledger, planning/projection, serialization, and browser total;
8. complete-only bounded caches with no failure caching and no writer reuse.

Do not issue Projects/Work/Calendar/Ledger twice inside one logical request.
Do not use a cached snapshot from a different actor, home, Calendar scope,
planning date, or source revision.

## 7. Google-native boundary

| Operation | Phase 2 owner |
|---|---|
| Calendar event read | preferred Cloud Run Calendar API read-only adapter; measured GAS integration adapter only if direct access is not approved |
| Calendar mutation | GAS only |
| Home identity/membership read | Cloud Run Sheets API read-only, as in Phase 1 |
| Decision Ledger read | Cloud Run Sheets API read-only after explicit access verification |
| Decision Ledger append/read-back | GAS Answer only |
| Ledger schema setup/admin | GAS only |
| registration/link and other Sheets mutations | GAS only |

None of the inspected Google read operations is intrinsically GAS-only. The
practical blockers are existing ACL/ownership, least-privilege scopes, exact
spreadsheet/calendar identity, and parity with GAS revision logic. Direct
access is not assumed until those facts are verified without exposing
identifiers or credentials.

## 8. PoC phases and implementation order

1. **Contract extraction:** create shared deterministic Calendar and Ledger
   revision fixtures; no network or production data.
2. **Calendar reader PoC:** direct Calendar API against an approved
   non-production Calendar. If ACL policy blocks it, measure the dedicated GAS
   snapshot adapter separately and retain the result as architecture evidence.
3. **Decision Ledger reader PoC:** read a non-production Sheet with the exact
   schema through Sheets API read-only; test zero rows, rows, malformed schema,
   denied access, and no write methods.
4. **TODAY hidden endpoint:** V1 DTO only, shared snapshot assembler, 30 warm
   reads, no PWA production flag.
5. **INBOX fixture parity:** decision/question/revision/expiry/receipt tests
   against GAS canonical vectors.
6. **INBOX hidden endpoint:** core Secretary INBOX first, optional Gardener in
   a separate stage, 30 warm reads, no Answer operation.
7. **PWA adapter locally:** independent TODAY/INBOX flags defaulting to `GAS`;
   no silent fallback, dual read, or write transport change.
8. **Separate canary review:** only after both hidden endpoints, security,
   latency, observability, and zero-write gates pass.

This order makes TODAY the first integrated endpoint because it has the smaller
projection surface. INBOX follows only after Answer revision parity is proven.

## 9. Blockers and difficulty

### TODAY

Difficulty: **medium-high**.

Primary blockers:

- read-only Calendar API access for the dedicated runtime identity;
- exact Calendar capture/source revision parity;
- Decision Ledger classification availability without silently losing accepted
  evidence;
- extracting a browser-safe V1 sanitizer without changing V2 planning.

### INBOX

Difficulty: **high**.

Primary blockers:

- every TODAY blocker;
- deterministic parity between Direct-generated questions and GAS Answer-time
  revalidation;
- Decision Ledger answered suppression, follow-up creation, expiry, and
  response-loss receipt visibility;
- keeping optional Gardener failure isolation without weakening core source
  completeness.

## 10. Rollback and production boundary

No production rollback is needed for this design because production is not
changed. Every future route has an independent `GAS`/`DIRECT_V2` selection.
Rollback changes only the affected read flag for subsequent requests. TODAY
and INBOX are rolled back independently; Projects/Work and every write remain
untouched.

## 11. Dynamic Daily Planning V2 Step 9 resume gate

Step 9 remains `BLOCKED_BY_TRANSPORT_BASELINE`. It may be reconsidered only
after all of the following are evidenced:

1. TODAY and INBOX hidden Direct endpoints pass auth/security, DTO, revision,
   source completeness, observability, and zero-write gates.
2. A separately approved production canary shows DIRECT transport, HTTP 200,
   failure/timeout 0, and acceptable latency for both routes.
3. GAS Answer accepts questions generated by Direct INBOX under canonical
   revision parity without a test write in production.
4. TODAY/INBOX route rollback to GAS is verified and does not affect
   Projects/Work or writes.
5. Only after the transport baseline is stable, the frozen V1/V2 rolling
   compatibility and Dynamic Daily Planning V2 release gates are re-run on
   their original branches. Phase 2 must not pre-approve or modify V2.
