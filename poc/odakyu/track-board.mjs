import { scheduledPosition } from './navigation.mjs';

// A downbound schematic, not an interlocking drawing. Exact switches, depot and
// turnback tracks are omitted. No guessed crossovers. Opposite tracks are context.
export const TRACK_SOURCES = Object.freeze([
  'https://www.odakyu.jp/station/yoyogi_uehara/',
  'https://www.odakyu.jp/station/noborito/',
  'https://www.odakyu.jp/station/mukogaoka_yuen/',
  'https://wwwtb.mlit.go.jp/kanto/content/000164475.pdf',
  'https://www.pref.kanagawa.jp/documents/47520/10_odakyu3002.pdf'
]);
const STATIONS = [
  ['YoyogiUehara',112], ['ShimoKitazawa',368], ['Kyodo',472],
  ['SeijogakuenMae',576], ['Noborito',732], ['MukogaokaYuen',956]
];
export function boardLayout(stations) {
  const rows = STATIONS.map(([id,y]) => {
    const station = stations.find(s => s.id === id);
    if (!station) throw Error(`BOARD_STATION_MISSING:${id}`);
    return {...station,y};
  });
  return {rows,height:1104,station:id => rows.find(r => r.id === id),y:index => {
    if (index <= rows[0].index) return rows[0].y;
    for (let i=1;i<rows.length;i++) {
      const a=rows[i-1],b=rows[i];
      if (index<=b.index) return a.y+(b.y-a.y)*(index-a.index)/(b.index-a.index);
    }
    return rows.at(-1).y;
  }};
}
export function boardTracks(layout) {
  const ue=layout.station('YoyogiUehara').y,nob=layout.station('Noborito').y,yuen=layout.station('MukogaokaYuen').y;
  // Uehara has a deliberate gap: platform-to-express/local switch paths are not
  // verified. Noborito's two down tracks become ONE between stations. Yuen's
  // second down platform is station-only, never a fourth interstation mainline.
  return [
    {id:'shinjuku-approach',kind:'approach',d:`M 232 34 V ${ue+30}`},
    {id:'metro-approach',kind:'metro',d:`M 296 34 V 56 L 274 78 V ${ue+30}`},
    {id:'down-local',kind:'down',d:`M 232 ${ue+101} V ${nob+45} L 274 ${nob+87}`},
    {id:'down-express',kind:'down',d:`M 274 ${ue+101} V ${yuen+32}`},
    {id:'yuen-platform-1',kind:'down',d:`M 274 ${yuen-54} L 232 ${yuen-12} V ${yuen+28}`},
    {id:'up-express',kind:'up',d:`M 314 ${ue+101} V ${yuen+32}`},
    {id:'up-local',kind:'up',d:`M 338 ${ue+101} V ${yuen+32}`}
  ];
}
// Position resolution is independent of the topology renderer. A provider can
// supply verified track evidence later; today's platform-less trains stay off
// the physical rails. Type/destination never select a physical track.
export function boardPosition(train,now,layout) {
  const point=scheduledPosition(train,now),origin=layout.station(train.stops[0].station);
  return {kind:point?'scheduled':'departure',observed:false,point,trackId:null,
    y:point?layout.y(point.index):origin?.y??layout.rows[0].y};
}
