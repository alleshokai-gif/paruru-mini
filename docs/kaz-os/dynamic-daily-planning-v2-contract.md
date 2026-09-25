# Dynamic Daily Planning V2 — Planning Preference Contract

Status: CONTRACT FROZEN FOR IMPLEMENTATION
Date: 2026-09-23
Timezone authority: Asia/Tokyo
Scope: Planning Preference, Daily Estimate, candidate selection, TODAY projection, and INBOX expiry projection only.

## 0. Purpose

Dynamic Daily Planning V2 combines:

- fresh Family Calendar
- Human-confirmed Calendar constraints
- fresh Notion Work Items
- explicit Human daily planning preference
- explicit Human duration estimate only when placement requires it

to produce:

- NOW
- NEXT
- SCHEDULED
- WAITING
- NOT FIT TODAY

V2 does not infer duration, mutate permanent Work Item Priority/Status, auto-carry preferences, auto-complete work, or introduce energy/context optimization.

The Human should normally make only decisions such as:

- "今日はこれやる"
- "これは30分くらい"

## 1. Source-of-truth boundaries

### Permanent / operational source

Notion Work Item remains authoritative for:

- Status
- Priority
- Deadline
- Scheduled
- permanent Estimate Min
- Next Action
- Blocker
- Project relation

V2 MUST NOT mutate these fields as a side effect of daily planning.

### Daily / ephemeral planning source

The existing Kaz OS Decision Ledger is the preferred durable store for Human daily-planning answers.

Daily planning records are evidence for a bounded planning period. They are not Work Item lifecycle authority.

## 2. Decision kinds

V2 adds two durable Human decision kinds.

### DAILY_PLANNING_PREFERENCE

Human chooses one of:

- today
- this_week
- later

### DAILY_ESTIMATE

Human provides an explicit positive duration in minutes for one Work Item for one planning date.

No AI estimate is permitted.

## 3. Durable record contract

The Decision Ledger remains append-only. Existing answer/proposal persistence mechanics and transport reconciliation are reused.

The durable proposal/change payload for a planning preference MUST contain:

```json
{
  "kind": "DAILY_PLANNING_PREFERENCE",
  "work_item_id": "<durable Work Item UUID>",
  "planning_date": "YYYY-MM-DD",
  "timezone": "Asia/Tokyo",
  "preference": "today | this_week | later",
  "source": "human",
  "work_item_source_revision": "<revision>",
  "project_source_revision": "<revision or null>",
  "valid_from": "<ISO-8601>",
  "expires_at": "<ISO-8601>"
}
```

The durable proposal/change payload for a Daily Estimate MUST contain:

```json
{
  "kind": "DAILY_ESTIMATE",
  "work_item_id": "<durable Work Item UUID>",
  "planning_date": "YYYY-MM-DD",
  "timezone": "Asia/Tokyo",
  "estimate_min": 30,
  "source": "human",
  "work_item_source_revision": "<revision>",
  "valid_from": "<ISO-8601>",
  "expires_at": "<ISO-8601>"
}
```

Required invariants:

- `work_item_id` MUST be the durable Work Item identifier.
- ephemeral Secretary Decision IDs MUST NOT be used as durable relation authority.
- `planning_date` MUST be derived in Asia/Tokyo.
- `source` MUST be `human` in V2.
- `estimate_min` MUST be an integer > 0.
- V2 does not write Daily Estimate into Notion `Estimate Min`.
- the existing Answer envelope retains actor, decision_id, question_revision, source revision references, idempotency metadata, timestamps, and persistence status.

## 4. Revision binding

Revision binding is decision-kind specific.

### Calendar decisions

Remain bound to:

- Calendar source revision
- event_ref

### Daily Planning Preference

Bound to:

- target Work Item durable ID
- target Work Item source revision at answer time
- Project source revision only when the question materially depends on Project evidence

A Planning Preference MUST NOT be invalidated merely because an unrelated Calendar revision changes.

### Daily Estimate

Bound to:

- target Work Item durable ID
- target Work Item source revision at answer time

