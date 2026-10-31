'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'features/family-schedules/page.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function data(){return {schemaVersion:'family-schedule.snapshot.v1',period:'2026-11',freshness:'current',generatedAt:'2026-10-31T00:00:00Z',validUntil:'2099-12-01T00:00:00Z',sources:[{sourceId:'test'}],organizations:[{organizationId:'org-a',name:'Example A'},{organizationId:'org-b',name:'Example B'}],events:[
 {eventId:'event-2',sourceId:'source',revision:1,memberId:'child-a',organizationId:'org-a',date:'2026-11-02',title:'Preparation',timeStatus:'not_listed',updatedAt:'2026-10-31T00:00:00Z'},
 {eventId:'event-1',sourceId:'source',revision:2,memberId:'child-a',organizationId:'org-a',date:'2026-11-02',title:'Practice',startTime:'15:20',endTime:'18:00',timeStatus:'specified',updatedAt:'2026-10-31T00:00:00Z'},
 {eventId:'event-3',sourceId:'source',revision:1,memberId:'child-b',organizationId:'org-b',date:'2026-11-01',title:'Event',timeStatus:'undecided',updatedAt:'2026-10-31T00:00:00Z'}]};}
test('home contains only the launch entry; independent view preserves legacy home content',()=>{
 const home=html.slice(html.indexOf('<section id="homeView"'),html.indexOf('<section id="familySchedulesView"'));
 assert(!home.includes('familySchedulePanel'));assert(home.includes('todayParuru'));assert(home.includes('homeMemoQuick'));assert(home.includes('homeFeatureLauncher'));
 assert.match(html,/<section id="familySchedulesView"[^>]+data-view="family-schedules"/);
 assert.match(fs.readFileSync(path.join(root,'features/navigation/config.js'),'utf8'),/id: "family-schedules"[^\n]+view: "family-schedules"/);
});
test('member and organization filters combine; chronological sort preserves same-day activities and stable edit references',()=>{
 const c={};vm.createContext(c);vm.runInContext(source,c);const api=c.PALURUFamilySchedules,s=data(),original=s.events.map(e=>e.eventId);
 assert.deepEqual(Array.from(api.selectEvents(s),e=>e.eventId),['event-3','event-1','event-2']);
 assert.equal(api.selectEvents(s,{memberId:'child-a',organizationId:'org-a'}).length,2);
 assert.equal(api.selectEvents(s,{memberId:'child-a',organizationId:'org-b'}).length,0);
 assert.deepEqual(s.events.map(e=>e.eventId),original);
 assert.equal(api.eventReference(s.events[1]).revision,2);assert(!('sourceFileId' in api.eventReference(s.events[1])));
});
test('new read-only page inherits home and existing API roles, without new server permissions',()=>{
 const c={appAuthenticationState:'active_member',activeMembershipContext:{role:'admin',allowedViews:['home']}};vm.createContext(c);
 const start=app.indexOf('function isViewAllowed_(viewName)'),end=app.indexOf('\nfunction getViewNavigationItems_',start);vm.runInContext(app.slice(start,end),c);
 for(const role of ['admin','guardian','self_record']){c.activeMembershipContext.role=role;assert.equal(c.isViewAllowed_('family-schedules'),true);}
 c.activeMembershipContext.allowedViews=['inbox'];assert.equal(c.isViewAllowed_('family-schedules'),false);
 c.activeMembershipContext.allowedViews=['home'];c.activeMembershipContext.role='';assert.equal(c.isViewAllowed_('family-schedules'),false);
 assert.equal(c.isViewAllowed_('home'),true);assert.equal(c.isViewAllowed_('kaz-os'),false);
});
test('home authentication performs no family read; opening page loads once, filters locally, and clears on lock',async()=>{
 class El {constructor(){this.children=[];this.value='';this.listeners={};this.dataset={};}append(...e){this.children.push(...e);}replaceChildren(...e){this.children=e;}add(e){this.children.push(e);}get options(){return this.children;}addEventListener(n,f){this.listeners[n]=f;}setAttribute(){} }
 const elements=new Map(['Panel','Period','MonthControl','Month','Status','List','Member','Organization','Reload','Back'].map(n=>['familySchedule'+n,new El()]));const listeners={};
 const document={getElementById:id=>elements.get(id),createElement:()=>new El(),querySelectorAll:()=>[{value:'child-a',textContent:'Child A'},{value:'child-b',textContent:'Child B'}],addEventListener:(n,f)=>listeners[n]=f,dispatchEvent(){}};
 let calls=0;const c={document,Date,URLSearchParams,Option:class{constructor(label,value){this.textContent=label;this.value=value;}},location:{search:'?scheduleMonth=2026-11'},localStorage:{getItem:()=>'',setItem(){}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}};vm.createContext(c);vm.runInContext(source,c);
 listeners['paruru:authenticated']({detail:{familyScheduleApi:async()=>{calls++;return data();}}});assert.equal(calls,0);
 const pending=[];listeners['family-schedules:opened']({detail:{waitUntil:p=>pending.push(p)}});await Promise.all(pending);assert.equal(calls,1);
 elements.get('familyScheduleMember').value='child-a';elements.get('familyScheduleMember').listeners.change();assert.equal(calls,1);assert.equal(elements.get('familyScheduleList').children.filter(e=>e.className==='family-schedule-event').length,2);
 listeners['kaz-os:locked']();assert.equal(elements.get('familyScheduleList').children.length,0);
});


test('Tokyo anchored periods include month, year and leap boundaries',()=>{
 const c={};vm.createContext(c);vm.runInContext(source,c);const api=c.PALURUFamilySchedules;
 const range=api.dateWindow('7','2026-11','2026-10-31');assert.equal(range.from,'2026-10-31');assert.equal(range.to,'2026-11-06');
 assert.deepEqual(Array.from(api.windowMonths(range)),['2026-10','2026-11']);
 assert.equal(api.dateWindow('30','','2026-12-31').to,'2027-01-29');
 assert.deepEqual(Array.from(api.windowMonths(api.dateWindow('30','','2027-01-31'))),['2027-01','2027-02','2027-03']);
 assert.equal(api.dateWindow('month','2028-02','2028-02-20').to,'2028-02-29');
 assert.equal(api.selectEvents(data(),{from:'2026-11-02',to:'2026-11-02'}).length,2);
 assert.equal(api.selectEvents(data(),{from:'2026-11-03'}).length,0);
 assert.match(source,/period.value=requested\?'month':'7'/);
});
