// Provider evidence from official GTFS stop/platform IDs. This groups one physical terminal only;
// it does not infer vehicle working or a future trip assignment.
export const TERMINAL_AREAS=Object.freeze({
  noborito:Object.freeze(['362_1']),
  mizonokuchi_south:Object.freeze(['434_2','434_3','434_4','434_5'])
});
export function resolveTerminalArea(stopId) {
  for(const [id,stops] of Object.entries(TERMINAL_AREAS))if(stops.includes(stopId))return id;
  return null;
}
