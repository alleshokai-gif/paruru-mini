import test from 'node:test';
import assert from 'node:assert/strict';
import { networkConfig } from './network.mjs';
test('phone transport remains private, exact-host and exact-client; loopback default preserved', () => {
  const local = networkConfig({}); assert.ok(local.permits('localhost:8767', '127.0.0.1')); assert.ok(!local.permits('evil:8767', '127.0.0.1'));
  const env = { ODAKYU_POC_HOST:'192.168.1.2', ODAKYU_POC_CLIENT:'192.168.1.3' }, interfaces = { wifi:[{address:'192.168.1.2'}] };
  const lan = networkConfig(env, interfaces); assert.ok(lan.permits('192.168.1.2:8767','192.168.1.3'));
  assert.ok(!lan.permits('192.168.1.2:8767','192.168.1.4')); assert.ok(!lan.permits('evil:8767','192.168.1.3'));
  for (const host of ['0.0.0.0','8.8.8.8','192.168.1.9']) assert.throws(() => networkConfig({...env,ODAKYU_POC_HOST:host},interfaces));
  assert.throws(() => networkConfig({...env,ODAKYU_POC_CLIENT:'8.8.8.8'},interfaces));
  assert.throws(() => networkConfig({ODAKYU_POC_PORT:'NaN'}));
});
