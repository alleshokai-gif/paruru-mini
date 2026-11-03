// Report whether requiring the PALURU CI check would strand current main PRs.
const api = 'https://api.github.com/repos/alleshokai-gif/paruru-mini';
const checkName = 'PALURU bus UI tests';
const headers = { Accept: 'application/vnd.github+json' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
async function read(path) {
  const response = await fetch(api + path, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  return response.json();
}
async function readCheck(sha) {
  const result = await read(`/commits/${sha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=latest`);
  const checks = result.check_runs.filter((check) => check.name === checkName && check.app?.id === 15368);
  if (checks.length !== 1) return checks.length === 0 ? 'missing' : 'ambiguous';
  return checks[0].conclusion ?? 'pending';
}
try {
  const pulls = await read('/pulls?state=open&base=main&per_page=100');
  if (pulls.length === 100) throw new Error('PR listing exceeds the rollout check limit');
  let ready = true;
  for (const open of pulls) {
    const pr = await read(`/pulls/${open.number}`);
    if (pr.state !== 'open' || pr.base.ref !== 'main') throw new Error('PR changed during review');
    const mergeCheck = pr.mergeable === true && pr.merge_commit_sha
      ? await readCheck(pr.merge_commit_sha) : 'missing';
    const status = mergeCheck === 'missing' ? await readCheck(pr.head.sha) : mergeCheck;
    console.log(JSON.stringify({ pr: pr.number, draft: pr.draft, status }));
    ready &&= status === 'success' && pr.mergeable === true;
  }
  console.log(ready ? 'CI_COVERAGE_READY' : 'CI_COVERAGE_INCOMPLETE');
  process.exitCode = ready ? 0 : 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
