# Issue #1: simple user registration

## Problem

Device approval currently requires a `membershipTemplate`. The template selects
a fixed member and also assigns that member's roster `role`. Authentication then
rejects an otherwise valid member row when the stored role differs from the
roster role. This couples device registration to privilege assignment and keeps
some of the six fixed identities from registering.

## Confirmed cause

- `devicePairingApprove` accepts `membershipTemplate` instead of member identity.
- provisioning resolves `memberUserId`, `displayName`, and `role` from that
  template and writes the role into `Home_Members`;
- `isHomeMemberPolicyMatch_()` treats the roster role as identity data; and
- a member without one of the three known roles cannot authenticate.

The resumable Issue #1 state machine is independent of this coupling and remains
the registration/recovery authority.

## Change policy

- Approval accepts only `memberUserId` and `displayName` as the target identity.
- All six entries in the fixed roster are valid identities. Their roster roles
  and legacy approval-template metadata are not registration inputs.
- A newly created `Home_Members` row has an empty `role` and receives baseline
  capabilities/views in code.
- Registration preserves an existing member role. It never grants, removes, or
  overwrites privileges.
- `Device_Memberships` remains the device-to-member binding and the existing
  approval request id remains the idempotency key.
- Legacy partial recovery records may be translated from their stored template
  to a roster identity, but all new approval and recovery writes use identity.
- A separate admin privilege-management operation is outside this registration
  change; no unreviewed role/capability mutation API is introduced here.

## Impact and side effects

- Members with no role can reach `READY` and use the common baseline features.
- Existing `admin`, `guardian`, and `self_record` rows keep their current access.
- Identity-specific access overrides are removed; the fixed roster is used only
  to validate `memberUserId` and exact `displayName`.
- Admin-only pairing approval and home-control authorization remain privileged.
- No Spreadsheet headers are added, reordered, or deleted. No existing rows are
  migrated or deleted.
- PWA Build ID is `v20260915-simple-user-registration-v1`; Mini Build ID is
  `mini-20260915-simple-user-registration-v1`.

## Rollback

Revert this commit. The previous resumable registration code and existing data
remain intact because this change performs no migration.

## Acceptance items

- all six exact roster identities can be approved without template or role;
- unknown identity and display-name mismatch are rejected;
- a new member is active with an empty role and baseline access;
- an existing privileged role is preserved during device binding;
- registration payload contains no `membershipTemplate` or `role`;
- duplicate approval and repeated retry remain idempotent;
- reload recovery resumes by stored member identity;
- baseline access excludes settings, supervision, inbox review, and home control;
- existing admin approval/home-control behavior remains authorized;
- full repository test suite passes;
- after user deployment, real-browser/PWA acceptance verifies the above flows.
