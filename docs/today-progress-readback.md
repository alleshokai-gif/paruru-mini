# TODAY progress reload recovery

Problem: persisted pace observations were lost from the action brief's transient
Map on reload, so an older AI recommendation could remain actionable.

Reuse the existing authenticated, read-only progress status API. Confirm the
saved JST timestamp; restore visible candidate states before recommendations.
Unknown status is visibly withheld, never treated as absent or automatically
resubmitted. Same-action buttons show the saved result. The original AI decision
remains available as historical evidence; it is not rewritten as a new decision.

Scope: TODAY presentation and the additive status timestamp check only. No
Provider calls, auth expansion, canonical mutation or new persistence layer.
Bounded readers share work across render epochs. User saves take precedence.

Acceptance: existing owner's real delayed observation, reload and navigation
back to TODAY, no additional submit, old target absent from actionable NOW/NEXT,
saved-state message present. Rollback: previous Pages release. Maintain the
network-first Service Worker lifecycle and verify the deployed Build ID.