A Daily Estimate MUST NOT be invalidated by unrelated Project or Calendar revisions.

### Revalidation rule

At answer time, the target entity and the revisions relevant to that decision kind MUST be re-read and revalidated.

Unrelated source revision changes MUST NOT invalidate the answer.

## 5. Planning date and timezone

Canonical timezone is always:

`Asia/Tokyo`

`planning_date` is the local calendar date in that timezone.

Day boundary:

- starts at 00:00:00.000 JST
- ends immediately before next-day 00:00 JST

All expiry comparisons are evaluated against absolute timestamps, but date semantics are JST semantics.

## 6. Preference lifetime

### today

Effective only for `planning_date`.

Expires at next-day 00:00 JST.

It MUST NOT auto-carry into the next day.

If unfinished, Secretary may generate a new question on a later date.

### this_week

Means "eligible during the remainder of this Japanese planning week, but not automatically adopted into TODAY."

The planning week is Monday through Sunday in Asia/Tokyo.

Expires at Monday 00:00 JST immediately following the relevant week.

It MUST NOT be automatically converted to `today`.

### later

Means "do not place this item into TODAY or the current week's active candidate pool."

To avoid a one-click permanent suppression, V2 defines `later` as bounded to the remainder of the same Monday-Sunday planning week.

It expires at the same weekly boundary as `this_week`.

After expiry, the Work Item may surface again from its operational state, deadline, schedule, or a new Human preference.

## 7. Effective preference resolution

For one Work Item, the newest valid Human planning preference whose relevant Work Item revision still matches is authoritative for that preference window.

Invalid, expired, or stale records are ignored by the planner but retained in the append-only ledger.

Precedence while valid:

- later -> suppress from TODAY/current-week candidate pool except fixed operational obligations described below
- today -> explicit TODAY candidate intent
- this_week -> keep as a current-week candidate but suppress flexible TODAY auto-adoption for the current day; fixed operational Scheduled obligations remain visible

A newer valid preference supersedes an older valid preference for the same Work Item and overlapping planning window.

## 8. Work Item eligibility

### Terminal states

These are never TODAY candidates:

- DONE
- CANCELLED

Their open preference/estimate questions become invalid immediately.

### Waiting states

These project into WAITING rather than flexible execution placement:

- HUMAN_REVIEW
- ACCEPTANCE
- WAITING
- BLOCKED

The planner does not use a preference to pretend these are executable.

A Human Review or Acceptance decision remains active according to its own revision-bound lifecycle and does not expire merely because the clock crossed midnight.

### Default actionable states

These may enter execution candidate selection from operational data:

- DOING
- SCHEDULED
- READY

### BACKLOG promotion rule

BACKLOG is not a default TODAY execution candidate.

A BACKLOG Work Item becomes a V2 TODAY candidate only when:

- it has a current valid `preference=today`, and
- it is not terminal, waiting, or blocked by current operational evidence.

This promotion is planner-local only.

It MUST NOT change Notion Status from BACKLOG.

### IDEA

IDEA is not promoted by Daily Planning Preference in V2.

Idea triage remains a separate decision domain.

## 9. Fixed scheduled obligations

A Work Item with an explicit operational `Scheduled` interval that intersects the planning date is a fixed scheduled obligation unless current state makes it terminal or invalid.

A valid `later` preference does not erase an already-fixed operational schedule. The fixed schedule remains visible in SCHEDULED because Daily Planning Preference is not authority to rewrite operational scheduling.

If the Human wants the fixed schedule changed, that is a separate operational change outside V2.

## 10. Candidate selection policy

V2 MUST NOT create an opaque AI score.

Selection uses an explicit deterministic lexicographic policy from authoritative fields.

For flexible execution candidates, compare in this order:

1. currently DOING
2. valid Human `preference=today`
3. explicit Deadline already overdue or due on `planning_date`
4. explicit operational Scheduled date on `planning_date` where no fixed interval exists
5. explicit Priority: CRITICAL, HIGH, MEDIUM, LOW
6. actionable state precedence: DOING, READY, SCHEDULED, BACKLOG-promoted
7. stable durable Work Item ID as final deterministic tie-breaker

