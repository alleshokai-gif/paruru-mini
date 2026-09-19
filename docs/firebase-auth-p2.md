# PALURU Firebase Authentication P2

Status: implementation and isolated localhost acceptance verified; no deploy

## Problem

PALURU Mini currently resolves an authenticated actor through a browser-held
pairing token, Device Registry, `Device_Memberships`, and `Home_Members`.
P2 must prove that a Google-authenticated Firebase identity can resolve the
same server-authoritative member and capability policy without using any
device-auth input.

## Evidence-backed cause

`resolveAuthenticatedActor_()` currently requires `deviceId` and
`pairingToken`, and the ordinary PWA boot gate calls `membership.context.get`
with those fields. The existing design therefore authenticates a device
credential rather than a Human identity.

## P2 implementation policy

- Use the official GIS button to obtain a Google ID token.
- Exchange it with Firebase through `signInWithCredential`.
- Use Firebase LOCAL persistence and Firebase-managed ID-token refresh.
- Send only the Firebase ID token to the isolated GAS PoC route.
- Verify the token before trusting any JWT claim.
- Resolve the verified Firebase UID through `Home_Identities`.
- Resolve role and capabilities only from the existing `Home_Members` policy.
- Do not connect the ordinary authentication gate in P2.
- Do not add registration, resume, rollback, recovery TTL, or fallback state.

## Impact range

New isolated frontend files under `features/auth/`, new GAS verifier/identity
services, one `authPocResolve` route, and dedicated tests. Existing ordinary
routes and device-auth behavior remain unchanged in P2.

## Side effects

The PoC depends on Google Identity Services, Firebase Authentication, and one
Firebase Auth account lookup per server-side identity resolution. Performance
and failure behavior must be measured before any ordinary-route cutover.

## Security controls and proportionality

### Firebase token verification and account-state lookup

1. Asset: the PALURU authenticated actor and its server-side capabilities.
2. Threat actor: an unauthenticated caller, a user from another Firebase
   project, or a previously valid user whose account/session was disabled or
   revoked.
3. Attack scenario: submit a forged, expired, wrong-project, wrong-provider,
   disabled, revoked, or UID-conflicting token to the PoC route.
4. Impact: impersonation of a family member and unauthorized access to family
   or home-control data.
5. Existing control: device pairing protects ordinary production routes, but
   it does not establish Google Human identity for this isolated PoC.
6. Proposed control: validate bounded Firebase claims, then require Firebase
   `accounts:lookup` success and compare UID, disabled state, revocation time,
   and Google provider before creating an actor.
7. UX/operational cost: one account lookup per actor resolution and two
   Firebase Script Properties; no extra prompt during a valid session.
8. Failure/recovery cost: fail closed with a safe error code. Recovery is by
   restoring the managed Firebase account/configuration; PALURU adds no retry,
   resume, rollback, or recovery state.
9. Proportionality: this protects family and home-control authorization while
   retaining Google/Firebase as the only credential/session authority.

### Server-side identity mapping and capability resolution

1. Asset: the binding between a Google/Firebase identity and `Home_Members`.
2. Threat actor: a signed-in but unmapped family/external account, or a client
   that submits another member ID, role, or capability.
3. Attack scenario: self-select `father`, `admin`, or `home.control`, or exploit
   duplicate/disabled identity rows.
4. Impact: horizontal account takeover or privilege escalation.
5. Existing control: `Home_Members` and its role/capability policy are already
   server-side, but device membership currently supplies the member binding.
6. Proposed control: exact-one active `Home_Identities` row resolves the
   verified Firebase UID; role and capabilities are then read only from the
   existing `Home_Members` policy.
7. UX/operational cost: an administrator must provision one mapping row per
   family identity; ordinary users see no new workflow.
8. Failure/recovery cost: missing, duplicate, disabled, or invalid rows fail
   closed and require an administrator to correct the source data. No client
   cache recovery is introduced.
