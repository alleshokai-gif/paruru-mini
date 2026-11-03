# TODAY AI judgment display — 2026-11-02

The 13:15 JST natural Planner judgment is the acceptance input. No new model
request is needed. Its bounded reference is `b28e7c51c11a`; private Work text,
reason, first action and raw identifiers are deliberately omitted here.

## Contract correction

- The server independently ages Snapshot dependencies. `today.valid_until=null`
  is intentional for a derived projection; it does not expire independently.
- Slot selection now requires same-day CURRENT Snapshot, non-future generation,
  current Work/Projects/Calendar/WorkBusy, future dependency expiries, matching
  TODAY/Work revisions, and a null or future derived TODAY expiry.
- An independently current Snapshot can supply windows when saved v2 DTO
  component deadlines have expired. Their deadlines are not rewritten.
- A fresh live v2 plan, including an empty window list, takes precedence.
  Explicit live source failure remains unavailable. Unconfigured company hours
  remain unavailable. Personal slots use personal windows, not combined KAZ
  windows. Existing quote/revision validation and proposal gates are unchanged.
- Display states when Snapshot schedules were observed. Non-visible DOM
  attributes associate the validated judgment and Work for exact comparisons;
  these are not diagnostics or telemetry.

## Evidence and limits

- Production `/v1/today` GET: HTTP200, `kaz-today-work-v1`, fresh complete Work.
  This is not the Calendar-inclusive GAS POST/v2 plan and is not claimed as one.
- Production GCS Snapshot is CURRENT, generated08:54:15 JST; Calendar expires
  18:30, Work/Projects next07:30, WorkBusy next00:00. Derived TODAY expiry is null.
  Saved component DTO deadlines are Work09:09 and Calendar09:24.
- The durable 13:15 judgment passes the existing Shadow validator. Feeding
  those actual records through the existing client transport validators and
  navigation DOM (in-memory transport only) matches judgment ID, Work link,
  reason, first action and generation time. Both stale-DTO and Snapshot-only
  inputs promote the executable proposal and disclose the Snapshot time.
- This proves stored production material reaches the display-data and DOM
  logic. It does not claim a fresh authenticated owner-session v2 HTTP response,
  browser layout or Android visual acceptance. Those remain unverified.
- Focused regressions cover null derived expiry, dependency expiration,
  mismatched revision, previous/future generation, live empty precedence,
  explicit source failure, company/personal separation and progress controls.
- Existing unrelated baseline failures: `kaz-v3-degraded-today.test.js` expects
  legacy NOW/NEXT headings; `kaz-v3-rebuild.test.js` lacks the existing
  `getKazOsProgressReadToken_` mock. Their implementation/test inputs are
  unchanged by this correction.

Only PALURU display code and release cache keys change. No backend image,
Scheduler, ledger, holds, Provider policy or canonical record is changed.
