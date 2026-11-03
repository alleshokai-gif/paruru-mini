# Autonomous Work publication release

## CI rollout

1. Confirm the #175 head and its `PALURU bus UI tests` check from GitHub Actions
   (integration 15368). It uses `pull_request` against `main`, with no path
   filter. Keep required-check ruleset 26426177 disabled for the migration.
2. Obtain the owner's Pages release decision. The repo publishes `main:/`
   and merging #175 can build Pages even though the CI workflow does not
   deploy anything. Keep the existing PR-only main protection active.
3. After merge, verify the Pages deployment and the published build. Run
   `node .github/scripts/paluru-ci-readiness.mjs` from this branch. It reports
   the required GitHub Actions check for each open main PR, using the test
   merge commit when it has a check and the PR head otherwise. Keep the rule
   disabled if a check is missing, pending, ambiguous or failed.
   Refresh affected PR events with a normal branch update or a controlled
   reopen after coordinating with the PR owner. Keep existing drafts as drafts.
4. Enable the staged ruleset after confirming current check coverage and
   resolving genuine test failures. Keep strict up-to-date enforcement off.
   Keep #176 in Draft until device verification and owner review.

## Publisher

The independent verifier stages one reviewed commit, based on current main, in
`staging/autonomous/<run_key>`. Use a stable 32-character lowercase hexadecimal
publication key derived from the existing reservation. Pass the exact staged
commit SHA to the workflow on `main`. The workflow validates the immutable
commit and permitted files and creates `review/autonomous/<run_key>` with a
create-only Git lease. A retry with the same SHA reads back the existing branch.
A different SHA for the same key is a conflict. If main moves before initial
publication, return to the verifier. Use only approved PALURU Bus changes
and the corresponding test file for this pilot.

The workflow never runs the proposed commit in a write-token job. GitHub creates
a fresh repository-scoped Contents token per job. There is no merge or deploy
step. The Windows controller uses a separate GitHub App installation scoped
to this repository to stage the verified commit, dispatch this workflow and
open a Draft PR after reading back the review branch. A PR opened by this App
uses the normal pull-request CI event. Keep the existing repository setting
that disallows Actions itself from creating or approving PRs. The controller
requires the Draft PR and the successful CI job for its exact head before
publishing the TODAY owner decision. The Worker gets neither token nor App key.

Contents write can authorize GitHub's merge API. Ruleset 26426417 is staged
disabled for exact `main`, with only the repository owner allowed to bypass
the update restriction and only through PRs. Check the owner/maintainer release
flow before enabling it. Keep the independent PR and CI rulesets in force.
The Publisher requires the active update, PR and CI rules and explicit
`AUTONOMOUS_PUBLISHER_ENABLED=true`. Confirm main updates are denied to the
publisher on a disposable protected branch before setting the variable.

## Night cutover

Keep 23:00 off until the App, protected main, required CI and readback are
verified together. Configure the App installation for PALURU only, with Contents
write (staging), Actions write (dispatch and CI reads), Pull requests write
(Draft creation), and Variables read (release switch). Give it no ruleset
bypass or administration permission. Store the PEM in the trusted Windows
controller's private directory, outside Worker input and run directories.

Set the controller's local `paluru_publisher` configuration with `app_id`,
`installation_id`, `private_key_path`, and `openssl_path` (the existing Git
for Windows OpenSSL binary is suitable). Keep the PEM itself out of config,
GCS, GitHub and logs. Test staging, exact Draft/head/CI readback and the morning
TODAY projection using a previously verified result. Preserve WI-23 and all
unknown reservations. The initial scheduled implementation recipe is limited
to the verified comparative bus card change. If no eligible unused recipe
matches, the Controller skips the model. Before enabling nightly operation,
register another eligible Work recipe with a bounded validator.
