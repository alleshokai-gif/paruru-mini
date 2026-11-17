# TODAY live read investigation (local only)

The independent V3/Mini kind compatibility repair remains frozen at PR #217.
This branch is a local candidate only: no push, CI dispatch, model review, GAS
deployment, Pages publication or production configuration change is authorized.

## Observations and limits

- Existing `/v1/today` backend requests at 23:04, 23:16 and 23:42–23:43 JST
  all completed HTTP 200 in approximately 0.8–3.6 seconds. This does not prove
  that the browser received or accepted the full GAS response.
- Published GAS version 205 matches the relevant six Git source files. No
  matching safe GAS Transport stage records were returned from Cloud Logging.
- Apps Script execution metadata is blocked with HTTP 403 and
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. No new permission or authentication is
  requested. Actual GAS stage timing and the browser's individual failure code
  remain unverified. Do not label the production issue fixed.

Existing authenticated Apps Script UI access subsequently provided metadata
without adding scopes: the version-205 `doPost` executions starting at
23:42:46 and 23:42:54 lasted 9.205 and 9.513 seconds, both completed. Their
timestamps correlate with the two `/v1/today` HTTP-200 requests; an action or
request-suffix match is not available. The execution menu's Cloud Logs action
is disabled, and the existing Mini diagnostics UI reports no records. The
8-second client deadline is shorter than these observed GAS executions; the
exact historical browser abort code and the costly GAS substage remain
unverified. UI execution completion alone is not application/DTO success.

## Independently reproducible deadline gap

The Kaz read wrapper starts an 8-second AbortController timer, then awaits
`callHomeControlApi`. Authentication waits for a token before fetch receives
that signal. A pending authentication Promise can therefore keep the wrapper
pending after the declared deadline. An implementation that ignores abort can
also return a late success after the deadline. These are local reproducible
transport-contract defects, not proof of the historical production cause.

Candidate: race the existing read against its existing deadline, abort on the
same timer and return the existing timeout error/classification. Keep 8 seconds,
120 ms retry delay, two attempts, the same request ID, read-only scope and auth
boundaries. Never accept a late result from the timed-out attempt.

The existing GAS path also reads the entire same Decision Ledger Sheet twice
per TODAY request, once for classifications and once for planning preferences.
The two reads can observe different versions and add avoidable read latency.
The second local candidate takes one request-local snapshot for both existing
builders. It introduces no persistent cache or new store, retains standalone
helper behavior, and preserves the existing empty-evidence degradation when
the ledger is unavailable. Call-count reduction can be proven locally; elapsed
production time saved cannot be claimed without stage evidence.

Validate with virtual time (pending operation, late result, on-time result and
non-retryable business failure), plus existing read/auth/diagnostic/TODAY/PWA
regressions. No source data, Work claims, metrics or schedules are changed.
Rollback is dropping this unpushed branch or reverting its local commit.

Deployment remains separately gated: recover the actual safe browser/GAS
failure code/timing within existing access, assess the real cause, independently
review the candidate, obtain the outstanding publication permission, and run
real-browser acceptance. Do not increase timeouts to manufacture success.

## Local results

- Deadline tests against unchanged main: two fail, two pass. After the local
  candidate: all four pass with virtual time, no network and unchanged limits.
- Ledger tests against unchanged GAS code: four fail, two pass. After the
  candidate: all six pass, including one read, source-version consistency,
  immutable input, missing/non-array evidence, disabled evidence, standalone
  compatibility, and preservation of failed WorkBusy status.
- Combined focused run: 16 Node test entries pass; the legacy TODAY test entry
  also reports its 13 internal checks passing. Syntax and whitespace checks pass.
- No external review, push, CI, publication or deployment was performed for
  this local candidate. The PR #217 head and worktree remain unchanged.
