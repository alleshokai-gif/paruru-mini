import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACK_PATHS,TRACK_BUFFERS,boardPoint,boardPolyline,sectionTracksAt} from './track-board.mjs';
const path=id=>TRACK_PATHS.find(p=>p.id===id);
const onSegment=(p,a,b)=>Math.abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))<1e-7
  &&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
const onPath=(p,points)=>points.some((b,i)=>i>0&&onSegment(p,points[i-1],b));

test('添付の線路本数: 新宿5→2、上原4/折返し2、経堂5、成城4、登戸4→3、遊園4→2',()=>{
  const expected=[[40,5],[200,2],[540,4],[610,6],[1000,4],[1240,5],[1540,4],[1990,4],[2040,3],[2090,4],[2220,2]];
  for(const [u,count] of expected)assert.equal(sectionTracksAt(u).length,count,`source longitudinal ${u}`);
  assert.deepEqual(sectionTracksAt(1339),sectionTracksAt(1341),'添付の折返し位置で4線をつなぎ替えない');
});
test('経堂の留置3線は並列の別ルートでなく共通の斜線へ接続し、全て終端付き',()=>{
  const trunk=path('kyodo-siding-3').points;
  for(const id of ['kyodo-siding-1','kyodo-siding-2'])assert.ok(onPath(path(id).points.at(-1),trunk));
  for(const v of [130,134,138])assert.ok(TRACK_BUFFERS.some(p=>p[0]===1174&&p[1]===v));
  assert.ok(onPath(path('kyodo-siding-entry').points.at(-1),path('kyodo-siding-spine').points));
});
test('成城の渡り線と検車区接続、登戸の合流、遊園の交差はそれぞれ元の線路に接続する',()=>{
  const pairs=[['seijo-cross-inner','seijo-inner-lower','seijo-inner-upper'],
    ['seijo-cross-upper','seijo-inner-upper','seijo-outer-upper'],
    ['seijo-depot-upper-return','seijo-outer-upper','seijo-depot-upper-entry'],
    ['seijo-lower-scissor-a','seijo-inner-lower','seijo-outer-lower'],
    ['seijo-lower-scissor-b','seijo-outer-lower','seijo-inner-lower'],
    ['seijo-depot-lower-return','seijo-outer-lower','seijo-depot-lower-entry'],
    ['yuen-lower-reverse','seijo-inner-lower','yuen-lower-exit']];
  for(const [id,from,to] of pairs){const p=path(id).points;assert.ok(onPath(p[0],path(from).points),id+' start');assert.ok(onPath(p.at(-1),path(to).points),id+' end');}
  assert.ok(onPath(path('seijo-outer-upper').points.at(-1),path('seijo-inner-upper').points));
  assert.ok(onPath(path('seijo-depot-upper-grade').points[0],path('seijo-depot-upper-entry').points));
  assert.equal(path('seijo-depot-upper-grade').kind,'grade','検車区への横断を通常の渡り線として描かない');
});
test('圧縮後も全接続点が親線路上に残り、立体交差は別経路のまま',()=>{
  for(const p of TRACK_PATHS)for(const endpoint of [p.points[0],p.points.at(-1)]) {
    for(const other of TRACK_PATHS.filter(o=>o.id!==p.id&&o.kind!=='grade')) {
      if(onPath(endpoint,other.points))assert.ok(onPath(boardPoint(endpoint),boardPolyline(other.points)),`${p.id} -> ${other.id}`);
    }
  }
  assert.equal(TRACK_PATHS.filter(p=>p.kind==='grade').length,6);
  assert.ok(TRACK_PATHS.every(p=>boardPolyline(p.points).every(point=>point.every(Number.isFinite))));
});
