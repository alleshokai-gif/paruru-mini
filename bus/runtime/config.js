export const PRODUCTION_ORIGIN = 'https://alleshokai-gif.github.io';
export function runtimeConfig(env) {
  const development = env.NODE_ENV === 'development';
  if (env.NODE_ENV && !['development', 'production', 'test'].includes(env.NODE_ENV)) throw Error('BUS_ENV_INVALID');
  const origins = (env.ALLOWED_ORIGINS || (development ? 'http://127.0.0.1:8788,http://localhost:8788' : PRODUCTION_ORIGIN)).split(',');
  if (!origins.length || origins.some((s) => {
    try { const u = new URL(s); return u.origin !== s || (development
      ? !['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol !== 'http:'
      : s !== PRODUCTION_ORIGIN); } catch { return true; }
  })) throw Error('BUS_CORS_INVALID');
  const token = env.ODPT_ACCESS_TOKEN;
  if (!token || /\s/.test(token)) throw Error('BUS_SECRET_MISSING');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('BUS_PORT_INVALID');
  return { port, host: development ? '127.0.0.1' : '0.0.0.0', env: { ALLOWED_ORIGINS: origins.join(','), ODPT_ACCESS_TOKEN: token } };
}
