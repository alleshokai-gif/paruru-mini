// The sole production composition root. Generated data is a server-side import, never a public asset.
import index from '../generated/p0-static.json' with { type: 'json' };
import { createWorker } from './index.js';
import { createBusService } from './service.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { prepareStatic } from '../core/arrivals.js';
prepareStatic(index);
let service;
export default createWorker((env) => {
  service ??= createBusService({ index, adapter: createKawasakiAdapter({ token: env.ODPT_ACCESS_TOKEN }),
    cache: typeof caches !== 'undefined' ? caches.default : null, version: index.sourceHash });
  return service;
});
