'use strict';

const assert = require('node:assert/strict');
const { COMPONENTS, evaluateComponentBuildIdGuard } = require('../scripts/check-component-build-ids.js');

function evaluate(component, changedFiles, buildDiff) {
  return evaluateComponentBuildIdGuard(component, changedFiles, buildDiff || '');
}

const mini = COMPONENTS[0];
const agent = COMPONENTS[1];
const os = COMPONENTS[2];

assert.equal(evaluate(mini, ['docs/architecture.md', 'test/agent-gateway.test.js']).pass, true, 'Mini docs/tests must not require a BUILD_ID change');
assert.equal(evaluate(agent, ['gas/ToolRegistry.js'], '').pass, false, 'Agent runtime change without BUILD_ID must fail');
assert.equal(evaluate(os, ['gas/ClimateAdapterV2.js'], '').pass, false, 'OS runtime change without BUILD_ID must fail');
assert.equal(evaluate(mini, ['gas/AgentGateway.js'], [
  "-const PALURU_MINI_BUILD_ID = 'mini-old'",
  "+const PALURU_MINI_BUILD_ID = 'mini-new'"
].join('\n')).pass, true, 'Mini runtime change with a new BUILD_ID must pass');
assert.equal(evaluate(agent, ['gas/PaluruOsClient.js', 'gas/AgentConfig.js'], [
  "-  BUILD_ID: 'agent-old',",
  "+  BUILD_ID: 'agent-new',"
].join('\n')).pass, true, 'Agent runtime change with a new BUILD_ID must pass');
assert.equal(evaluate(os, ['gas/PaluruOsConfig.js'], [
  "-  BUILD_ID: 'os-old',",
  "+  BUILD_ID: 'os-new',"
].join('\n')).pass, true, 'OS BUILD_ID-only update must pass');

console.log('PASS component BUILD_ID guard pass/fail cases');
