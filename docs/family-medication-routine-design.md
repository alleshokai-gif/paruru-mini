# Family medication routine — Issue #251 model v2

## Current / system view

The existing signed-in PWA calls the Mini Health Gateway. Mini verifies Firebase,
resolves the active Home/member on the server, checks an existing Health target
policy, and calls the private Health service using its existing managed service
credential. The Health service stores data in its existing private spreadsheet.
No new provider, login, role, scope, public feed or notification channel is added.
The current repository has no issue-comment execution workflow; the original
owner `/run` has no run/start receipt. This existing owner-assigned Task is the
implementation path; do not resend `/run` or fabricate a Work claim.

## Change / domain view

Add dedicated append-only routine-plan revisions and occurrence events in the
existing Health store. Do not change the meaning of the existing diet/medication
checkboxes. Tables use header names and separate new names, with an explicit
owner schema setup function. Reads never create tables or change settings.
Missing schema returns a safe not-configured state. No live setup is run as part
of development or tests.

- A plan belongs to a server-resolved Home + Health target. Opaque plan ID,
  revision, private label/dose text, start date, morning/evening base times,
  optional weekday time overrides, enabled/disabled flag, optional future-change
  date and note, optional caregiver-entered timer durations and reminder policy.
- A future dose-change note is informational. It never rewrites a dose, selects
  a dose, or decides interruption/restart. The guardian must confirm doctor
  instructions. No clinical defaults or drug-specific advice are supplied.
- An occurrence is keyed by plan/date/slot, with its pinned plan revision. Its
  latest event is `unrecorded`, `completed`, or `held`; absence is not proof of
  non-administration. Completed records have an explicit actual instant, distinct
  from the scheduled time and the server recording instant.
- Corrections append a new event referencing the current event. No health record
  is deleted or silently overwritten. Actual-time timers are recomputed from the
  current completed event, never from the reminder/scheduled time.

## Authorization / use cases

Reuse existing `health.daily.get`, `health.daily.recordSlot`, and
`health.profile.update` target/capability checks, without changing role grants.
Plan configuration additionally requires the existing admin/guardian role and
supervision-record capability, including when configuring self. The existing
target model allows self and supervised active baseline/`self_record` members; it does
not grant one guardian access to another guardian's private Health data.
Self-record members can record/correct their own occurrences, not configure
plans. Guardians may record within their existing supervised target scope.
Anonymous, disabled, other-Home and caller-spoofed identities fail before storage.

Private POST actions (through the existing Health API):

- `health.medication.get`: target + localDate -> serverNow, plans, occurrences,
  server-authorized canConfigure/canRecord and transport status.
- `health.medication.plan.put`: clientRequestId + payload with planId,
  expectedRevision and plan. Guardians only; explicit disable stops future due
  projections. Unconfigured/default plans produce no reminder.
- `health.medication.record`: clientRequestId + localDate + slot + payload with
  planId, planRevision, expectedEventId, status, actual occurredAt when completed,
  and a required reason for a correction. Compare-and-append under the existing script
  lock; a stale plan/event is a conflict and requires a fresh read.

Request hashes include operation, actor, Home, target, date, slot and payload.
The same request ID/body is idempotent; another body/actor/date is rejected.
Each mutation appends one row atomically, so replay after a lost response checks
that row rather than making a second write. Two devices share the server state;
no family/health data is persisted in localStorage, SW caches, diagnostics or Git.
Replay lookup precedes current CAS/plan checks: it returns the original append
receipt even after another correction/config revision, while a fresh current DTO
may be fetched separately. Existing occurrences keep their pinned plan revision
for historic display/correction. Past unrecorded days use only a plan revision
that actually existed then; a newly created plan does not invent past omissions.
Disabled plans keep historic records. A held/unrecorded correction has no active
timer, even when its preceding event was completed.

Actual instants require an explicit offset/Z and strict calendar validation;
future values are rejected against server time, not an assumed device clock.
The selected occurrence's JST day is distinct from its actual instant (a late
cross-midnight record remains explicit). New safe `REVISION_CONFLICT` and
`ROUTINE_NOT_CONFIGURED` errors pass through both Health boundaries unchanged.

## UI / object examples (fictional only)

Home: morning/evening check, not-recorded/completed/held, actual-time readback,
refresh and link to settings. The existing Nurse view hosts caregiver settings
and correction details. One tap records "now" with visible actual time; editing
uses an explicit datetime field. Mobile 320/390 px and desktop, semantic labels,
no horizontal scroll, private text rendered as text (never HTML).

Synthetic plan: opaque UUID, label `項目A`, dose `設定内容A`, start `2030-04-01`,
base morning `08:10` / evening `19:20`, weekday 3 evening `20:10`. These values
are fixtures, not a real household schedule or medical recommendation. Every
configured item is considered; no names, drugs or actual routines are fetched.

## Signage boundary / operating view

Provide a pure due/reminder projection for an already authorized future adapter:
only an opaque occurrence key and fixed generic wording, never member/plan/dose
names. Explicitly enabled policy only; completed/held/disabled/not-started states
suppress it. A narrow technical delivery window rejects late/catch-up delivery;
repeat policy never turns an old reminder into an instruction to take medicine.
No endpoint, scheduler, TTS generation, delivery, permissions or actual notification
is enabled here. If the existing authenticated signage adapter cannot be proven,
show `not_connected` honestly and keep live delivery unimplemented.

## Acceptance / invariants

1. Model -> actual independent design review -> implementation -> independent
   code review -> focused tests/CI -> browser acceptance, with separate deployment
   and actual-device status. Actual review is not replaced by a fixture.
2. Synthetic Mini-to-Health/store E2E: guardian config, self/guardian record,
   server identity, other-Home/unauthorized rejection, idempotent replay, concurrent
   CAS conflict, correction history and independent-device fresh reads.
3. Injected JST clock: weekday override, start/future note, midnight, real instant
   versus scheduled/recorded instants, timers, held/unrecorded and stop/disable.
4. Fixed anonymous notification wording, empty/unconfigured state emits none,
   late delivery is suppressed, no real notification is sent.
5. Existing Health and shopping/read authentication behavior is retained.
   Existing GAS manifest, access and credential bindings are unchanged.
6. GAS Web App version updates remain the explicit human-only repository boundary;
   prepare reviewed source and isolated deployment comparison first, then report
   the exact remaining step if it is actually required. No unapproved version
   deletion, setting mutation or health schema initialization.

Existing Pattern First/CAPA: use the existing Firebase/Health target policy,
private Health store, script lock and append-only correction patterns; avoid a
new authentication or notification infrastructure and preserve transport errors.
