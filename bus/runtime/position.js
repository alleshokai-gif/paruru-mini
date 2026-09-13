import { readFileSync } from 'node:fs';
import { createRouteIndex } from '../position/route-index.js';
import { createPositionObserver } from '../position/observer.js';
export function loadPosition({index,provider,geometrySources=[],read=()=>readFileSync(new URL('../generated/p1-position-static.json',import.meta.url),'utf8')}) {
  try {
    const text=read();if(Buffer.byteLength(text)>16*1024*1024)throw Error();
    const source=JSON.parse(text),routeIndex=createRouteIndex(source,index,provider,undefined,geometrySources);
    const observer=createPositionObserver({routeIndex,index});
    return {observer,staticData:source,status:routeIndex.stats.supportedChains?'research_only':'geometry_unavailable',stats:routeIndex.stats};
  }catch {return {observer:null,staticData:null,status:'index_unavailable',stats:null};}
}
