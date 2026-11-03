import { execFileSync } from 'node:child_process';

const { GITHUB_REPOSITORY, SOURCE_SHA, RUN_KEY, GH_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
class PublisherError extends Error {}
const requireThat = (condition, code) => {
  if (!condition) throw new PublisherError(code);
};

try {
  requireThat(GITHUB_REPOSITORY === 'alleshokai-gif/paruru-mini', 'INVALID_REPOSITORY');
  requireThat(/^[0-9a-f]{40}$/.test(SOURCE_SHA ?? ''), 'INVALID_SOURCE_SHA');
  requireThat(/^[0-9a-f]{32}$/.test(RUN_KEY ?? ''), 'INVALID_RUN_KEY');
  if (process.argv.includes('--verify-release')) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/rules/branches/main`, {
      signal: AbortSignal.timeout(10_000),
    });
    requireThat(response.ok, 'MAIN_PROTECTION_UNAVAILABLE');
    const rules = await response.json();
    const hasRule = (type, id) => rules.some((rule) => rule.type === type && rule.ruleset_id === id);
    requireThat(Array.isArray(rules) && hasRule('update', 26426417) &&
      hasRule('pull_request', 26426007) && hasRule('required_status_checks', 26426177),
    'MAIN_RELEASE_RULES_INACTIVE');
  }
  const repo = `https://github.com/${GITHUB_REPOSITORY}.git`;
  const main = 'refs/heads/main';
  const source = `refs/heads/staging/autonomous/${RUN_KEY}`;
  const target = `refs/heads/review/autonomous/${RUN_KEY}`;
  const read = (ref) => git('ls-remote', '--refs', repo, ref).split(/\s/)[0];
  const prior = read(target);
  requireThat(!prior || prior === SOURCE_SHA, 'REVIEW_BRANCH_CONFLICT');
  requireThat(read(source) === SOURCE_SHA, 'STAGED_SOURCE_MISMATCH');
  git('fetch', '--no-tags', repo, main, source);
  const parent = git('rev-list', '--parents', '-n', '1', SOURCE_SHA).split(' ');
  requireThat(parent.length === 2, 'SOURCE_MUST_HAVE_ONE_PARENT');
  // A replay can verify its existing receipt even if main has since moved.
  requireThat(prior || parent[1] === read(main), 'SOURCE_BASE_CHANGED');

  const files = git('diff-tree', '--no-commit-id', '--no-renames', '-r', '--name-status',
    parent[1], SOURCE_SHA).split('\n');
  const allowed = new Set(['features/bus/home-route.js', 'test/bus-home-route-ui.test.js']);
  requireThat(files.length > 0 && files.every((entry) => {
    const [status, path] = entry.split('\t');
    return status === 'M' && allowed.has(path) &&
      git('ls-tree', SOURCE_SHA, '--', path).startsWith('100644 blob ');
  }), 'SOURCE_SCOPE_REJECTED');
  git('diff', '--check', parent[1], SOURCE_SHA);

  if (process.argv.includes('--publish') && !prior) {
    requireThat(GH_TOKEN, 'PUBLISH_TOKEN_MISSING');
    const auth = Buffer.from(`x-access-token:${GH_TOKEN}`).toString('base64');
    console.log(`::add-mask::${auth}`);
    // The empty expected value permits creation only. It cannot replace another writer's ref.
    git('-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, 'push',
      `--force-with-lease=${target}:`, repo, `${SOURCE_SHA}:${target}`);
    requireThat(read(target) === SOURCE_SHA, 'REVIEW_BRANCH_READBACK_FAILED');
  }
  if (GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(GITHUB_STEP_SUMMARY, `### Autonomous Work Publisher\n\n${prior ? 'Existing branch verified' : process.argv.includes('--publish') ? 'Branch created and verified' : 'Source verified'}: \`${SOURCE_SHA}\`\n\n`);
  }
  console.log(prior ? 'review_branch_already_present' : process.argv.includes('--publish')
    ? 'review_branch_created' : 'source_verified');
} catch (error) {
  console.error(error instanceof PublisherError ? error.message : 'PUBLISHER_OPERATION_FAILED');
  process.exitCode = 1;
}
