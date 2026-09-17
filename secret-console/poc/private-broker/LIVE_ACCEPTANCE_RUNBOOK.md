# Live Acceptance Runbook (Human-operated)

This runbook is for an isolated, synthetic-only Google Cloud and Apps Script
PoC. It is not authorization for Codex to deploy. Do not use a production
project, production Mini project, production secret, existing gateway, or
existing Web App deployment.

Never paste a project ID, account email, OAuth client ID, owner-subject digest,
broker URL, token, or synthetic payload into chat, Git, screenshots, test
reports, or commands saved in shell history. Evidence returned to chat must be
limited to booleans, counts, safe codes, operation aliases, build aliases, and
elapsed time.

## 1. Human creates isolated resources

Use a dedicated non-production Google Cloud project when possible. Human
creates all resources and performs every deploy operation.

- A named Firestore Native database dedicated to this PoC.
- A dedicated Firestore collection, for example `poc_operations`.
- A dedicated synthetic-only Secret Manager secret with one synthetic version.
- A dedicated Cloud Run runtime service account.
- A dedicated private Cloud Run service. Do not grant `allUsers` or
  `allAuthenticatedUsers`.
- A new standalone Apps Script project containing only `apps-script/Code.js`
  and `apps-script/appsscript.json` from this directory.

The runtime service account receives only:

- document read/write access scoped to the PoC Firestore database; and
- Secret Manager accessor scoped to the one synthetic PoC secret.

It receives no role on production secrets, the production gateway, or the
production Mini project.

## 2. Derive identity binding without displaying a token

In the isolated Apps Script editor, run `pocIdentityBindingMetadata_` manually.
Authorize the three manifest scopes. The execution result exposes only:

```text
audience
owner_subject_sha256
issuer_valid
has_exp
has_iat
has_nbf
```

Copy `audience` and `owner_subject_sha256` directly into the isolated Cloud Run
configuration. Do not paste either into chat. Never decode or print the raw
token. Configure the Apps Script client ID as a Cloud Run custom audience.

Start without `userinfo.email`. If the request is rejected by the Cloud Run IAM
front door before an application log exists, record only the HTTP status and
safe timestamp. Then, and only then, add `userinfo.email` to the isolated
manifest, reauthorize, and repeat. Remove it again if it makes no difference.

## 3. Human deploys the isolated broker

Build only this directory. The container must use these settings:

```text
POC_OPERATION_STORE_MODE=firestore
POC_SECRET_STORE_MODE=gcp
POC_GCP_PROJECT_ID=<kept private>
POC_FIRESTORE_DATABASE_ID=<kept private>
POC_FIRESTORE_COLLECTION=poc_operations
POC_SYNTHETIC_SECRET_ID=<kept private>
POC_SYNTHETIC_SECRET_VERSION=<synthetic version only>
POC_OPERATION_ALIAS=<safe synthetic alias>
POC_OIDC_AUDIENCE=<kept private>
POC_OWNER_SUBJECT_SHA256=<kept private>
```

Deploy with unauthenticated access disabled, at least two maximum instances,
and the dedicated runtime service account. Grant Cloud Run Invoker only to the
Human owner used by the isolated trigger. The application also enforces the
subject digest, so IAM and application checks must both pass.

Set the isolated Apps Script property `POC_PRIVATE_BROKER_URL` to the isolated
service URL. Do not modify production Mini Script Properties.

## 4. Human creates the time-driven trigger

In the isolated Apps Script editor:

1. Open **Triggers** in the left sidebar.
2. Select **Add Trigger**.
3. Function: `pocPrivateBrokerTick_`.
4. Event source: **Time-driven**.
5. Select a five-minute interval for the observation window.
6. Save while signed in as the intended owner.

Observe at least three scheduled executions. Record only trigger scheduled
time, start time, elapsed time, result safe code, and operation alias. The
official trigger UI creates the trigger; no `script.scriptapp` scope is added.

## 5. Required test matrix

Record PASS/FAIL/UNKNOWN without recording tokens or identities.

| Test | Required observation |
|---|---|
| valid owner | poll to ACK succeeds |
| missing token | rejected before application action |
| malformed token | rejected |
| wrong audience | rejected |
| wrong owner | rejected by IAM or application owner binding |
| duplicate trigger | one slot application |
| overlap | one execution gets ScriptLock; no second apply |
| expired lease | old lease rejected; same operation gets a new lease |
| competing lease | exactly one transaction wins |
| ACK loss | local last-applied marker causes ACK-only retry |
| cold start/restart | Firestore state resumes |
| two instances | one operation is applied once |
| idempotent ACK | repeat ACK is safe; redeem remains rejected |

An actually expired Google ID token cannot be produced by editing claims: that
would test signature rejection instead. It requires a real token retained only
in volatile memory until expiry. Do not persist or print it. If that controlled
one-hour harness is not approved, record the real expired-token row as UNKNOWN
and keep the overall gate CONDITIONAL.

## 6. Leakage inspection

After the observation window, Human inspects:

- Cloud Run request and application logs;
- Cloud Audit Logs;
- all documents in the PoC Firestore collection;
- Apps Script Executions and error details; and
- local build/test artifacts.

Search for the synthetic payload using a local comparison without returning the
matching value. Also check for JWT-shaped strings, Authorization headers, email
addresses, raw request bodies, and raw subjects. Report counts only:

```text
synthetic payload: 0
OIDC token/JWT: 0
Authorization header: 0
email: 0
raw subject: 0
raw request body: 0
```

## 7. Stop and evidence handoff

Do not update production Mini, production credentials, the Kaz gateway, or a
production Secret Manager secret. Do not continue to Substep 4.

Return only the following redacted evidence:

```text
OIDC valid owner: PASS/FAIL
openid-only Cloud Run: PASS/FAIL
userinfo.email required: YES/NO/UNKNOWN
scheduled trigger observations: <count>
duplicate/overlap: PASS/FAIL
Firestore atomic lease: PASS/FAIL
cross-instance apply once: PASS/FAIL
ACK recovery: PASS/FAIL
restart recovery: PASS/FAIL
leakage counts all zero: YES/NO
production Mini diff: 0/nonzero
production credential changes: 0/nonzero
unresolved: <safe codes only>
```
