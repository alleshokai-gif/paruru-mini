# Issue #251 — staged implementation evidence

## Scope and review

The owner-assigned Windows Task took over an unsupported `/run` intake. No
Controller receipt/run, Work claim, or duplicate dispatch was fabricated.
Model v2 was independently reviewed before implementation (SHA256
`e79ca82932d9d33da08d543046a955c6141754aa3cea761d4ad8c554e3a5d6ab`).
The independent code reviewer found a cross-plan replay collision, a historical
first-record conflict and formula interpretation of correction text. All three
were fixed and re-reviewed; reads now also share the mutation lock. This is an
actual source review, separate from GitHub's required checks and live acceptance.

Claude UI delegation used the existing authenticated CLI, synthetic specification
and code only, with no shell/network tools or private health data. Session
`8e176ec6-b2ee-4640-a82c-c44b2ec61b38`, observed model `claude-sonnet-5-5`,
exit 0. Reported API-equivalent usage $0.4050962 is not an actual billed-cost
measurement. No API key, new paid contract or production model call was added.
Codex integrated the UI and fixed JST/server-clock, lifecycle and replay behavior.

## Local evidence (synthetic only)

50 tests passed: new domain/store/gateway and UI tests plus existing Health
security, target, gateway and routine tests and the three required repository
suites. Syntax checks and `git diff --check` passed.

The Chrome local fixture exercised the real new component/entry module through
the Mini Health Gateway and Health-service handlers with in-memory synthetic
Sheets and simulated verified actors. It demonstrated a persisted append/read,
correction to held removing timers, weekday setting change and a second actor's
fresh read of that change, denied disabled actor, and cleared DOM on lock.
320/390/1440 px had no horizontal overflow; observed action height was 44 px.
This does not prove real-device synchronization or production Sheets writes.

Reproduce locally from the repository root:

```text
node --test test/medication-routine-domain.test.js test/medication-routine-ui.test.js
node test/fixtures/medication-routine-browser.cjs
```

Open the loopback URL printed by the fixture. It has no production connection,
external asset, real identity or notification. Stop the fixture process afterward.

## Release boundaries and safe order

1. Independently compare current Mini/Health HEAD and published source, manifests
   and Web App settings. Preserve unrelated HEAD work and the existing rendered
   Health verifier. No auth, URL, scope or access change belongs to this feature.
2. After required review/CI, stage only the reviewed Health Code/domain/service
   and Mini Health Gateway through the existing source release procedure.
   Any rendering step must follow AGENTS and managed-secret operations; no token
   or rendered verifier belongs in Git or an issue.
3. The existing GAS Web App version updates are owner-only under AGENTS. The
   explicit setup function `setupMedicationRoutineSchema` adds only the two new
   header-based tables in the existing private Health spreadsheet. Neither it nor
   deployment is invoked by reads, tests or the client. Preserve all old tables.
4. Publish the compatible UI only after backend readiness is demonstrated. Use
   synthetic acceptance first; do not register a real family's regimen as a test.
   Keep the previous Mini/Health versions and Pages commit as rollback points.

## Incomplete acceptance

No GAS source push/version update, production schema initialization, production
UI publish or real health write was performed in this evidence record. Production
membership/device/Sheet acceptance remains separate from the local fixture.

Signage/TTS transport is **not connected**. Only the pure anonymous due projection
is implemented/tested: explicit enable, unrecorded only, narrow delivery window,
no midnight catch-up, and suppression after held/completed/disabled. An existing
authenticated adapter has not been established in this repository. No endpoint,
schedule, live notification, speech or public health feed was added. The UI
states the limitation. Issue #251 remains incomplete until that existing private
connection and its safe acceptance are established.
