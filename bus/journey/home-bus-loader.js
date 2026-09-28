// Route Decision asks every source independently; a missing Provider cannot erase other buses.
export function createHomeBusLoader(sourceLoaders) {
  if (!sourceLoaders || typeof sourceLoaders !== 'object' || Array.isArray(sourceLoaders))
    throw Error('HOME_BUS_SOURCES_INVALID');
  return async function loadBuses({ sourceIds, boardingAt } = {}) {
    if (!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size !== sourceIds.length
      || !Number.isFinite(boardingAt)) throw Error('HOME_BUS_QUERY_INVALID');
    const results = await Promise.allSettled(sourceIds.map(async (id) => {
      const loader = sourceLoaders[id];
      if (typeof loader !== 'function') throw Error('HOME_BUS_SOURCE_UNAVAILABLE');
      return loader({ boardingAt, sourceId: id });
    }));
    const arrivals = [], sourceStates = {};
    for (let index = 0; index < sourceIds.length; index++) {
      const id = sourceIds[index], result = results[index];
      const valid = result.status === 'fulfilled' && Array.isArray(result.value)
        && result.value.every((row) => row && `${row.provider}:${row.queryId}` === id);
      sourceStates[id] = valid ? 'available' : 'unavailable';
      if (valid) arrivals.push(...result.value);
    }
    return { arrivals, sourceStates };
  };
}
