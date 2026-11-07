import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
const privateV4 = ip => isIPv4(ip) && (ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
export function networkConfig(env = process.env, interfaces = networkInterfaces()) {
  const port = Number(env.ODAKYU_POC_PORT || 8767), host = env.ODAKYU_POC_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT_INVALID');
  const client = env.ODAKYU_POC_CLIENT;
  if (host !== '127.0.0.1' && (!privateV4(host) || !privateV4(client) || !Object.values(interfaces).flat().some(i => i?.address === host))) throw Error('PRIVATE_PHONE_ADDRESS_REQUIRED');
  const hosts = new Set([`${host}:${port}`, ...(host === '127.0.0.1' ? [`localhost:${port}`] : [])]);
  const clients = new Set(host === '127.0.0.1' ? ['127.0.0.1'] : [host, client]);
  return { host, port, permits: (authority, address) => hosts.has(authority) && clients.has(address) };
}
