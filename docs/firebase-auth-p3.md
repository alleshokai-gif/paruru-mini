# P3 - Firebase Authentication production cutover

## Problem and evidence

The ordinary PWA still resolves its actor from `deviceId` and `pairingToken`, and the UI still exposes registration, six-digit pairing, pending, approval, READY/recovery, and device revocation flows. The P2 Firebase boundary exists but is only reachable through the isolated PoC route.

## Implementation policy

- Make Firebase LOCAL persistence the ordinary client session authority.
- Resolve every ordinary server actor through `Firebase ID token -> Home_Identities -> Home_Members`.
- Reject unmapped, disabled, revoked, wrong-project, non-Google, expired, forged, and UID-mismatched identities closed.
- Never fall back from Firebase authentication to device authentication.
- Keep legacy Registry, Device_Memberships, pairing services, and data intact, but reject legacy mutation routes with `LEGACY_DEVICE_AUTH_READ_ONLY`.
- Bind confirmation actor matching and rate limiting to the server-derived Firebase identity hash.
- Keep role and capability grants server-side; Google/Firebase sign-in does not grant privilege.
- Secret Console remains outside this change. The only shared boundary is the stable Script Property contract.

## Stable configuration contract

- `PALURU_FIREBASE_PROJECT_ID`
- `PALURU_FIREBASE_WEB_API_KEY`
- `PALURU_FIREBASE_AUTH_DOMAIN`
- `PALURU_FIREBASE_APP_ID`
- `PALURU_FIREBASE_GOOGLE_CLIENT_ID`

These are provider configuration values. The PWA obtains only the public Firebase/GIS configuration through `auth.config.get`. No client secret is introduced.

## Security control review

1. Asset: family identity, memo/health/home data, and privileged home operations.
2. Threat actor: an unauthenticated caller, an authenticated but unmapped Google account, or a baseline family member attempting privilege escalation.
3. Attack scenario: forge/replay a token, submit client-declared member/role/capability fields, reuse a confirmation under another actor, or force fallback to legacy device credentials.
4. Impact: cross-member disclosure or mutation, home control, supervision access, or administrative action.
5. Existing control: Firebase token validation with `accounts:lookup`, Home_Identities mapping, Home_Members policy, capability authorization, confirmation/idempotency checks.
6. Proposed control: one Firebase actor resolver for ordinary APIs, fail-closed mapping, rejection of legacy mutation routes, no fallback, and server-derived actor binding for confirmation/rate limits.
7. UX/operational cost: one Google sign-in on a new browser; Firebase LOCAL persistence avoids a login screen on normal reload. Account switch and logout are explicit.
8. Failure/recovery cost: provider/config/network failure shows a signed-out/error gate. Recovery is provider sign-in or normal reload; no PALURU registration, resume, rollback, recovery TTL, or manual cache deletion.
9. Proportionality: baseline access uses managed Google/Firebase authentication without mandatory MFA. Step-up remains reserved for separately approved high-risk operations.

## Impact and rollback

Ordinary PWA requests change to an `auth` envelope containing a short-lived Firebase ID token. Domain services continue receiving only the server-derived actor. Existing Home_Members, policies, operation idempotency, and prepare-confirm-execute remain unchanged.

Before Human deployment, rollback is Git-only: return the PWA and GAS sources to the preceding deployed revision. No production rows or legacy properties are changed by this implementation.

## Human acceptance after deployment

- Father and at least one other mapped member, on at least two devices.
- New device starts with Google only; no parent approval or six-digit code.
- Reload preserves the session and refreshed tokens continue.
- Logout is unauthenticated; account switching leaves no prior actor context.
- Unmapped accounts fail closed and baseline members gain no privileged capability.
- Ordinary APIs perform no Device Registry or Device_Memberships lookup and accept no pairing token.