No creation timestamp is ranking authority.

No model-generated business priority is ranking authority.

`this_week` alone does not raise an item into TODAY.

`later` suppresses flexible candidacy for its valid weekly window.

## 11. Progressive Estimate contract

Estimate is requested only when all of the following are true:

- the item is an active TODAY flexible candidate,
- placement into a free Calendar window requires a duration,
- Notion permanent `Estimate Min` is absent,
- no valid Daily Estimate exists for the same Work Item and planning date.

Estimate is NOT required when:

- a fixed Scheduled interval already provides start and end,
- the item is in WAITING,
- the item is no longer a TODAY candidate,
- the item became DONE/CANCELLED,
- a permanent Estimate Min exists.

Daily Estimate:

- is Human-supplied only
- is date-scoped
- expires at next-day 00:00 JST
- does not auto-write to Notion
- does not auto-carry to tomorrow

While a flexible TODAY candidate needs an estimate and none exists, it is not falsely treated as zero minutes and is not marked NOT FIT TODAY.

It projects to WAITING with reason `ESTIMATE_REQUIRED`, and an INBOX estimate question is generated.

## 12. Calendar availability

Planning uses fresh Calendar plus current Human-confirmed Calendar classifications.

- full_event -> full event interval is busy
- partial_event -> only explicit constraint_window is busy
- none -> not busy
- unknown/unanswered -> MUST NOT be treated as free

Timed Calendar events cease to affect future planning after event end.

Past busy intervals may be clipped away when computing remaining-day free windows.

## 13. Flexible placement

Only candidates with a known explicit duration may be flexibly placed.

Duration authority order:

1. valid Notion permanent `Estimate Min`
2. valid Daily Estimate for `planning_date`

The planner MUST NOT infer a duration.

Flexible candidates are placed in deterministic candidate order into remaining confirmed free windows.

Placement MUST NOT overlap:

- fixed Calendar constraints
- fixed Scheduled Work Items
- already placed Work Items

A flexible item must fit wholly inside a free window.

V2 does not split one Work Item across multiple windows.

## 14. TODAY projection contract

### NOW

Maximum: 1 item.

Selection:

1. if a fixed scheduled Work Item is currently active, that item is NOW;
2. otherwise if an already placed flexible item is currently active, that item is NOW;
3. otherwise the first executable placed/flexible candidate that can start now is NOW;
4. otherwise NOW is empty.

NOW MUST NOT contain a WAITING item.

### NEXT

Maximum: 2 items.

NEXT contains the next two executable non-fixed candidates in deterministic planning order after NOW.

Future fixed-time items remain in SCHEDULED and do not consume the NEXT quota merely by existing.

### SCHEDULED

Contains:

- fixed operational Scheduled Work Items for the day
- flexible Work Items after the planner has assigned explicit start/end times

Each entry exposes its placement basis.

### WAITING

Contains non-terminal items not presently executable because of Human/state dependency, including:

- HUMAN_REVIEW
- ACCEPTANCE
- WAITING
- BLOCKED
- ESTIMATE_REQUIRED

WAITING is not capped to 3.

### NOT FIT TODAY

Contains a TODAY flexible candidate only when:

- it has a known explicit duration, and
- it remains otherwise executable, and
- there is no remaining confirmed free window large enough to place it.

Missing Estimate MUST NOT be mislabeled as NOT FIT TODAY.

NOT FIT TODAY does not mutate Status, Priority, preference, or next-day planning state.

## 15. "今日の3つ"

The primary execution focus is:

- NOW: maximum 1
- NEXT: maximum 2

Therefore the Human-facing focus is at most three items.

SCHEDULED obligations are displayed separately.

WAITING and NOT FIT TODAY are informational/planning sections and do not consume the three-item focus quota.

## 16. INBOX as current Human Decision Queue

INBOX is a projection of currently valid Human decisions.

