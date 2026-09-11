// The sole production composition root. Generated data is a server-side import, never a public asset.
import index from '../generated/p0-static.json' with { type: 'json' };
import { createWorker } from './index.js';
import { createBusService } from './service.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { prepareStatic } from '../core/arrivals.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
prepareStatic(index, P0_QUERIES, KAWASAKI_CONTEXT);
let service;
export default createWorker((env) => {
  service ??= createBusService({ index, adapter: createKawasakiAdapter({ token: env.ODPT_ACCESS_TOKEN }),
    queries: P0_QUERIES, providerContext: KAWASAKI_CONTEXT,
    cache: typeof caches !== 'undefined' ? caches.default : null, version: index.sourceHash });
  return service;
});
