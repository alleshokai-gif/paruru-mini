import { TYPES, clock, minutes } from './core.mjs';
import { planNavigation, scheduledPosition, arrivalOrderReversals } from './navigation.mjs';
import { stationLayout } from './route-layout.mjs';
const $ = id => document.getElementById(id), TOP = 145;
const destinations = ['Noborito','MukogaokaYuen'];
let WIDTH = 118;
let model, selectedId = null, now = minutes($('time').value), pool = [];
const start = t => t.stops[0].departure ?? t.stops[0].arrival;
const station = id => model.stations.find(s => s.id === id);
const candidateFor = p => p.recommendation?.transfers ? p.recommendation : p.bestConditional?.saving > 0 ? p.bestConditional : null;
function node(tag, text, cls, parent) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; if (parent) parent.append(n); return n; }
function place(n, top, left) { n.style.top = `${top}px`; if (left !== undefined) n.style.left = `${left}px`; return n; }
function choose(id) { selectedId = id; render(); }
function render() {
  if (!model) return;
  const selected = pool.find(t => t.id === selectedId);
  const plans = selected ? destinations.map(d => ({ destination:d, ...planNavigation(pool,selected.id,d,now) })) : [];
  const compact = window.innerWidth <= 600, LEFT = compact ? 84 : 160;
  const candidates = plans.map(candidateFor).filter(Boolean);
  const important = new Set([selectedId, ...candidates.flatMap(p => p.legs.map(l=>l.trainId))].filter(Boolean));
  const keyStations = new Set(['YoyogiUehara', 'SeijogakuenMae', ...destinations]);
  const transfers = new Set(candidates.flatMap(p=>p.legs.map(l=>l.station)));
  for (const id of transfers) keyStations.add(id);
  for (const stop of selected?.stops || []) if (stop.stop) keyStations.add(stop.station);
  const nearby = pool.filter(t => scheduledPosition(t,now) || (start(t)>=now && start(t)<=now+10));
  const trains = [...new Set([...nearby.filter(t=>important.has(t.id)), ...nearby.sort((a,b)=>Math.abs(start(a)-now)-Math.abs(start(b)-now))].map(t=>t.id))];
  for (const id of important) if (id && !trains.includes(id)) trains.unshift(id);
  const visible = trains.slice(0,compact ? Math.max(4, important.size) : 8).map(id=>pool.find(t=>t.id===id)).filter(Boolean).sort((a,b)=>start(a)-start(b));
  const reversals = selected ? visible.filter(t=>t.id!==selectedId).flatMap(other=>arrivalOrderReversals(selected,other).map(reversal=>({other,reversal}))).slice(0,compact?1:2) : [];
  const expanded = new Set([...transfers,...reversals.map(r=>r.reversal.to)]);
  for(const id of expanded) keyStations.add(id);
  const layout = stationLayout(model.stations,keyStations,expanded,compact,compact?142:TOP), y=layout.y;
  WIDTH = Math.max(compact ? 56 : 84, Math.min(118, ($('rail').clientWidth - LEFT - 12) / Math.max(visible.length, 1)));
  const board = node('div',undefined,'board'); board.style.setProperty('--lane',`${WIDTH}px`); board.style.width = `${LEFT+visible.length*WIDTH+12}px`; board.style.height = `${layout.height+44}px`;board.style.setProperty('--station-edge',`${LEFT-7}px`);board.style.setProperty('--route-start',`${layout.rows[0].center}px`);board.style.setProperty('--route-height',`${layout.rows.at(-1).center-layout.rows[0].center}px`);
  const rows = new Map();
  for (const item of layout.rows) { const s = item.station, row = place(node('div',undefined,`row${item.major?' major':' minor'}${destinations.includes(s.id)?' target':''}`,board),item.top); row.style.height=`${item.height}px`; row.dataset.station=s.id; const label=node('span',s.name,'station',row); label.style.marginTop=`${item.major ? item.height/2-12 : 0}px`; rows.set(s.id,row); }
  const columns = new Map();
  visible.forEach((t,i)=>{
    const x=LEFT+i*WIDTH, column=place(node('div',undefined,`column ${t.type}${t.id===selectedId?' chosen':''}`,board),0,x); columns.set(t.id,{x,column});
    const typeLabel=compact&&t.type==='Local'?'各停':TYPES[t.type];
    const title=node('button',`${clock(start(t))} ${typeLabel}\n${t.destination}行`,`train-name${t.id===selectedId?' selected':''}`,column); title.type='button'; title.setAttribute('aria-label',`${clock(start(t))} ${TYPES[t.type]} ${t.destination}行を選択`); title.onclick=()=>choose(t.id);
    const stopIndexes=t.stops.filter(s=>s.stop).map(s=>s.index), line=place(node('div',undefined,`line${t.id===selectedId?' selected':''}`,column),y(Math.min(...stopIndexes))); line.style.height=`${y(Math.max(...stopIndexes))-y(Math.min(...stopIndexes))}px`;
    for (const s of t.stops.filter(s=>s.stop)) { const dot=place(node('i',undefined,'dot',column),y(s.index));dot.title=`${station(s.station)?.name} 停車`; }
    for (const id of t.knownPasses.filter(id=>!t.stops.some(s=>s.station===id&&s.stop))) if(station(id)) {const pass=place(node('i','×','pass',column),y(station(id).index));pass.title=`${station(id).name} 通過`;}
    const selectedPoint=selected?scheduledPosition(selected,now):null;
    const point=scheduledPosition(t,now), pending=!point && start(t)>=now;
    if (point || pending) { const train=place(node('button',undefined,`train${t.id===selectedId?' selected':''}`,column),point?y(point.index):96); train.type='button'; train.setAttribute('aria-label',`${clock(start(t))} ${TYPES[t.type]} ${t.destination}行の電車`); node('span',t.id===selectedId?'🚆 ★':'🚆','icon',train);if(point&&selectedPoint&&t.id!==selectedId)node('small',point.index>selectedPoint.index?'前方':point.index<selectedPoint.index?'後方':'同じ駅間',undefined,train); node('span',typeLabel,undefined,train); node('small',pending?`${clock(start(t))}発・位置未取得`:'定刻推定',undefined,train); train.onclick=()=>choose(t.id); }
    for (const d of destinations) { const s=station(d), stop=t.stops.find(s=>s.station===d && s.stop), cell=place(node('div',undefined,`arrival${Number.isInteger(stop?.arrival)?'':' unknown'}`,column),y(s.index)-11); node('span',Number.isInteger(stop?.arrival)?clock(stop.arrival):t.knownPasses.includes(d)?'通過':'—',undefined,cell);
      if(t.id===selectedId && Number.isInteger(stop?.arrival)) node('small',plans.find(p=>p.destination===d)?.recommendation?.transfers===0?'そのまま':'乗り続ける',undefined,cell);
      if (!Number.isInteger(stop?.arrival) && t.id===selectedId) { const ref=model.tCodeReferences?.find(r=>r.tripId===t.id&&r.status==='unique_reference'); const a=node('a','公式で確認','official',cell); a.href=ref?.url || 'https://www.odakyu.jp'; a.target='_blank'; a.rel='noreferrer'; a.title=ref?`${ref.serviceDate}の参照・当日未確認`:'公式の時刻表を確認'; }
    }
  });
  for (const p of plans) {
    const candidate=candidateFor(p);
    if (!candidate || (!p.baseline && !p.destinationPassed)) continue;
    let from=selectedId;
    for(const leg of candidate.legs){ const a=columns.get(from),b=columns.get(leg.trainId),s=station(leg.station); if(!a||!b) continue;
      const tight=candidate.connection==='tight', yy=y(s.index), left=Math.min(a.x,b.x)+WIDTH/2, span=Math.abs(a.x-b.x);
      const arrow=place(node('div',undefined,`arrow${b.x<a.x?' reverse':''}${tight?' tight':''}`,board),yy,left); arrow.style.width=`${span}px`;
      const message=compact?`${station(p.destination).name} ${clock(candidate.arrival)}${candidate.saving>0?` · ${candidate.saving}分早着`:''}`:`${s.name}で乗換 → ${station(p.destination).name} ${clock(candidate.arrival)}${candidate.saving>0?`（${candidate.saving}分早い）`:''}`;
      const bubbleLeft=compact?LEFT:Math.max(LEFT,Math.min(a.x,b.x));
      const bubble=place(node('div',message,`bubble${tight?' tight':''}`,board),yy+12,bubbleLeft);bubble.style.maxWidth=`${LEFT+visible.length*WIDTH-bubbleLeft}px`;node('small',compact?(tight?'ここで乗換・接続ギリギリ':'ここで乗換・接続見込み'):(tight?'接続ギリギリ・間に合わない可能性':'接続見込み・番線未確認'),undefined,bubble); rows.get(s.id)?.classList.add('transfer');
      const destCell=b.column.querySelectorAll('.arrival')[destinations.indexOf(p.destination)]; if(leg===candidate.legs.at(-1)&&destCell){destCell.classList.add('earlier');node('small','乗換案',undefined,destCell);} from=leg.trainId;
    }
  }
  for(const {other,reversal:r} of reversals){
    const a=station(r.from),b=station(r.to),c=columns.get(other.id),row=layout.rows.find(row=>row.station.id===b.id);
    const at=train=>{const stop=train.stops.find(s=>s.station===b.id);return stop.arrival??stop.departure;};
    const ahead=at(other)<at(selected)?other:selected, aheadName=ahead.id===selectedId?'★ 選択列車':`${clock(start(ahead))} ${compact&&ahead.type==='Local'?'各停':TYPES[ahead.type]}`;
    const label=compact?`${aheadName}が先着`:`${a.name} → ${b.name}\n${aheadName}が先着`;
    const n=place(node('div',label,'reverse-note',board),compact?row.top+4:y((a.index+b.index)/2),compact?LEFT:Math.min(c.x,LEFT+visible.length*WIDTH-200));n.style.whiteSpace='pre-line';n.style.maxWidth=`${compact?visible.length*WIDTH:190}px`;node('small',compact?`${a.name}→${b.name} · 地点未確認`:'追越し地点は未確認',undefined,n);n.title='着発順序の逆転。実際の追越し地点は未確認';
  }
  node('span','● 停車　× 通過　無印は不明 / 駅間圧縮・番線ではありません','end-note',board).style.top=`${layout.height+10}px`;
  $('rail').replaceChildren(board);
  $('hint').textContent=selected ? `★ ${clock(start(selected))} ${TYPES[selected.type]} ${selected.destination}行${scheduledPosition(selected,now)?'':' · 現在位置は未取得'}` : '電車をクリック → 先着と乗換ポイント';
}
function showError(error){ model=undefined;pool=[];$('rail').replaceChildren();$('error').hidden=false;$('error').textContent='保存ダイヤを開けませんでした。PCのサーバーを確認して再読込してください。';$('hint').textContent='読込失敗・古い結果は表示しません';console.error(error.message); }
window.addEventListener('resize',()=>render());
for(const [id,delta]of[['back',-1],['next',1]]) $(id).onclick=()=>{now=Math.max(0,Math.min(1439,now+delta));$('time').value=clock(now);render();};
$('time').onchange=()=>{const value=minutes($('time').value);if(!Number.isInteger(value)||value<0||value>1439){$('rail').replaceChildren();$('error').hidden=false;$('error').textContent='時刻を入力してください';return;}now=value;$('error').hidden=true;render();};
try{const response=await fetch('/api/model?dataset=real',{cache:'no-store'});if(!response.ok)throw Error(`HTTP_${response.status}`);const data=await response.json();if(data.dataset?.kind!=='real'||!Array.isArray(data.trips)||!data.trips.length)throw Error('REAL_DATA_REQUIRED');model=data;pool=model.trips.filter(t=>t.calendar==='Weekday');const dates=[...new Set(pool.map(t=>t.sourceServiceDate))];$('note').textContent=`${dates.join('・')} 平日保存ダイヤ / 位置は推定・接続未保証`;render();}catch(e){showError(e);}
