# Dynamic Daily Planning Action Loop

## Scope

Connect the existing read-only Dynamic Daily Planning v2 and TODAY progress controls into a bounded local loop: NOW → plan → owner progress → deterministic next candidate. Calendar slots and Work order continue to come from the existing source APIs. No Calendar write, automatic deadline change, automatic Work completion, provider call, or new scheduler is introduced.

## Progress contract

- `done` and `carry_forward` continue through the existing owner-confirmed Work update path and require its durable receipt.
- `on_track`, `delayed`, and `blocked` are durable GCS observations only. They do not mutate Notion Work status. Optional notes retain the owner's stated reason.
- After a saved action, TODAY rereads the existing dashboard and v2 plan endpoints. A local deterministic next candidate is labeled separately from any AI judgment; stale evidence is revalidated against the refreshed Work snapshot.
- The v2 plan's confirmed Calendar free windows are the primary source for NOW availability. An expired or partial v2 Calendar result is shown as unconfirmed rather than mixed with another snapshot.
- A minute tick only reevaluates the already loaded plan against the current JST clock; returning to a visible TODAY route reloads normal sources.

## Side effects and rollback

Only explicit owner button presses can write. GCS pace observations use the existing immutable progress channel; canonical Work updates remain behind the existing authenticated receipt path. No new GCS namespace or IAM grant is added. Roll back by reverting the Mini and Context commits; previously stored `blocked` observations are valid v1 progress events and remain readable by the updated AI input validator.

## Acceptance

Focused tests cover the four progress choices, source reread after an action, Calendar-window agreement, no automatic Work mutation for pace states, and the existing AI input path receiving a blocked observation. Production acceptance separately requires a real owner-selected Work action and readback; tests do not simulate that owner decision.
