# PALURU Central Secret Console — Rotation State Machine

Status: Phase 1 normative workflow

Timezone: state timestamps are RFC 3339; Human-facing times use `Asia/Tokyo`

## 1. State model

```text
draft
  -> input_pending
  -> staging
  -> staged
  -> distributing
  -> distributed
  -> verifying
  -> verified
  -> revoke_approval_pending
  -> previous_disable_in_progress
  -> previous_disabled
  -> regression_verifying
  -> closed
```

Failure and recovery states:

```text
staging_failed
distribution_partial
verification_failed
previous_disable_failed
regression_failed
operation_state_unknown
  -> rollback_in_progress
  -> rolled_back
  -> manual_recovery_required

draft | input_pending | staged
  -> cancelled             # only before activation
```

`closed`, `rolled_back`, `manual_recovery_required`, and `cancelled` are terminal for that rotation. Follow-up work creates a new rotation or an explicitly linked recovery record; history is not rewritten.

## 2. State definitions

| State | Entry requirement | Permitted next action |
| --- | --- | --- |
| `draft` | immutable credential/binding revision snapshot created | validate plan |
| `input_pending` | capabilities and policy pass | Human secret input or cancel |
| `staging` | valid Human input accepted transiently | adapter staging only |
| `staged` | all required bindings staged and audit persisted | distribute or cancel/cleanup |
| `distributing` | fixed rollout order locked | adapter activation only |
| `distributed` | every required binding activated | verify |
| `verifying` | fixed required probes locked | probe execution only |
| `verified` | all required pre-revoke probes passed | request Human revoke decision |
| `revoke_approval_pending` | verified evidence still fresh | approve, reject, or rollback |
| `previous_disable_in_progress` | approval valid and revisions unchanged | adapter disable/revoke only |
| `previous_disabled` | all required old-material actions acknowledged | regression verify |
| `regression_verifying` | fixed post-disable probes locked | probe execution only |
| `closed` | all required regression probes pass and audit persistence confirmed | none |

## 3. Transition guards

### Create: `none -> draft -> input_pending`

- Credential exists and is not retired.
- No other active rotation exists for that credential/environment.
- Credential and binding revisions are snapshotted.
- Every required adapter reports capabilities without secret read-back.
- Required staging, rollback, disable, and probe capabilities satisfy policy.
- The audit `rotation_created` event is durably persisted.

Failure returns to no rotation or `manual_recovery_required`; it does not accept a value.

### Stage: `input_pending -> staging -> staged`

- Recent Human re-authentication/user presence is valid.
- The secret-input request passes category validation without detailed reflection.
- Each adapter is called once per binding operation ID.
- A retry with the same idempotency key returns the same redacted result.
- The value is not copied into rotation, audit, log, trace, metric, exception, or response state.

Any known staging failure enters `staging_failed`. An uncertain backend outcome enters `operation_state_unknown`; the system must inspect redacted operation status before any retry.

### Distribute: `staged -> distributing -> distributed`

- Registry/binding revisions still match the snapshot.
- All required stages exist and have not expired.
- Adapters run in `rolloutOrder`; dependent ties are rejected.
- Each successful activation event is persisted before the next dependent binding starts.

If a later binding fails, state becomes `distribution_partial`. The system stops; it does not probe, revoke, or activate remaining bindings.

### Verify: `distributed -> verifying -> verified`

- Only registry-defined probe runners execute.
- Every required probe returns `PASS` within timeout.
- Evidence records probe ID, safe result code, elapsed time, time, and consumer build/revision alias when available.
- Evidence has a configured freshness window.

Any required failure enters `verification_failed`. Optional probes may warn but cannot mask a required failure.

### Revoke approval: `verified -> revoke_approval_pending`

The Console displays:

- logical credential and consumers;
- required probe results and times;
- rollback capability before and after disable;
- exact consequence of provider disable/revoke; and
- whether the action is reversible.

It displays no value or value-derived representation. Approval is explicit, single-use, bound to the revision snapshot, and expires when evidence becomes stale.

### Disable: `revoke_approval_pending -> previous_disable_in_progress -> previous_disabled`

- Valid approver identity and approval ID are required.
- `disable` is preferred over destruction.
- An irreversible external-provider revoke requires a provider-specific contract and separate confirmation.
- A partially disabled binding set enters `previous_disable_failed`; no remaining destructive action continues.

### Regression: `previous_disabled -> regression_verifying -> closed`

