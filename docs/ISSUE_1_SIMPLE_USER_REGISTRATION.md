# Issue #1: Minimal Registration final design

## Problem

The previous registration implementation coupled fresh device registration to a
membership-only registration path and a multi-state recovery workflow. A fresh
request could create recovery states, recovery TTLs, resume actions, and client
approval-attempt state even though the durable registration facts are the active
device membership and active Registry credential.

## Fresh registration contract

```text
deviceRegistrationBegin
→ fresh requestId + fresh 6-digit code
→ admin selects memberUserId/displayName
→ idempotent approve
→ Device_Memberships active
→ Registry credential active
→ READY
```

Fresh registration has only three semantic states:

- `PENDING`
- `READY`
- `REVOKED`

An active `Device_Memberships` row is the authoritative device-to-member
binding. An active Registry credential plus that active binding is sufficient
for normal authentication. Request status is not a permanent authorization or
READY fact.

## Fresh-flow rules

- Every begin creates a new request id and code.
- A new begin invalidates older pending requests for the same device.
- A device has at most one active pending request.
- Expired or consumed codes are not displayed again.
- Approval accepts only the exact fixed-roster `memberUserId` and `displayName`.
- Registration does not accept or assign a role, capability, home id, or user id.
- New members receive the role-empty baseline; existing roles are preserved.
- Replaying the same approval idempotency key returns the existing READY result.
- Response loss is resolved by replaying approval or re-reading the active
  binding through status/authentication. Fresh registration has no resume flow.
- Fresh requests do not write `MEMBERSHIP_APPROVED`,
  `DEVICE_PROVISIONING_PENDING`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`, or
  `recoveryExpiresAt`.
- The PWA has no `membershipRegistrationBegin/status`, recovery list,
  approval-attempt recovery, or `devicePairingResume` path.

## Legacy isolation

Legacy handling may only close records created before this design:

- stored `membershipTemplate` may be translated to its fixed-roster identity;
- requests without `kind` retain pairing compatibility when structurally valid;
- existing partial requests may use the existing server-side resume endpoint;
- existing client approval request ids may be queried.

No endpoint may create a new membership-registration request. The new PWA does
not call legacy resume, approval-status, or membership-registration endpoints.

## Data and authorization boundaries

- Existing `Home_Members` rows and roles are preserved.
- Existing `Device_Memberships` rows are not deleted or duplicated.
- Duplicate or conflicting device bindings fail closed.
- Admin approval remains server-authorized.
- No Spreadsheet header migration is part of this change.
- No live eldest-daughter or second-son data is reset before deployment and
  real-device acceptance.

## Build identifiers

- PWA: `v20260917-minimal-registration-v1`
- Mini: `mini-20260917-minimal-registration-v1`

## Acceptance

- fresh device → code → identity → approve → READY;
- reload before approval remains PENDING;
- reload after approval reaches READY;
- response loss reaches READY by reload/status or identical approval replay;
- repeated identical approval does not add a membership row;
- a second device can bind to an existing member;
- active binding plus active credential is READY despite stale request state;
- wrong or expired codes do not mutate registration facts;
- no role or capability is granted;
- no fresh recovery state or membership-registration request is created;
- consecutive fresh begins do not reuse the pending request id or code.

Deployment and real-browser/PWA acceptance remain separate user-run phases.