Expired or invalid questions are normally hidden.

Expiry projection MUST NOT delete historical ledger rows.

### Calendar timed event

- before end: may remain answerable when planning relevance exists
- at/after event end: expired
- partial-window follow-up: expired at event end

### Today Focus / Daily Planning Preference question

- question is valid only for its target planning period
- a `today` question expires at next-day 00:00 JST
- a current-week preference question expires at the weekly boundary
- target DONE/CANCELLED invalidates immediately
- target Work Item relevant revision change invalidates and may cause regeneration

### Daily Estimate question

Hide immediately when:

- target is no longer a TODAY flexible candidate
- permanent Estimate Min becomes available
- a valid Daily Estimate already exists
- target becomes DONE/CANCELLED
- target moves to waiting/blocked state
- planning date ends

### Human Review / Acceptance

No clock-based expiry.

Invalidate when the target Work Item/relevant evidence revision makes the question stale.

### Blocked decision

No simple clock-based expiry.

Invalidate when blocker/state/relevant revision changes.

## 17. Projection freshness and regeneration

The planner recomputes when any relevant source changes:

- Calendar snapshot
- Calendar Human classification
- Work Item snapshot
- Daily Planning Preference
- Daily Estimate
- Human Review / Acceptance / blocker evidence

Question IDs may be ephemeral.

Durable relation authority remains source entity ID + decision-kind-specific source revision binding.

A regenerated question MUST receive a new question revision when its effective decision contract changed.

## 18. Writes and side effects

Allowed V2 writes:

- append Human Answer to existing Decision Ledger
- append controlled Planning Preference proposal/evidence
- append controlled Daily Estimate proposal/evidence

Disallowed V2 side effects:

- Notion Status mutation
- Notion Priority mutation
- Notion Scheduled mutation
- Notion Estimate Min mutation
- Calendar mutation
- automatic DONE
- automatic carry-over
- AI duration inference
- energy/context suitability ranking

## 19. Failure behavior

V2 fails safe.

- unknown Calendar time is not free
- unknown Estimate is not zero
- stale preference is not silently reused
- stale estimate is not silently reused
- malformed planning evidence must not grant additional free time
- transport write retries remain forbidden
- response-loss reconciliation keeps existing decision_id + question_revision + DURABLE_PERSISTED rules

Transport architecture itself is out of V2 scope.

## 20. Required implementation acceptance

Implementation is not complete until tests prove at minimum:

1. today preference expires at day boundary and does not auto-carry
2. this_week expires at weekly boundary and never auto-becomes today
3. later suppresses only through current weekly boundary
4. BACKLOG + today becomes planner-local TODAY candidate without Notion mutation
5. IDEA + today does not bypass idea triage
6. DONE/CANCELLED invalidates preference and estimate questions immediately
7. unrelated Calendar revision does not invalidate Work Item preference/estimate
8. relevant Work Item revision does invalidate/regenerate stale preference/estimate question
9. missing Estimate generates one progressive estimate question only for an active flexible TODAY candidate
10. missing Estimate is never treated as zero or NOT FIT TODAY
11. fixed scheduled interval does not require a Daily Estimate
12. known-duration item that cannot fit appears in NOT FIT TODAY
13. unknown/unanswered Calendar time is never treated as free
14. NOW <= 1 and NEXT <= 2
15. fixed future scheduled items remain in SCHEDULED and do not consume NEXT quota
16. Human Review/Acceptance/Blocked appear in WAITING and are not flexibly placed
17. no AI score or AI duration field exists in the V2 output
18. no Notion/Calendar mutation occurs
19. expired questions are hidden by INBOX projection without deleting ledger history
20. answer write remains non-retrying and transport reconciliation behavior is unchanged

## 21. Frozen V2 non-goals

Deferred to V3 or later:

- AI duration inference
- energy-aware optimization
- productivity learning
- context suitability such as PC-required / outside-home
- AI-created ranking score
- permanent Priority changes
- permanent Status changes
- automatic carry-over
- automatic DONE
- task splitting across Calendar windows
