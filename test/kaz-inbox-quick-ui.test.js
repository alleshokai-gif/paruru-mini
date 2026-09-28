'use strict';

const assert=require('node:assert/strict');
const inbox=require('../features/kaz-os/inbox');

class Element {
  constructor(tag,doc){
    this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.attributes={};
    this.className='';this.hidden=false;this.disabled=false;this.value='';this._text='';this.listeners={};
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
  addEventListener(name,listener){this.listeners[name]=listener;}
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
const answerApi=async answer=>{calls.push(answer);data={...data,inbox_items:data.inbox_items.filter(item=>item.id!==answer.decision_id)};
  return answer.selected_option==='WORK'?{inbox:data,answer:{persistence_status:'DURABLE_PERSISTED',candidate_revision:answer.candidate_revision},
    proposal:{change:{create_work_proposal:{kind:'CREATE_WORK',write_allowed:false,notion_write:0}}}}:{inbox:data};};
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
  const commit='a'.repeat(40),blob='b'.repeat(40),revision=commit+':'+blob;
  const candidateRef='github://alleshokai-gif/kaz-context/inbox/candidate.md@'+commit;
  const candidate={id:'candidate-review-later',kind:'generic_candidate_review',contract:'generic-candidate-review-0.1',owner:'kaz',decision_requested:true,decision_status:'pending',
    title:'Unified Intake closed loop and trigger boundary',question:'このCandidateの扱いを決めてな。',impact:'WORKだけproposalを作る',
    candidate_ref:candidateRef,candidate_revision:revision,candidate_origin:'CHATGPT',question_revision:'question-sha256:'+'c'.repeat(64),
    source_revision_references:refs,answer_contract:{inbox_item_id:'candidate-review-later',question_revision:'question-sha256:'+'c'.repeat(64),
      choices:['CONTEXT','WORK','PROJECT','HOLD','REJECT','MERGE'].map(value=>({value,label:value}))}};
  data={...data,projects:[],work_items:[],inbox_items:[candidate],
    sources:{...data.sources,github_candidates:{...source,source_revision:commit}}};
  calls.length=0;let projectReads=0;
  const projectsApi=async()=>{projectReads++;return{sources:{projects:source},projects:[{id:'project-1',title:'Kaz OS',status:'ACTIVE'}]};};
  inbox.render(host,{page:'inbox',id:'all'},data,now,{health,tick:false,answerApi,
    projectsApi:async()=>({sources:{projects:{...source,source_revision:'changed'}},projects:[{id:'project-1',title:'Kaz OS',status:'ACTIVE'}]})});
  let filter=find(host,node=>node.tagName==='select'&&node.className==='ki-filter');filter.value='all';filter.listeners.change();
  button(host,'判断する').onclick();await button(host,'WORK').onclick();
  assert(host.textContent.includes('Project revisionを再取得してください'));
  assert.equal(calls.length,0,'changed Project revision cannot save a Candidate answer');
  inbox.render(host,{page:'inbox',id:'all'},data,now,{health,tick:false,answerApi,projectsApi});
  assert.equal(inbox.derive(data,now,health).today.length,0);
  assert.equal(inbox.derive(data,now,health).later.length,1);
  filter=find(host,node=>node.tagName==='select'&&node.className==='ki-filter');filter.value='all';filter.listeners.change();
  const start=button(host,'判断する');assert(start);
  start.onclick();
  assert.deepEqual(['CONTEXT','WORK','PROJECT','HOLD','REJECT','MERGE'].map(value=>Boolean(button(host,value))),[true,true,true,true,true,true]);
  await button(host,'WORK').onclick();
  assert.equal(projectReads,1,'WORK loads the existing complete Projects read once');
  const project=find(host,node=>node.tagName==='select'&&node.children.some(option=>option.value==='project-1'));
  const title=find(host,node=>node.tagName==='input'&&node.value===candidate.title);
  assert(project);assert(title);
  project.value='project-1';project.listeners.change();
  title.value='Unified Intakeの定期BatchとReview Queue準備を実装する';title.listeners.input();
  const save=button(host,'WORKを記録してproposalを作る');assert.equal(save.disabled,false);
  await save.onclick();
  assert.equal(calls.length,1,'use the existing Human Answer API exactly once');
  assert.equal(calls[0].selected_option,'WORK');
  assert.equal(calls[0].candidate_revision,revision);
  assert.deepEqual(calls[0].work_fields,{project_id:'project-1',title:title.value,status:'READY',action_type:'ACTION',source:'CHATGPT',estimate_min:null});
  assert.equal(calls[0].write_allowed,undefined);
  assert.equal(find(host,node=>node.dataset?.inboxId===candidate.id),undefined,'saved Candidate leaves the pending list');
  assert(host.textContent.includes('Candidate revision一致 · CREATE_WORK proposal生成 · write_allowed=false · Notion write 0'));
  inbox.dispose(host);
  console.log('PASS INBOX per-Work planning and later Candidate WORK through the existing revision-bound Human Answer API');
})().catch(error=>{console.error(error);process.exitCode=1;});