9. Proportionality: six fixed family identities make explicit allowlisting
   small and auditable, while preventing Google login alone from granting
   privileged capability.

### Actor clearing on logout and account switch

1. Asset: the in-memory actor context shown and used by the PoC page.
2. Threat actor: the next user of the same browser, or a stale asynchronous
   response from the previous account.
3. Attack scenario: logout/account switch occurs while actor resolution is in
   flight and the old response restores the previous actor.
4. Impact: cross-account data display or requests under the wrong actor.
5. Existing control: Firebase sign-out clears its session, but it does not
   automatically clear PALURU page state.
6. Proposed control: clear the actor synchronously and invalidate in-flight
   resolution generations before Firebase sign-out completes.
7. UX/operational cost: the user must select the next account again; there is
   no extra credential or recovery screen.
8. Failure/recovery cost: sign-out failure leaves the page fail-closed without
   an actor; the user can retry standard Firebase sign-out/sign-in.
9. Proportionality: a small in-memory race guard prevents account confusion
   without creating durable PALURU session state.

## Rollback

P2 adds no production gate. Reverting its commit removes the isolated route and
PoC files. There is no per-user rollback or recovery workflow.

## P2 acceptance items

- Google login exchanges a GIS credential for a Firebase session.
- Reload restores the Firebase LOCAL session.
- Token refresh returns a new usable Firebase ID token without exposing it.
- Logout clears both Firebase user state and PALURU actor context.
- Account switch clears the previous actor before accepting another account.
- Forged, expired, wrong-project, disabled, revoked, non-Google, UID-mismatched,
  and unmapped identities fail closed.
- A mapped father/test identity resolves through `Home_Identities` to
  `Home_Members` without `deviceId`, `pairingToken`, or `Device_Memberships`.
- Client-supplied role/capability/member fields cannot elevate privileges.

## Isolated localhost acceptance

The committed examples contain placeholders only. The ignored browser config
selects the test Firebase Web App and points `gasWebAppUrl` to
`http://localhost:5000/auth-poc/resolve`. The ignored server config contains
the explicit test Firebase UID to `Home_Members` mapping. The localhost server
executes the committed GAS verifier, identity mapper, and actor resolver in a
Node VM, while its adapter performs the same documented Identity Toolkit
`accounts:lookup` request that GAS performs synchronously through
`UrlFetchApp`.

The server exposes an allowlist of PoC assets only, never logs token values,
and does not read or change production Spreadsheet data. It is an acceptance
harness, not an additional PALURU session authority and not a production
fallback.

## Verification evidence

Verified on 2026-09-19 against the isolated localhost harness:

- The official GIS button completed Google sign-in and Firebase
  `signInWithCredential` created the Firebase user session.
- A reload restored Firebase LOCAL persistence without showing another PALURU
  login workflow, and the server resolved the mapped father actor.
- Forced Firebase ID-token refresh produced another usable token without
  exposing its value.
- Account switch cleared the old actor before opening Google's account chooser;
  selecting the test account created only the newly resolved actor.
- Logout cleared the actor and Firebase user. A subsequent reload remained
  signed out.
- The returned actor used `Home_Members` role/capability policy while ignoring
  spoofed client member, role, and capability fields.
- The isolated route used no `deviceId`, `pairingToken`, Device Registry, or
  `Device_Memberships` lookup.
- Negative tests covered forged, expired, wrong-project, disabled, revoked,
  non-Google, UID-mismatched, unmapped, duplicate, and disabled mappings.
- Targeted Firebase auth tests passed, and repository-wide
  `node --test test/*.test.js` passed 117/117 file-level tests.
- `git diff --check` passed and the changed-file secret scan found zero
  matches. Ignored local Firebase test configuration was not staged.

No Apps Script, GitHub Pages, Firebase Hosting, or other production deployment
was performed. No production Spreadsheet or Script Property was read or
changed by the localhost acceptance harness.
