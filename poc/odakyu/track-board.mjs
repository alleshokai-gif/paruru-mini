// Canonical source: user supplied 1496x475 PNG, not a newly inferred track plan.
// Coordinates below trace that image. Row 2 is unfolded at x=1340, y offset=151.
// X intersections do NOT create graph nodes. Grade crossings are separate paths.
export const TRACK_REFERENCE = Object.freeze({
  file:'codex-clipboard-0b0ac78f-0bae-4ee7-abfc-f818d4d79ce9.png',
  sha256:'09b4941f6d34d71a3c8bdb0440fffba3e38b5b01da3beea1a82cf8eaf43399b1',
  width:1496,height:475,fold:1340,rowOffset:151
});
const paths=[];
function rail(id,points,kind='main',row=1) {
  paths.push({id,kind,sourceRow:row,points:points.map(([x,y])=>[x+(row===2?TRACK_REFERENCE.fold:0),y-(row===2?TRACK_REFERENCE.rowOffset:0)])});
}
// Shinjuku: 3 ground terminals, 2 underground terminals; grade separated throat.
rail('shinjuku-ground-1',[[19,82],[63,82],[70,89],[92,89],[103,85],[170,85],[177,93],[365,93],[372,85],[504,85],[512,78],[720,78]]);
rail('shinjuku-ground-2-upper',[[19,96],[63,96],[70,89]]);
rail('shinjuku-ground-2-lower',[[63,96],[70,104]]);
rail('shinjuku-ground-3',[[19,111],[63,111],[70,104],[92,104],[103,107],[170,107],[177,100],[480,100],[488,107],[504,107],[512,115],[620,115],[628,107],[720,107],[750,129],[918,129]]);
rail('shinjuku-ground-scissor-a',[[78,89],[92,104]],'switch');
rail('shinjuku-ground-scissor-b',[[78,104],[92,89]],'switch');
rail('shinjuku-underground-1',[[19,148],[91,148],[126,114]]);
rail('shinjuku-underpass-1',[[126,114],[145,95]],'grade');
rail('shinjuku-underground-1-exit',[[145,95],[147,93],[154,93],[162,85]]);
rail('shinjuku-underground-2',[[19,163],[63,163],[72,154],[91,154],[133,114]]);
rail('shinjuku-underpass-2',[[133,114],[145,102]],'grade');
rail('shinjuku-underground-2-exit',[[145,102],[147,100],[154,100],[162,107]]);
rail('shinjuku-underground-scissor-a',[[73,148],[79,154]],'switch');
rail('shinjuku-underground-scissor-b',[[73,154],[79,148]],'switch');
// Uehara: two Metro tracks, two turnback ends, scissor pairs and four onward tracks.
rail('metro-1',[[458,72],[488,93],[562,93]],'metro');
rail('metro-2',[[458,79],[488,100],[562,100]],'metro');
rail('uehara-turnback-1',[[562,93],[636,93]],'siding');
rail('uehara-turnback-2',[[562,100],[636,100]],'siding');
rail('uehara-upper-to-outer',[[562,93],[570,85],[578,78]],'switch');
rail('uehara-upper-reverse',[[570,78],[578,85]],'switch');
rail('uehara-lower-to-outer',[[562,100],[570,107],[578,115]],'switch');
rail('uehara-lower-reverse',[[570,115],[578,107]],'switch');
rail('uehara-through-upper',[[570,85],[925,85],[934,93],[1206,93],[1214,93],[1220,85],[1280,85],[1294,93],[1340,93]]);
rail('uehara-through-lower',[[570,107],[620,107],[628,100],[925,100],[940,115],[1340,115]]);
rail('higashikitazawa-grade',[[720,78],[758,115]],'grade');
rail('higashikitazawa-to-kyodo',[[758,115],[925,115]]);
rail('umegaoka-inner-grade',[[925,115],[940,100]],'grade');
rail('umegaoka-lower-grade',[[918,129],[940,107]],'grade');
rail('kyodo-inner-upper-continuation',[[940,100],[1340,100]]);
rail('kyodo-inner-lower-continuation',[[940,107],[1340,107]]);
// Kyodo: 5 station tracks, three buffer sidings and the connections in the image.
rail('kyodo-east-cross-1',[[1104,100],[1112,107]],'switch');
rail('kyodo-east-cross-2',[[1120,107],[1128,115]],'switch');
rail('kyodo-siding-entry',[[1136,115],[1144,122],[1150,126],[1194,126],[1198,122]],'siding');
rail('kyodo-siding-spine',[[1144,122],[1198,122],[1206,129],[1274,129],[1288,115],[1296,107]],'siding');
rail('kyodo-siding-1',[[1174,130],[1190,130]],'siding');
rail('kyodo-siding-2',[[1174,134],[1186,134]],'siding');
rail('kyodo-siding-3',[[1174,138],[1182,138],[1198,122]],'siding');
rail('kyodo-upper-scissor-a',[[1206,93],[1214,100]],'switch');
rail('kyodo-upper-scissor-b',[[1206,100],[1214,93]],'switch');
rail('kyodo-lower-east-cross',[[1206,107],[1214,115]],'switch');
rail('kyodo-lower-west-cross',[[1282,115],[1290,107]],'switch');
rail('kyodo-west-cross-1',[[1302,107],[1310,100]],'switch');
rail('kyodo-west-cross-2',[[1298,93],[1306,100]],'switch');
// Fold continuity: same four tracks; no connection is added at the image wrap.
rail('seijo-outer-upper',[[0,244],[176,244],[184,237],[242,237],[250,244],[606,244],[614,237],[672,237],[686,251]],'main',2);
rail('seijo-inner-upper',[[0,251],[874,251],[882,258],[885,258]],'main',2);
rail('seijo-inner-lower',[[0,258],[874,258]],'main',2);
rail('seijo-outer-lower',[[0,266],[176,266],[184,274],[242,274],[250,266],[606,266],[614,274],[672,274],[680,266],[728,266],[736,274],[793,274],[800,266],[808,258]],'main',2);
// Seijo: serial crossovers above the main lines; lower scissor; two depot leads.
rail('seijo-cross-inner',[[242,258],[250,251]],'switch',2);
rail('seijo-cross-upper',[[258,251],[266,244]],'switch',2);
rail('seijo-depot-upper-entry',[[257,244],[265,237],[284,237]],'siding',2);
rail('seijo-depot-upper-return',[[274,244],[282,237]],'switch',2);
rail('seijo-depot-upper-grade',[[284,237],[334,291]],'grade',2);
rail('seijo-lower-scissor-a',[[257,258],[265,266]],'switch',2);
rail('seijo-lower-scissor-b',[[257,266],[265,258]],'switch',2);
rail('seijo-depot-lower-entry',[[257,266],[265,274],[296,274],[326,304]],'siding',2);
rail('seijo-depot-lower-return',[[274,266],[282,274]],'switch',2);
// Noborito: the upper outside platform track merges; 3 tracks to Yuen.
// Yuen: outside upper platform loop, lower scissor, middle turnback end.
rail('yuen-upper-platform',[[720,251],[734,237],[786,237],[800,251]],'main',2);
rail('yuen-lower-exit',[[800,266],[885,266]],'main',2);
rail('yuen-lower-reverse',[[800,258],[808,266]],'switch',2);
rail('yuen-upper-to-turnback',[[816,251],[824,258]],'switch',2);

