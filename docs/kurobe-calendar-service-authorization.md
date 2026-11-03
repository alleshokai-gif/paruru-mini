# Kurobe shared Calendar authorization correction

## Evidence and scope

The published v202 Calendar API applies the app-only `getHomeMember_` gate to
`line_group` requests. Read-only inspection of the bound Home_Members sheet found
one active policy-matching row for four roster members, and no rows for two.
No user or membership data is changed by this correction. LINE's private GCS
registry already contains all six confirmed identities. Calendar tags select
event ownership; HomeMemberPolicy defines the fixed roster/tags, not app enrollment.

The user's requested design correction authorizes a trusted internal service
principal for shared LINE queries. Keep the existing Calendar token and endpoint.
As in the existing internal Weather read, the Secret Manager token authenticates
the service; a `service` label is only an allowlisted operation contract.

## Security proportionality review

1. Asset: minimized shared family Calendar categories and times.
2. Threat actor: an untrusted LINE sender, another group, or an anonymous API caller.
3. Scenario: forge a sender/target, call the API without a token, or ask for private facts.
4. Impact: unauthorized family information disclosure.
5. Existing controls: LINE HMAC/destination verification in process_webhook;
   exact family-group equality at reply_v12 entry; private sender-to-member map;
   internal Secret Manager token validation before any Calendar operation;
   fixed shared Calendar source and safe line_group projection.
6. Correction: explicit service-only line_group request with a fixed roster requester
   and separate target; mine can target only the requester. Reject actor, snapshot,
   unknown service/audience, unknown members and unsupported periods in this contract.
7. UX cost: none; no app enrollment, new login, credential or configuration.
8. Failure recovery: existing unavailable response; no error becomes empty/success.
9. Proportionate scope: service contract reads only the existing shared Calendar,
   never private calendars, titles, descriptions, medical or confidential details.
   It cannot select an app/raw DTO or mutate anything. Existing app authentication
   and Snapshot contracts retain their current membership checks.

The internal Calendar token is a trusted service credential shared with existing
internal readers; this change does not claim that the service label authenticates
a specific machine. LINE identity and group validation stay at the trusted webhook.
The API's Calendar source is deployment-bound, not selected by caller homeId.

## Design reset after approval review

The first proposal was rejected because removing homeId was not adequately justified.
Retain explicit homeId on the service request and compare it with the existing
KAZ_OS_PROGRESS_OWNER_HOME_ID Secret through the same owner-OAuth Secret Manager
read pattern. No new secret, actor impersonation or membership row. This binds
the service to the canonical household even though the shared source is fixed.
The fixed HomeMemberPolicy includes all six identities; it never queries the
Home_Members sheet. A separate GAS regression proves that distinction.

## Acceptance and rollback

- Regression proves invalid signature/destination, other group and unknown sender
  cannot reach Calendar, while a known member in the verified group can.
- Token failures, contract abuse, private/sensitive events and cross-person mine
  queries stay denied. App requests still require their original active membership.
- Six real requester cases must return identical shared family results; own filters
  and shared per-person filters must select the requested roster member only.
- Deploy GAS compatibly first, then the existing Cloud Run by digest. Preserve
  published manifest, deployment ID/URL and unrelated HEAD. No artificial LINE post.
- Roll back Cloud Run to 00028-zjl and the existing GAS deployment to version 202;
  this restores prior behavior without modifying identities or Calendar data.
