import {TRACK_PATHS,TRACK_PLATFORMS,TRACK_BUFFERS,TRACK_STATIONS,boardPoint,boardPolyline} from './track-board.mjs';
function svg(tag,attributes,parent) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  parent?.append(node);return node;
}
const pathD=points=>boardPolyline(points).map((p,i)=>`${i?'L':'M'} ${p.map(v=>v.toFixed(2)).join(' ')}`).join(' ');
// Infrastructure only. The existing train/navigation modules remain unchanged
// and will be reconnected to verified track identities in a subsequent step.
export function renderTrackBoard(root) {
  const drawing=svg('svg',{class:'w-board',viewBox:'0 0 351 2460',role:'img',
    'aria-label':'添付配線図を縦向きに再構成した新宿から向ヶ丘遊園の線路と主要駅'});
  for(const p of TRACK_PLATFORMS) {
    const a=boardPoint([p.from,p.v1]),b=boardPoint([p.to,p.v2]);
    svg('rect',{x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1],class:'w-platform','data-platform':p.id},drawing);
  }
  for(const p of TRACK_PATHS.filter(p=>p.kind!=='grade'))
    svg('path',{d:pathD(p.points),class:`w-rail w-${p.kind}`,'data-track':p.id},drawing);
  // A dark bridge halo cuts the underlying rails visually; no false junction
  // is introduced where the canonical image shows a grade separated crossing.
  for(const p of TRACK_PATHS.filter(p=>p.kind==='grade')) {
    svg('path',{d:pathD(p.points),class:'w-bridge-gap','aria-hidden':'true'},drawing);
    svg('path',{d:pathD(p.points),class:'w-rail w-grade','data-track':p.id},drawing);
  }
  for(const point of TRACK_BUFFERS) {
    const [x,y]=boardPoint(point);
    svg('path',{d:`M ${x-4} ${y} H ${x+4}`,class:'w-buffer'},drawing);
  }
  for(const s of TRACK_STATIONS) {
    const [,y]=boardPoint([s.at,93]);
    const label=svg('text',{x:5,y:y+5,class:'w-station','data-station':s.id},drawing);
    label.textContent=s.name;
  }
  const metro=svg('text',{x:8,y:boardPoint([452,72])[1],class:'w-metro-label'},drawing);metro.textContent='千代田線';
  const depot=svg('text',{x:8,y:boardPoint([1669,135])[1]+10,class:'w-depot-label'},drawing);depot.textContent='喜多見検車区';
  root.replaceChildren(drawing);
}
