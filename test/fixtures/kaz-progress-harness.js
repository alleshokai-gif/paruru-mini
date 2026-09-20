'use strict';
// Synthetic identity only. Production auth functions run unchanged against in-memory I/O.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
function createHarness(options = {}) {
  const root = options.root || path.resolve(__dirname, '../..');
  const source = name => fs.readFileSync(path.join(fs.existsSync(path.join(root, name)) ? root : options.baseRoot, name), 'utf8');
  const header = ['homeId','memberUserId','displayName','role','status','createdAt','updatedAt'];
  const dh = ['deviceId','homeId','memberUserId','status','assignedBy','assignedAt','updatedAt'];
  const rows = { Home_Members: [header, ['local-home','father','父','admin','active','',''],['local-home','second_son','次男','self_record','active','',''], ['local-home','mother','母','guardian','active','',''], ['other-home','father','父','admin','active','','']],
    Device_Memberships: [dh,['admin-local','local-home','father','active','','',''],['child-local','local-home','second_son','active','','',''],['guardian-local','local-home','mother','active','','',''],['other-local','other-home','father','active','','','']] };
  if (options.decisionLedgerRows) rows.Kaz_OS_Decision_Ledger = structuredClone(options.decisionLedgerRows);
  const credentials = Object.fromEntries(['admin-local','child-local','guardian-local','other-local'].map(id => [id, crypto.randomBytes(32).toString('hex')]));
  const registry = {version:1,devices:{},requests:{},approveAttempts:{}};
  Object.entries(credentials).forEach(([id, token]) => { registry.devices[id] = {deviceId:id,status:'active',tokenHash:crypto.createHash('sha256').update(token).digest('hex'),lastUsedAt:null}; });
  const props = {'PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1':JSON.stringify(registry),'KAZ_OS_LIVE_ENABLED':'true','KAZ_OS_PROGRESS_OWNER_HOME_ID':'local-home','KAZ_OS_PROGRESS_OWNER_MEMBER_ID':'father'};
  if (options.answerEnabled === true) props.KAZ_OS_INBOX_ANSWER_ENABLED = 'true';
  let writes = 0, reads = 0;
  const sheet = name => {
    const values = rows[name]; if (!values) return null;
    return {getLastColumn:()=>values[0]?.length||0,getLastRow:()=>values.length,
      getDataRange:()=>({getValues:()=>structuredClone(values)}),
      getRange:(row,col,count,width)=>({getValues:()=>Array.from({length:count},(_,r)=>Array.from({length:width},(_,c)=>values[row-1+r]?.[col-1+c]??'')),setValues:data=>{if(options.failDecisionLedgerWrite&&name==='Kaz_OS_Decision_Ledger'&&row>1)throw Error('SIMULATED_PERSISTENCE_FAILURE');writes++;for(let r=0;r<count;r++){if(!values[row-1+r])values[row-1+r]=[];for(let c=0;c<width;c++)values[row-1+r][col-1+c]=data[r][c];}}}),
      setFrozenRows() {}};
  };
  const ctx = {console, JSON, Date, Number, String, Boolean, Object, Array, Error, Math,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||'',setProperty:(k,v)=>{writes++; props[k]=v;}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:sheet,insertSheet:name=>{if(rows[name])throw Error('DUPLICATE_SHEET');rows[name]=[];return sheet(name);}}),flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,v)=>Array.from(crypto.createHash('sha256').update(v).digest()),
      formatDate:d=>d.toISOString(), getUuid:()=>crypto.randomUUID()},
    UrlFetchApp:{fetch(){throw Error('EXTERNAL_FETCH_FORBIDDEN');}},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
  };
  vm.createContext(ctx);
  ['gas/HomeMemberPolicy.js','gas/HomeMembershipService.js','gas/DevicePairingService.js','gas/Code.js','gas/KazOsInboxAnswer.js','gas/KazOsProgress.js','gas/KazOsProjects.js','gas/KazOsWork.js','gas/KazOsToday.js','gas/KazOsInbox.js'].forEach(f=>vm.runInContext(source(f),ctx,{filename:f}));
  ctx.resolveFirebaseAuthenticatedActor_ = body => {
    const subject = String(body && body.auth && body.auth.idToken || '');
    const actors = {
      'admin-local': {homeId:'local-home',memberUserId:'father',displayName:'父',role:'admin'},
      'child-local': {homeId:'local-home',memberUserId:'second_son',displayName:'次男',role:'self_record'},
      'guardian-local': {homeId:'local-home',memberUserId:'mother',displayName:'母',role:'guardian'},
      'other-local': {homeId:'other-home',memberUserId:'father',displayName:'父',role:'admin'},
    };
    if (!actors[subject]) { const error = new Error('AUTH_TOKEN_INVALID'); error.code = 'AUTH_TOKEN_INVALID'; throw error; }
    return Object.freeze({...actors[subject],authBindingKey:'firebase-'+subject});
  };
  ctx.readKazOsProgress_ = () => {reads++; return options.provider();};
  ctx.readKazOsProjects_ = () => {reads++; if (!options.projectsProvider) throw Error('PROJECTS_NOT_CONFIGURED'); return options.projectsProvider();};
  ctx.readKazOsWork_ = () => {reads++; if (!options.workProvider) throw Error('WORK_NOT_CONFIGURED'); return options.workProvider();};
  ctx.readKazOsToday_ = () => {reads++; if (!options.todayProvider) throw Error('TODAY_NOT_CONFIGURED'); return options.todayProvider();};
  ctx.readKazOsInbox_ = () => {reads++; if (!options.inboxProvider) throw Error('INBOX_NOT_CONFIGURED'); return options.inboxProvider();};
  return {ctx, props, rows, credentials, stats:()=>({writes,reads}), resetStats:()=>{writes=0;reads=0;}, setupDecisionLedger:()=>ctx.setupKazOsDecisionLedger(),
    body:(device='admin-local', extra={})=>({action:'kazOs.progress.get',auth:{provider:'firebase',idToken:device},...extra}),
    call:body=>ctx.doPost({postData:{contents:JSON.stringify(body)}})};
}
module.exports = { createHarness };
