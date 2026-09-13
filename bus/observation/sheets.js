import { GoogleAuth } from 'google-auth-library';
import { OBSERVATION_HEADERS,RAW_SHEET,observationValues } from './schema.js';

const API='https://sheets.googleapis.com/v4/spreadsheets/';
const MAX_RESPONSE_BYTES=8*1024*1024;
const range=value=>encodeURIComponent(`'${RAW_SHEET}'!${value}`);
const fail=code=>{throw Error(code);};
async function jsonResponse(response,code) {
  if(!response?.ok)fail(code);
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>MAX_RESPONSE_BYTES)fail('OBSERVATION_SHEETS_RESPONSE_TOO_LARGE');
  const text=await response.text();
  if(Buffer.byteLength(text)>MAX_RESPONSE_BYTES)fail('OBSERVATION_SHEETS_RESPONSE_TOO_LARGE');
  try{return text?JSON.parse(text):{};}catch{fail('OBSERVATION_SHEETS_RESPONSE_INVALID');}
}
export function createAccessTokenProvider({auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']})}={}) {
  let client=null;
  return async()=>{
    client??=await auth.getClient();
    const value=await client.getAccessToken(),token=typeof value==='string'?value:value?.token;
    if(typeof token!=='string'||!token)fail('OBSERVATION_GOOGLE_AUTH_FAILED');
    return token;
  };
}
export function createSheetsStore({spreadsheetId,fetcher=fetch,tokenProvider=createAccessTokenProvider(),timeoutMs=20000}={}) {
  if(typeof spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId)
    ||typeof fetcher!=='function'||typeof tokenProvider!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1000)
    fail('OBSERVATION_SHEETS_CONFIG_INVALID');
  const base=`${API}${encodeURIComponent(spreadsheetId)}/values/`;
  let known=null;
  async function request(url,options={},code='OBSERVATION_SHEETS_REQUEST_FAILED') {
    const token=await tokenProvider(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetcher(url,{...options,signal:controller.signal,headers:{
        Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});
      return await jsonResponse(response,code);
    } catch(error) {
      if(/^OBSERVATION_[A-Z_]+$/.test(error?.message||''))throw error;
      fail(code);
    } finally {clearTimeout(timer);}
  }
  async function initialize() {
    if(known)return;
    const header=await request(`${base}${range('1:1')}?majorDimension=ROWS`,{},'OBSERVATION_SHEETS_HEADER_READ_FAILED');
    const actual=header.values?.[0]||[];
    if(JSON.stringify(actual)!==JSON.stringify(OBSERVATION_HEADERS))fail('OBSERVATION_SHEETS_SCHEMA_MISMATCH');
    const ids=await request(`${base}${range('A2:A')}?majorDimension=COLUMNS`,{},'OBSERVATION_SHEETS_IDS_READ_FAILED');
    known=new Set((ids.values?.[0]||[]).filter(value=>typeof value==='string'&&/^obs_[a-f0-9]{32}$/.test(value)));
  }
  async function append(rows) {
    if(!Array.isArray(rows))fail('OBSERVATION_SHEETS_ROWS_INVALID');
    await initialize();
    const seen=new Set(),missing=[];
    for(const row of rows)if(!known.has(row.observation_id)&&!seen.has(row.observation_id)) {
      missing.push(row);seen.add(row.observation_id);
    }
    if(!missing.length)return {attempted:rows.length,inserted:0,duplicates:rows.length};
    const lastColumn=columnName(OBSERVATION_HEADERS.length);
    const result=await request(`${base}${range(`A:${lastColumn}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
      {method:'POST',body:JSON.stringify({majorDimension:'ROWS',values:missing.map(observationValues)})},
      'OBSERVATION_SHEETS_APPEND_FAILED');
    if(result.updates?.updatedRows!==missing.length)fail('OBSERVATION_SHEETS_APPEND_UNCONFIRMED');
    for(const row of missing)known.add(row.observation_id);
    return {attempted:rows.length,inserted:missing.length,duplicates:rows.length-missing.length};
  }
  return {append,initialize,knownCount:()=>known?.size??null};
}
export function columnName(count) {
  if(!Number.isInteger(count)||count<1||count>702)fail('OBSERVATION_COLUMN_COUNT_INVALID');
  let value=count,result='';
  while(value){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26);}
  return result;
}
