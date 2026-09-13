import test from 'node:test';
import assert from 'node:assert/strict';
import { stitchOsmRoute,validateRoadGeometry } from '../position/road-geometry.js';

const latitude=35,longitude=139,m=1/(6371008.8*Math.PI/180),scale=Math.cos(latitude*Math.PI/180);
const point=(x,y=0)=>({lat:latitude+y*m,lon:longitude+x*m/scale});
function osm() {
  const points=[point(0),point(100),point(200),point(300)];
  return {elements:[...points.map((value,index)=>({type:'node',id:index+1,...value})),
    {type:'way',id:10,nodes:[1,2]},{type:'way',id:11,nodes:[3,2]},{type:'way',id:12,nodes:[3,4]},
    {type:'relation',id:99,version:2,timestamp:'2026-09-12T00:00:00Z',tags:{type:'route',route:'bus',ref:'X',name:'X'},
      members:[{type:'way',ref:10},{type:'way',ref:11},{type:'way',ref:12}]}]};
}
const chain={stops:[0,1,2,3].map(index=>({stopId:`s${index}`,sequence:index+1}))};
const stops=Object.fromEntries(chain.stops.map((value,index)=>[value.stopId,{position:point(index*100)}]));
const policy={minServiceDays:1,minTrips:1,minTripsPerSegment:1,minOfficialPairs:1,minOfficialAgreement:0.95};
const samples=(ys=[0,0,0,0])=>[50,150,250].map((x,index)=>({tripKey:'20260912:t',serviceDay:'20260912',timestamp:100+index*30,
  receivedAt:120+index*30,...point(x,ys[index]||0)}));

test('OSM relation way members are oriented and stitched in route order',()=>{
  const result=stitchOsmRoute(osm(),99);
  assert.equal(result.gaps,0);assert.equal(result.wayCount,3);assert.equal(result.points.length,4);
  assert.ok(result.points[0].lon<result.points.at(-1).lon);assert.deepEqual(result.orientations,['forward','reverse','forward']);
});

test('road geometry requires stop order, official road corroboration, GPS direction and all segments',()=>{
  const points=stitchOsmRoute(osm(),99).points;
  const result=validateRoadGeometry({points,chain,stops,gpsSamples:samples(),corroboratingLines:[points],
    officialVerification:{pairs:20,correct:20},policy});
  assert.equal(result.eligible,true);assert.equal(result.evidence.stops.projected,4);
  assert.equal(result.evidence.gps.monotonicRate,1);assert.equal(result.evidence.gps.segments.length,3);
  assert.ok(result.evidence.gps.segments.every(value=>value.independentTrips===1));
});

test('wrong parallel road and reverse observations are rejected without a position assertion',()=>{
  const points=stitchOsmRoute(osm(),99).points,wrong=points.map(value=>point((value.lon-longitude)*scale/m,100));
  const off=validateRoadGeometry({points:wrong,chain,stops,gpsSamples:samples(),corroboratingLines:[points],
    officialVerification:{pairs:20,correct:20},policy});
  assert.equal(off.eligible,false);assert.ok(off.reasons.includes('stop_projection_failed'));
  const reverse=samples().reverse().map((value,index)=>({...value,timestamp:100+index*30,receivedAt:120+index*30}));
  const direction=validateRoadGeometry({points,chain,stops,gpsSamples:reverse,corroboratingLines:[points],
    officialVerification:{pairs:20,correct:20},policy});
  assert.equal(direction.eligible,false);assert.ok(direction.reasons.includes('direction_validation_failed'));
});

test('insufficient multi-day and official evidence keeps an otherwise valid road candidate gated',()=>{
  const points=stitchOsmRoute(osm(),99).points;
  const result=validateRoadGeometry({points,chain,stops,gpsSamples:samples(),corroboratingLines:[points]});
  assert.equal(result.eligible,false);assert.ok(result.reasons.includes('service_days_insufficient'));
  assert.ok(result.reasons.includes('official_reference_insufficient'));
});