export const TRACK_PATHS=Object.freeze(paths.map(p=>Object.freeze(p)));
const platforms=[];
function platform(id,x1,x2,y1,y2,row=1) {
  platforms.push({id,from:x1+(row===2?1340:0),to:x2+(row===2?1340:0),v1:y1-(row===2?151:0),v2:y2-(row===2?151:0)});
}
for(const y of [75,89,104,119,140,155,169])platform('shinjuku-'+y,19,63,y-2,y+2);
platform('uehara-upper',518,562,82,90);platform('uehara-lower',518,562,104,111);
platform('shimokitazawa-upper',800,842,89,96);platform('shimokitazawa-lower',800,842,119,126);
platform('kyodo-upper',1223,1268,89,96);platform('kyodo-lower',1223,1268,119,126);
for(const [id,x1,x2] of [['seijo',190,236],['noborito',622,663],['yuen',743,787]]) {
  platform(id+'-upper',x1,x2,240,247,2);platform(id+'-lower',x1,x2,263,270,2);
}
export const TRACK_PLATFORMS=Object.freeze(platforms);
export const TRACK_BUFFERS=Object.freeze([[19,82],[19,96],[19,111],[19,148],[19,163],[636,93],[636,100],[1174,130],[1174,134],[1174,138],[2214,107]]);
export const TRACK_STATIONS=Object.freeze([
  {id:'Shinjuku',name:'新宿',at:41},{id:'YoyogiUehara',name:'代々木上原',at:540},
  {id:'ShimoKitazawa',name:'下北沢',at:820},{id:'Kyodo',name:'経堂',at:1240},
  {id:'SeijogakuenMae',name:'成城学園前',at:1553},{id:'Noborito',name:'登戸',at:1982},
  {id:'MukogaokaYuen',name:'向ヶ丘遊園',at:2105}
]);
// Only distances change. Source order and all connections stay in source space.
const SOURCE_SPACING=[[10,24],[64,124],[105,210],[177,310],[440,352],[488,402],[520,450],[562,515],[580,600],[636,690],[720,725],[758,800],[815,835],[918,895],[934,955],[940,980],[1104,950],[1150,1042],[1174,1078],[1198,1150],[1223,1195],[1270,1260],[1335,1380],[1340,1390],[1516,1435],[1530,1460],[1580,1540],[1590,1575],[1605,1620],[1622,1690],[1674,1840],[1948,1885],[1962,1910],[2003,1970],[2028,2010],[2060,2060],[2074,2100],[2127,2180],[2150,2230],[2174,2285],[2225,2340]];
const ANCHORS=SOURCE_SPACING.map(([u,y])=>[u,y+(u>=1104?80:0)]);
export function boardPoint([u,v]) {
  const x=140+(v-93)*2.7;
  for(let i=1;i<ANCHORS.length;i++) {
    const a=ANCHORS[i-1],b=ANCHORS[i];
    if(u<=b[0])return [x,a[1]+(b[1]-a[1])*(u-a[0])/(b[0]-a[0])];
  }
  return [x,2420];
}
// Split at each compression boundary before projecting. Mapping only the two
// ends of an oblique rail would move a turnout off its parent rail when the
// intervening source distance is compressed non-uniformly.
export function boardPolyline(points) {
  const projected=[boardPoint(points[0])];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    const cuts=ANCHORS.map(p=>p[0]).filter(u=>u>Math.min(a[0],b[0])&&u<Math.max(a[0],b[0]));
    if(b[0]<a[0])cuts.reverse();
    for(const u of cuts)projected.push(boardPoint([u,a[1]+(b[1]-a[1])*(u-a[0])/(b[0]-a[0])]));
    projected.push(boardPoint(b));
  }
  return projected;
}
export function sectionTracksAt(u) {
  const values=[];
  for(const path of TRACK_PATHS)for(let i=1;i<path.points.length;i++) {
    const [a,b]=[path.points[i-1],path.points[i]];
    if(u>=Math.min(a[0],b[0])&&u<Math.max(a[0],b[0]))values.push(a[1]+(b[1]-a[1])*(u-a[0])/(b[0]-a[0]));
  }
  return [...new Set(values.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);
}