- Rerun the same required end-to-end probes unless the policy defines a stricter post-disable set.
- Verify the old path is rejected only through a safe provider/consumer status or purpose-built probe; never by displaying the old value.
- Verify unrelated consumer paths named in the acceptance plan.
- Confirm the final audit event is durably present.

`closed` means the Console rotation workflow passed. It does not mean PALURU/PWA production acceptance unless the separate real-browser/device acceptance has also passed.

## 4. Per-binding states

Each rotation maintains one of:

```text
pending
staging
staged
activating
active_new
verification_passed
verification_failed
previous_disabling
previous_disabled
rollback_pending
rolling_back
rolled_back
failed
unknown
```

Global state is derived from required bindings and cannot be manually set. Optional bindings never convert a required failure into success.

## 5. Partial-failure rules

| Failure point | Required behavior |
| --- | --- |
| Before any stage | stop; no backend change |
| Some stages created, none activated | mark `staging_failed`; retain/disable stages per adapter policy; no old change |
| Some bindings activated | mark `distribution_partial`; roll back activated bindings in reverse dependency order |
| Pre-revoke probe fails | keep old valid; roll back new activation or enter manual recovery |
| Approval expires | return to `revoke_approval_pending`; rerun probes before a new approval |
| Some old bindings disabled | stop further disables; try provider-specific re-enable before traffic rollback |
| Post-disable regression fails | re-enable old if supported, reactivate prior binding, rerun probes; otherwise manual recovery |
| Audit persistence fails | stop immediately; outcome is failed/unknown, never healthy |
| Adapter timeout with unknown outcome | do not repeat with a new key; reconcile by redacted operation ID |

## 6. Rollback algorithm

1. Freeze the rotation and prevent concurrent mutation for the same credential/environment.
2. Persist `rollback_started` with a safe reason code.
3. If old material was disabled and the provider supports re-enable, re-enable it first.
4. Roll back activated bindings in reverse rollout/dependency order using adapter-owned revision/slot references.
5. Leave bindings that never changed untouched.
6. Run the previous-version connectivity probe set.
7. Persist per-binding redacted results and final `rolled_back` or `manual_recovery_required`.
8. Do not delete the failed new stage automatically; cleanup is a separate reviewed action.

The algorithm never asks the Human or adapter to reveal an old value. If the backend has no reversible old reference and the external provider has revoked the old value, rollback is impossible and the workflow must have blocked that transition earlier.

## 7. Idempotency and concurrency

- One active rotation per `credentialId + environment`.
- Every mutation carries an `Idempotency-Key` scoped to actor, rotation, action, and expected state.
- Reuse with a different action/body classification is `IDEMPOTENCY_CONFLICT`.
- Registry and workflow mutations require `If-Match` revisions.
- Adapter operations use a stable operation ID; retries do not create a new backend version/slot when the first result is known.
- A lock timeout or stale revision fails closed.
- The secret value is never part of an idempotency key or comparison hash.

## 8. `kaz_os_read` PoC mapping

The first production PoC, only after Phase 3 Design Review, maps the generic workflow as follows:

| PoC step | State/evidence |
| --- | --- |
| 1. Preflight | `draft`: registry/binding/probe and rollback capabilities verified |
| 2. Current binding state | configured/missing metadata only; no value read |
| 3. Human input | `input_pending -> staging` in Secret Console only |
| 4. Staging | new GAS slot and new gateway version/slot staged |
| 5. Consumer reflection | `distributing -> distributed`; reversible activation |
| 6. Connectivity smoke | authenticated staged/new path pass |
| 7. Progress smoke | required probe pass |
| 8. Projects smoke | required probe pass |
| 9. Inbox smoke | required probe pass |
| 10. Regression | unrelated scoped paths pass; no secret leakage |
| 11. Human revoke approval | `revoke_approval_pending` explicit approval |
| 12. Old disable | reversible disable, not destruction |
| 13. Rollback confirmation | post-disable regression plus documented re-enable path |

The PoC cannot start while either binding is single-slot-only or while no safe staged-credential probe exists.

## 9. External provider credentials

External providers may issue and revoke credentials outside the Console. For those credentials:

- the Human creates the new provider credential through the provider's trusted UI;
- only the new value is entered into Secret Console;
- Console does not scrape or automate the provider secret page;
- provider revoke is a separate explicitly named action;
- billing/exposure risk determines priority, not a generic schedule alone; and
- irreversible revocation cannot occur before successful distribution, smoke, approval, and a documented emergency path.
