import {writeFile,rename}from'node:fs/promises';import{latest,DATA_DIR}from'./storage.mjs';import{normalize,hypotheses,compare,minutes}from'./core.mjs';
const[t,r,s]=await Promise.all(['StationTimetable','Railway','Station'].map(latest));const model=normalize(t.rows,r.rows,s.rows,t.fetchedAt);
await writeFile(new URL('model.json.tmp',DATA_DIR),JSON.stringify(model));await rename(new URL('model.json.tmp',DATA_DIR),new URL('model.json',DATA_DIR));
const trains=hypotheses(model,'Weekday'),selected=trains.find(t=>t.origin==='Shinjuku'&&t.type==='Local'&&t.stops[0].time===minutes('08:09'));
const results={};for(const destination of['Noborito','MukogaokaYuen'])results[destination]=compare(trains,selected.id,destination,minutes('08:15'));
const summary={departures:model.departures.length,stations:model.stations.length,hypotheses:trains.length,reachesNoborito:trains.filter(t=>t.stops.some(s=>s.station==='Noborito')).length,results};
await writeFile(new URL('analysis.json',DATA_DIR),JSON.stringify(summary,null,2));console.log(JSON.stringify({departures:summary.departures,stations:summary.stations,hypotheses:summary.hypotheses,comparisons:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{saving:v.best?.saving,transfers:v.best?.legs.length,departure:v.best?.destinationDeparture}]))}));
