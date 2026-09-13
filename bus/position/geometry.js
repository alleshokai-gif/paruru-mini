const R = 6371008.8, rad = Math.PI / 180;
export const validPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
export function distanceMeters(a, b) {
  if (!validPoint(a) || !validPoint(b)) return Infinity;
  const x = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,x)));
}
export function projectToSegment(a, b, point) {
  if (!validPoint(a) || !validPoint(b) || !validPoint(point)) return null;
  const origin=a, scale=Math.cos(origin.lat*rad), xy=p=>({
    x:(p.lon-origin.lon)*rad*R*scale,
    y:(p.lat-origin.lat)*rad*R
  });
  const av=xy(a),bv=xy(b),pv=xy(point),dx=bv.x-av.x,dy=bv.y-av.y,length=Math.hypot(dx,dy);
  if (length<=0.01) return null;
  const fraction=Math.max(0,Math.min(1,((pv.x-av.x)*dx+(pv.y-av.y)*dy)/(length*length)));
  return {fraction,distance:Math.hypot(pv.x-av.x-fraction*dx,pv.y-av.y-fraction*dy),length};
}
export function prepareShape(points) {
  if (!Array.isArray(points) || points.length < 2 || points.some(p=>!validPoint(p))) throw Error('POSITION_SHAPE_INVALID');
  const origin = points[0], scale = Math.cos(origin.lat*rad);
  const xy = p => ({ x:(p.lon-origin.lon)*rad*R*scale, y:(p.lat-origin.lat)*rad*R });
  const vectors = points.map(xy), cumulative = [0], segments = [];
  for (let i=1;i<points.length;i++) {
    const a=vectors[i-1], b=vectors[i], length=Math.hypot(b.x-a.x,b.y-a.y);
    // Local metric approximation is bounded to city-scale paths, not polar/dateline geometry.
    if (Math.abs(points[i].lon-origin.lon)>1 || Math.abs(points[i].lat-origin.lat)>1) throw Error('POSITION_SHAPE_EXTENT');
    if (length>0.01) segments.push({a,b,length,start:cumulative[i-1],index:i-1});
    cumulative.push(cumulative[i-1]+length);
  }
  const total=cumulative.at(-1);
  if (!segments.length || total<=0) throw Error('POSITION_SHAPE_EMPTY');
  return { points, segments, cumulative, total, xy };
}
export function snapCandidates(shape, point, maxDistance, slack=10) {
  if (!shape || !validPoint(point)) return [];
  const p=shape.xy(point), candidates=[];
  for (const s of shape.segments) {
    const dx=s.b.x-s.a.x, dy=s.b.y-s.a.y;
    const fraction=Math.max(0,Math.min(1,((p.x-s.a.x)*dx+(p.y-s.a.y)*dy)/(s.length*s.length)));
    const distance=Math.hypot(p.x-s.a.x-fraction*dx,p.y-s.a.y-fraction*dy);
    if (distance<=maxDistance) candidates.push({distance,along:s.start+fraction*s.length,segment:s.index});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  if (!candidates.length) return [];
  const cutoff=candidates[0].distance+slack, result=[];
  for (const c of candidates) if (c.distance<=cutoff+1e-6 && !result.some(v=>Math.abs(v.along-c.along)<1)) result.push(c);
  return result;
}
export function distanceToAlong(shape, value) {
  const values=shape.points.map(p=>p.shapeDistTraveled);
  if (!Number.isFinite(value) || values.some(v=>!Number.isFinite(v)) || values.some((v,i)=>i&&v<=values[i-1])) return null;
  if (value<values[0] || value>values.at(-1)) return null;
  for(let i=1;i<values.length;i++) if(value<=values[i])
    return shape.cumulative[i-1]+(shape.cumulative[i]-shape.cumulative[i-1])*(value-values[i-1])/(values[i]-values[i-1]);
  return null;
}
