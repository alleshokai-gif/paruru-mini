'use strict';

const { execFileSync } = require('child_process');

const PWA_PATHS = /^(app\.js|index\.html|style\.css|sw\.js|manifest\.json|features\/|assets\/character\/)/;

function changedFiles(commandArgs) {
  try {
    return execFileSync('git', commandArgs, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    console.error('BUILD_ID check could not read the Git worktree.');
    process.exitCode = 2;
    return [];
  }
}

const changed = new Set([
  ...changedFiles(['diff', '--name-only', 'HEAD']),
  ...changedFiles(['ls-files', '--others', '--exclude-standard']),
]);
const changedPwaFiles = [...changed].filter((file) => PWA_PATHS.test(file));

if (process.exitCode) process.exit(process.exitCode);
if (!changedPwaFiles.length || changed.has('build.js')) {
  console.log('PASS BUILD_ID change check');
  process.exit(0);
}

console.error('BUILD_ID must be updated in build.js when PWA runtime files change:');
changedPwaFiles.forEach((file) => console.error(`- ${file}`));
process.exit(1);
