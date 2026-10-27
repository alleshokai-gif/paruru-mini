// Entirely invented times, IDs and service patterns. NEVER use for real travel.
import { datasetModel } from './dataset.mjs';
const STATIONS = ['Shinjuku:新宿','MinamiShinjuku:南新宿','Sangubashi:参宮橋','YoyogiHachiman:代々木八幡','YoyogiUehara:代々木上原','HigashiKitazawa:東北沢','ShimoKitazawa:下北沢','SetagayaDaita:世田谷代田','Umegaoka:梅ヶ丘','Gotokuji:豪徳寺','Kyodo:経堂','ChitoseFunabashi:千歳船橋','SoshigayaOkura:祖師ヶ谷大蔵','SeijogakuenMae:成城学園前','Kitami:喜多見','Komae:狛江','IzumiTamagawa:和泉多摩川','Noborito:登戸','MukogaokaYuen:向ヶ丘遊園'].map((s,index)=>{const [id,name]=s.split(':');return {id,name,index};});
const stop = (station, arrival, departure) => ({station,index:STATIONS.find(s=>s.id===station).index,arrival,departure,stop:true,platform:null});
const make = (name,type,stops,extra={}) => ({id:`demo:Weekday:${name}`,sourceTrainId:`demo-${name}`,trainNumber:null,
  calendar:'Weekday',type,destination:'デモ終点',origin:stops[0].station,identityBasis:'explicit_trip',
  knownPasses:type==='RapidExpress'?['SeijogakuenMae','MukogaokaYuen']:[],throughChiyoda:false,stops,...extra});
export function demoModel() {
  const base = [
    make('local','Local',[stop('Shinjuku',null,540),stop('YoyogiUehara',550,551),stop('SeijogakuenMae',570,573),stop('Noborito',585,586),stop('MukogaokaYuen',600,null)]),
    make('rapid','RapidExpress',[stop('Shinjuku',null,547),stop('YoyogiUehara',557,558),stop('Noborito',568,569)]),
    make('feeder','Local',[stop('Noborito',null,576),stop('MukogaokaYuen',580,null)]),
    make('express','Express',[stop('Shinjuku',null,543),stop('YoyogiUehara',553,554),stop('SeijogakuenMae',564,565),stop('Noborito',574,575),stop('MukogaokaYuen',578,null)]),
    make('front','Local',[stop('Shinjuku',null,535),stop('YoyogiUehara',545,546),stop('SeijogakuenMae',561,562),stop('Noborito',575,576),stop('MukogaokaYuen',590,null)]),
    make('through-in','Local',[stop('YoyogiUehara',549,null)],{throughChiyoda:true,serviceName:'千代田線側・直通確認済（デモ）',boundary:{station:'YoyogiUehara',identity:'explicit',typeBefore:'Local',typeAfter:'Express'},continuation:{station:'YoyogiUehara',nextTripId:'demo:Weekday:through-out',evidence:'explicit_same_train'}}),
    make('through-out','Express',[stop('YoyogiUehara',null,550),stop('SeijogakuenMae',566,567),stop('Noborito',576,577),stop('MukogaokaYuen',578,null)],{throughChiyoda:true}),
    make('unidentified','Local',[stop('YoyogiUehara',549,null)],{throughChiyoda:'unknown',serviceName:'千代田線側・同一便未確認（デモ）',boundary:{station:'YoyogiUehara',identity:'unknown'}})
  ];
  const weekends = base.map(t=>JSON.parse(JSON.stringify(t).replaceAll('Weekday','SaturdayHoliday')));
  return datasetModel({schemaVersion:1,id:'synthetic-navigation-v1',kind:'demo',title:'デモ：架空の検証用ダイヤ',timezone:'Asia/Tokyo',
    rights:{status:'synthetic'},stations:STATIONS,trips:[...base,...weekends],coverage:'新宿・上原・成城・登戸・遊園の人工ダイヤ。実運行に使わない',
    example:{selectedId:'demo:Weekday:local',compareAt:549,destination:'MukogaokaYuen'}});
}
