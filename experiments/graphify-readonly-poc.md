# Graphify read-only PoC for PALURU Mini (2026-11-01)

## Scope
- Experiment only in `alleshokai-gif/paruru-mini`.
- Do not change application code, AGENTS.md, deployment, secrets, service settings, CI, or production.
- Avoid global assistant configuration. Keep Graphify output local and out of Git.
- No Graphify Cloud, API credentials, or external document/media enrichment.
- Honor existing AGENTS.md and existing coding-assistant rules.

## Codex execution plan
1. Work in a clean, disposable worktree based on the latest main. Do not disturb unrelated user changes.
2. Confirm the official upstream package and dependency provenance: https://github.com/Graphify-Labs/graphify . Package name is **graphifyy** (double y), CLI is `graphify`.
3. Install in a disposable isolated environment (e.g. `uv tool install graphifyy`) and record the resolved version. Do not add it to app dependencies or CI.
4. Explore official help and local Codex skill instructions. Run `graphify install --platform codex --project` only within the disposable worktree, taking care not to overwrite existing instructions. Codex skill invocation is `$graphify`; build a graph of the repository using official supported instructions.
5. Confirm `graphify-out/graph.html`, `GRAPH_REPORT.md`, and `graph.json` actually exist, with node/edge counts. Do not upload generated graph to public GitHub, because embedded code references or filenames can reveal sensitive implementation details.
6. Compare two realistic read-only questions: (a) where the PALURU family schedule enters the home UI; (b) which files participate in the school schedule ingestion path. Record evidence paths with and without the graph, measured elapsed time, and any observable token use. Label unsupported static/dynamic boundaries unknown rather than guessing.
7. Roll back the disposable installation, inspect `git status` and confirm app code untouched. Summarize the result and whether further trial is worthwhile.

## Acceptance
- Generated graph verified locally with counts and artifact paths.
- At least two evidence-based code-navigation comparisons.
- No changes to production, AGENTS.md, application code, or persistent dependencies.
- Clear separation of observed results and vendor claims.
- If execution is unavailable, report blocked; do not call the PoC complete.
