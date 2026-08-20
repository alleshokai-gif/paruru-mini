'use strict';

const PET_HEALTH_GVIZ_HEADERS = Object.freeze({
  Pet_Health_Events: Object.freeze(['eventId','homeId','petId','eventType','occurredAt','occurredAtSource','localDate','mealSlot','amountG','completion','amountMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','flagsJson','note','source','recordedBy','recordedAt','clientRequestId','requestHash']),
  Pet_Health_Request_Log: Object.freeze(['clientRequestId','operation','actorUserId','petId','requestHash','eventId','responseJson','status','createdAt'])
});

function buildPetHealthGvizUrl(baseUrl,sheetName,range){
  const url=new URL(String(baseUrl||''));
  url.searchParams.set('sheet',String(sheetName||''));
  url.searchParams.set('headers','1');
  if(range)url.searchParams.set('range',String(range));else url.searchParams.delete('range');
  return url.toString();
}

function petHealthGvizValue_(cell){
  if(cell&&typeof cell==='object'&&Object.prototype.hasOwnProperty.call(cell,'v'))return cell.v;
  return cell;
}

function petHealthGvizRow_(row){
  const cells=Array.isArray(row)?row:Array.isArray(row&&row.c)?row.c:[];
  const values=cells.map(petHealthGvizValue_);
  while(values.length&&(values[values.length-1]===null||values[values.length-1]===undefined||values[values.length-1]===''))values.pop();
  return values;
}

function petHealthGvizHeaderMatches_(row,expectedHeaders){
  return row.length===expectedHeaders.length&&row.every((value,index)=>String(value??'')===expectedHeaders[index]);
}

function parsePetHealthGvizRows(rows,expectedHeaders){
  if(!Array.isArray(rows)||!Array.isArray(expectedHeaders)||!expectedHeaders.length)throw new Error('INVALID_GVIZ_PROBE_INPUT');
  const normalized=rows.map(petHealthGvizRow_),matches=[];
  normalized.forEach((row,index)=>{if(petHealthGvizHeaderMatches_(row,expectedHeaders))matches.push(index);});
  if(matches.length!==1)throw new Error('GVIZ_HEADER_MISMATCH');
  const headerIndex=matches[0],dataRows=normalized.slice(headerIndex+1).filter((row)=>row.some((value)=>value!==null&&value!==undefined&&value!==''));
  return {headerIndex,headers:normalized[headerIndex],dataRows,dataRowCount:dataRows.length};
}

module.exports={PET_HEALTH_GVIZ_HEADERS,buildPetHealthGvizUrl,parsePetHealthGvizRows};
