'use strict';

const assert=require('node:assert/strict');
const inbox=require('../features/kaz-os/inbox');

class Element {
  constructor(tag,doc){
    this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.attributes={};
    this.className='';this.hidden=false;this.disabled=false;this.value='';this._text='';
    this.classList={add:name=>{this.className+=' '+name;},toggle:(name,enabled)=>{
      const names=new Set(this.className.split(/\s+/).filter(Boolean));
      if(enabled)names.add(name);else names.delete(name);this.className=[...names].join(' ');
    }};
  }
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(){}
  focus(){}
  querySelectorAll(selector){
    const tags=new Set(selector.split(',').map(value=>value.trim()));
    return descendants(this).filter(node=>tags.has(node.tagName));
  }
}
function descendants(parent){return parent.children.flatMap(child=>[child,...descendants(child)]);}
function find(parent,predicate){return descendants(parent).find(predicate);}

const doc={createElement(tag){return new Element(tag,doc);}};
const host=new Element('main',doc);
const now=Date.now(),today=new Date(now+9*3600000).toISOString().slice(0,10);
const source={status:'ok',complete:true,source_revision:'fixture',valid_until:new Date(now+3600000).toISOString()};
const refs={projects:'fixture',work_items:'fixture',calendar:'fixture'};
const focus={id:'focus',kind:'today_focus',contract:'secretary-question-0.1',owner:'kaz',decision_requested:true,
  title:'Today focus',question:'いつやる？',decision_date:today,entity_ref:'work-focus',entity_revision:'rev',
  question_revision:'question-sha256:'+'a'.repeat(64),source_revision_references:refs,
  answer_contract:{inbox_item_id:'focus',question_revision:'question-sha256:'+'a'.repeat(64),question:'いつやる？',
    choices:['today','this_week','later'].map((value,index)=>({value,label:['今日','今週','あとで'][index],effect:'fixture'}))}};
const estimate=n=>({id:'estimate-'+n,kind:'daily_estimate',contract:'secretary-question-0.1',owner:'kaz',decision_requested:true,
  title:'Estimate '+n,question:'今日やる？',decision_date:today,project_id:'missing-project',entity_ref:'work-'+n,
  entity_revision:'rev-'+n,question_revision:'question-sha256:'+'b'.repeat(64),source_revision_references:refs,
  answer_contract:{inbox_item_id:'estimate-'+n,question_revision:'question-sha256:'+'b'.repeat(64),question:'今日やる？',
    choices:['today','this_week','later'].map((value,index)=>({value,label:['今日','今週','あとで'][index],effect:'fixture'}))},
  input_contract:{type:'planning_estimate',min:1,max:100000,unit:'minutes'}});
let data={origin:'real_operational_sources',mode:'controlled_proposal',fixture_only:false,as_of:new Date(now).toISOString(),
  sources:{inbox:source,projects:source,tasks:source,calendar:source},projects:[],
  work_items:[{id:'work-focus',source_revision:'rev'}],calendar_events:[],
  inbox_items:[focus,...[5,4,3,2,1].map(estimate)]};
const health=value=>value?.status||'failed',calls=[];
const answerApi=async answer=>{calls.push(answer);data={...data,inbox_items:data.inbox_items.filter(item=>item.id!==answer.decision_id)};return{inbox:data};};
const card=id=>find(host,node=>node.className.includes('kiq-current')&&node.dataset.decisionId===id);
const button=(parent,label)=>find(parent,node=>node.tagName==='button'&&node.textContent===label);

(async()=>{
  inbox.render(host,{page:'inbox',id:null},data,now,{health,tick:false,answerApi});
  assert.deepEqual(descendants(host).filter(node=>node.className.includes('kiq-current')).map(node=>node.dataset.decisionId),
    ['focus','estimate-5','estimate-4','estimate-3']);
  assert(!host.textContent.includes('Project未確認'));
  assert(!host.textContent.includes('分で保存'));
  assert(button(card('estimate-5'),'今日'));
  assert(button(card('estimate-5'),'今週'));
  assert(button(card('estimate-5'),'あとで'));
  assert.equal(button(card('estimate-5'),'30分').disabled,false);
  const custom=find(card('estimate-5'),node=>node.className.includes('kiq-estimate-custom'));
  assert.equal(custom.hidden,true);
  const minutesGroup=find(card('estimate-5'),node=>node.className.includes('kiq-estimate')&&!node.className.includes('kiq-estimate-choices')&&!node.className.includes('kiq-estimate-custom'));
  assert.equal(minutesGroup.hidden,true,'minutes must stay hidden before Today is selected');
  button(card('estimate-5'),'今日').onclick();
  assert.equal(calls.length,0,'Today selection only opens the same card');
  assert.equal(minutesGroup.hidden,false);
  button(card('estimate-5'),'その他').onclick();
  assert.equal(custom.hidden,false);
  await button(card('estimate-5'),'30分').onclick();
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].selected_option,{preference:'today',estimate_min:30});
  assert.equal(calls[0].question_revision,'question-sha256:'+'b'.repeat(64));
  assert.equal(card('estimate-5'),undefined);
  assert(card('estimate-2'),'next TODAY estimate should enter the three-card window');
  button(card('estimate-4'),'スキップ').onclick();
  assert.equal(card('estimate-4'),undefined);
  assert.equal(calls.length,1,'skip must not save an answer');
  await button(card('estimate-3'),'今週').onclick();
  assert.deepEqual(calls[1].selected_option,{preference:'this_week'});
  assert.equal(card('estimate-3'),undefined);
  await button(card('focus'),'今日やる').onclick();
  assert.equal(calls[2].selected_option,'today');
  assert.equal(card('focus'),undefined);
  assert.equal(card('estimate-4'),undefined,'skip should survive another answer in the same view');
  inbox.dispose(host);
  console.log('PASS INBOX per-Work planning, conditional estimate, skip, revision-bound save, and card removal');
})().catch(error=>{console.error(error);process.exitCode=1;});
