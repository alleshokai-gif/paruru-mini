'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const COMPONENTS = Object.freeze([
  {
    name: 'Mini GAS',
    root: path.resolve(__dirname, '..'),
    runtimePath: (file) => /^gas\/.+\.js$/.test(file),
    buildFile: 'gas/AgentGateway.js',
    buildIdPattern: /^[-+]\s*const PALURU_MINI_BUILD_ID = '([^']+)'/gm
  },
  {
    name: 'PALURU Agent',
    root: path.resolve(__dirname, '..', '..', 'paluru-agent'),
    runtimePath: (file) => /^gas\/.+\.js$/.test(file),
    buildFile: 'gas/AgentConfig.js',
    buildIdPattern: /^[-+]\s*BUILD_ID:\s*'([^']+)'/gm
  },
  {
    name: 'PALURU_OS',
    root: path.resolve(__dirname, '..', '..', 'paluru-os'),
    runtimePath: (file) => /^gas\/.+\.js$/.test(file),
    buildFile: 'gas/PaluruOsConfig.js',
    buildIdPattern: /^[-+]\s*BUILD_ID:\s*'([^']+)'/gm
  }
]);

function buildIdChanged(diff, pattern) {
  const previous = [];
  const next = [];
  const expression = new RegExp(pattern.source, pattern.flags);
  let match;
  while ((match = expression.exec(String(diff || '')))) {
    if (match[0].charAt(0) === '-') previous.push(match[1]);
    if (match[0].charAt(0) === '+') next.push(match[1]);
  }
  return previous.some((value) => next.some((candidate) => candidate !== value));
}

function evaluateComponentBuildIdGuard(component, changedFiles, buildDiff) {
  const changed = Array.isArray(changedFiles) ? changedFiles : [];
  const runtimeChanges = changed.filter((file) => component.runtimePath(String(file || '')));
  if (!runtimeChanges.length) return { component: component.name, pass: true, runtimeChanges: [] };
  return {
    component: component.name,
    pass: buildIdChanged(buildDiff, component.buildIdPattern),
    runtimeChanges: runtimeChanges
  };
}

function gitLines(root, args) {
  return execFileSync('git', ['-C', root].concat(args), { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

function inspectComponent(component) {
  const changedFiles = Array.from(new Set(
    gitLines(component.root, ['diff', '--name-only', 'HEAD'])
      .concat(gitLines(component.root, ['ls-files', '--others', '--exclude-standard']))
  ));
  const buildDiff = execFileSync('git', ['-C', component.root, 'diff', '--unified=0', 'HEAD', '--', component.buildFile], { encoding: 'utf8' });
  return evaluateComponentBuildIdGuard(component, changedFiles, buildDiff);
}

function main() {
  let results;
  try {
    results = COMPONENTS.map(inspectComponent);
  } catch (error) {
    console.error('BUILD_ID guard could not read a component Git worktree.');
    process.exitCode = 2;
    return;
  }
  const failures = results.filter((result) => !result.pass);
  if (!failures.length) {
    console.log('PASS component BUILD_ID guard');
    return;
  }
  failures.forEach((result) => {
    console.error(`${result.component}: BUILD_ID must change when runtime source changes:`);
    result.runtimeChanges.forEach((file) => console.error(`- ${file}`));
  });
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { COMPONENTS, buildIdChanged, evaluateComponentBuildIdGuard };
