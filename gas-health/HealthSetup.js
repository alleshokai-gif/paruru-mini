const HEALTH_SHEETS={daily:'Health_Daily',weight:'Health_Weight',request:'Health_Request_Log'};
const HEALTH_HEADERS={daily:['recordId','homeId','targetUserId','localDate','morningClientRequestId','lunchClientRequestId','postTrainingClientRequestId','dinnerClientRequestId','conditionClientRequestId','morningStaple','morningProteinSource','morningRecordedBy','morningRecordedAt','lunchAmount','lunchProteinSource','lunchRecordedBy','lunchRecordedAt','postTrainingStatus','postTrainingOnigiriCount','postTrainingProteinSource','postTrainingRecordedBy','postTrainingRecordedAt','dinnerRiceBowls','dinnerNattoPacks','dinnerExtraProteinSource','dinnerRecordedBy','dinnerRecordedAt','conditionAppetite','conditionSymptomsJson','conditionNote','conditionRecordedBy','conditionRecordedAt','createdAt','updatedAt','morningWater','morningMedication','morningCondition','lunchWater','dinnerMedication','bedtime','lunchCondition','postTrainingWater','postTrainingCondition','morningMealType','morningMealOther','morningWaterType','morningWaterOther','morningConditionType','morningConditionOther','lunchMealType','lunchMealOther','lunchWaterType','lunchWaterOther','lunchConditionType','lunchConditionOther','postTrainingSnackType','postTrainingSnackOther','postTrainingWaterType','postTrainingWaterOther','postTrainingProteinAmount','postTrainingProteinOther','postTrainingConditionType','postTrainingConditionOther','dinnerMealType','dinnerMealOther'],weight:['recordId','homeId','targetUserId','measuredDate','weightKg','source','recordedBy','recordedAt','clientRequestId'],request:['clientRequestId','operation','actorUserId','targetUserId','requestHash','responseJson','status','createdAt']};
const PET_HEALTH_SHEETS={events:'Pet_Health_Events',request:'Pet_Health_Request_Log'};
const PET_HEALTH_HEADERS={events:['eventId','homeId','petId','eventType','occurredAt','occurredAtSource','localDate','mealSlot','amountG','completion','amountMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','flagsJson','note','source','recordedBy','recordedAt','clientRequestId','requestHash','remainingMl','newFillMl','correctionType','correctionOfEventId'],request:['clientRequestId','operation','actorUserId','petId','requestHash','eventId','responseJson','status','createdAt']};
function setupHealthSchema(){const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('HEALTH_SPREADSHEET_ID'));Object.keys(HEALTH_SHEETS).forEach(k=>{let s=ss.getSheetByName(HEALTH_SHEETS[k]);if(!s)s=ss.insertSheet(HEALTH_SHEETS[k]);const h=s.getLastColumn()?s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String):[];const m=HEALTH_HEADERS[k].filter(x=>h.indexOf(x)<0);if(m.length)s.getRange(1,h.length+1,1,m.length).setValues([m]);s.setFrozenRows(1)});Object.keys(PET_HEALTH_SHEETS).forEach(k=>{let s=ss.getSheetByName(PET_HEALTH_SHEETS[k]);if(!s)s=ss.insertSheet(PET_HEALTH_SHEETS[k]);const h=s.getLastColumn()?s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String):[],required=PET_HEALTH_HEADERS[k];if(h.slice(0,required.length).some((value,index)=>value!==required[index])||h.length>required.length)throw healthErr_('CONFIGURATION_ERROR');const missing=required.slice(h.length);if(missing.length)s.getRange(1,h.length+1,1,missing.length).setValues([missing]);s.setFrozenRows(1)})}
function setupHealthSchema_() { return setupHealthSchema(); }

function setupPetHealthSchema() {
  const spreadsheet = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('HEALTH_SPREADSHEET_ID'));
  Object.keys(PET_HEALTH_SHEETS).forEach(function(key) {
    ensurePetHealthSheet_(spreadsheet, PET_HEALTH_SHEETS[key], PET_HEALTH_HEADERS[key]);
  });
}

function ensurePetHealthSheet_(spreadsheet, sheetName, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const headers = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  const invalidPrefix = headers.some(function(header, index) {
    return index >= requiredHeaders.length || header !== requiredHeaders[index];
  });
  if (invalidPrefix) throw healthErr_('CONFIGURATION_ERROR');
  const missingHeaders = requiredHeaders.slice(headers.length);
  if (missingHeaders.length) {
    sheet.getRange(1, headers.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
  sheet.setFrozenRows(1);
}

function healthSheet_(name){const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('HEALTH_SPREADSHEET_ID')||'');const s=ss.getSheetByName(name), key=Object.keys(HEALTH_SHEETS).find(k=>HEALTH_SHEETS[k]===name),petKey=Object.keys(PET_HEALTH_SHEETS).find(k=>PET_HEALTH_SHEETS[k]===name);if(!s||(!key&&!petKey))throw healthErr_('CONFIGURATION_ERROR');const h=s.getRange(1,1,1,Math.max(1,s.getLastColumn())).getValues()[0].map(String);if(key&&HEALTH_HEADERS[key].some(x=>h.indexOf(x)<0))throw healthErr_('CONFIGURATION_ERROR');if(petKey&&PET_HEALTH_HEADERS[petKey].some((x,index)=>h[index]!==x))throw healthErr_('CONFIGURATION_ERROR');return s}
