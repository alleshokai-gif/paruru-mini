// Same private Inbox custody and worker identity, separate family-schedule queue.
function familyInboxFamilyScheduleContext_(value) {
  const allowed={organizationId:true,organizationName:true,schoolType:true,category:true,period:true};
  familyInboxWorkerValidateKeys_(value,allowed);
  if(Object.keys(value).length!==5 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.organizationId||'') ||
      typeof value.organizationName!=='string'||!value.organizationName.trim()||value.organizationName.length>100 ||
      !['elementary','junior_high','high_school','university','other'].includes(value.schoolType)||
      !['club','school','university','other'].includes(value.category)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.period||'')) throw familyInboxError_('INVALID_INPUT');
  return {organizationId:value.organizationId,organizationName:value.organizationName.trim(),schoolType:value.schoolType,category:value.category,period:value.period};
}
function familyInboxFamilyScheduleCheckContext_(record,input) {
  if(input.documentType!=='family_schedule')return;
  let saved;try{saved=JSON.parse(DriveApp.getFileById(record.originalRef).getDescription());}catch(_){throw familyInboxError_('DATA_INTEGRITY_ERROR');}
  if(saved.schemaVersion!=='family-schedule.source.v1'||saved.homeId!==input.homeId||saved.memberId!==input.subjectMemberId||
    JSON.stringify(saved.context)!==JSON.stringify(input.scheduleContext))throw familyInboxError_('DUPLICATE_REQUEST');
}
function familyInboxFamilyScheduleNext_(body) {
  return familyInboxWorkerRun_('familyInbox.familySchedule.next',body,function(context){
    familyInboxWorkerValidateKeys_(body,{operation:true,workerToken:true,traceId:true});
    const lock=LockService.getScriptLock();lock.waitLock(10000);
    try{
      const ledger=familyInboxOpenLedger_(context.config.spreadsheetId),now=new Date();
      const entry=familyInboxWorkerInboxEntries_(ledger).find(function(e){const r=e.record;
        return r.documentType==='family_schedule'&&r.processingProfile==='family-schedule-v1'&&
          Number(r.attemptCount||0)<3&& (r.status==='pending'||r.status==='processing'&&familyInboxWorkerTime_(r.leaseExpiresAt)<=now.getTime()||
            r.status==='failed'&&familyInboxWorkerBoolean_(r.retryable)&&familyInboxWorkerTime_(r.nextAttemptAt)<=now.getTime());});
      if(!entry)return {inboxId:null};
      const record=entry.record;let meta;
      try{meta=JSON.parse(DriveApp.getFileById(record.originalRef).getDescription());}catch(_){throw familyInboxError_('DATA_INTEGRITY_ERROR');}
      const scheduleContext=familyInboxFamilyScheduleContext_(meta.context);
      if(meta.schemaVersion!=='family-schedule.source.v1'||meta.inboxId!==record.inboxId||meta.homeId!==record.homeId||
        meta.memberId!==record.subjectMemberHint||meta.sha256!==record.sha256)throw familyInboxError_('DATA_INTEGRITY_ERROR');
      const claimVersion=Number(record.claimVersion||0)+1;
      familyInboxWorkerUpdateInbox_(ledger,entry,{status:'processing',claimVersion:claimVersion,claimedBy:context.workerId,
        attemptCount:Number(record.attemptCount||0)+1,processingStartedAt:now.toISOString(),updatedAt:now.toISOString(),
        leaseExpiresAt:new Date(now.getTime()+10*60000).toISOString(),errorCode:'',nextAttemptAt:'',retryable:false});
      return {inboxId:record.inboxId,claimVersion:claimVersion,source:Object.assign({homeId:record.homeId,memberId:record.subjectMemberHint},
        scheduleContext,{sourceFileId:record.originalRef,sourceSha256:record.sha256,inboxId:record.inboxId,mediaType:record.mediaType})};
    } finally{lock.releaseLock();}
  });
}
function familyInboxFamilyScheduleComplete_(body) {
  return familyInboxWorkerRun_('familyInbox.familySchedule.complete',body,function(context){
    familyInboxWorkerValidateKeys_(body,{operation:true,workerToken:true,traceId:true,inboxId:true,claimVersion:true,receipt:true,errorCode:true});
    const claim=familyInboxWorkerClaimInput_(body),lock=LockService.getScriptLock();lock.waitLock(10000);
    try{
      const ledger=familyInboxOpenLedger_(context.config.spreadsheetId),entry=familyInboxWorkerFindInboxEntry_(ledger,claim.inboxId);
      if(!entry||entry.record.documentType!=='family_schedule'||Number(entry.record.claimVersion)!==claim.claimVersion)throw familyInboxError_('CLAIM_CONFLICT');
      if(entry.record.status==='completed'&&!body.errorCode)return {inboxId:claim.inboxId,status:'completed',replayed:true};
      if(entry.record.status!=='processing'||entry.record.claimedBy!==context.workerId)throw familyInboxError_('CLAIM_CONFLICT');
      const failed=!!body.errorCode,receipt=body.receipt;
      if(failed&&!/^[A-Z][A-Z0-9_]{1,63}$/.test(body.errorCode))throw familyInboxError_('INVALID_INPUT');
      if(!failed&&(!familyInboxPlainObject_(receipt)||!/^fsrc_[a-f0-9]{32}$/.test(receipt.sourceId||'')||
        !['APPLIED','REPLAYED'].includes(receipt.status)||receipt.snapshotState!=='ready'||!Number.isInteger(receipt.eventCount)||receipt.eventCount<1||receipt.eventCount>100))throw familyInboxError_('INVALID_INPUT');
      const at=new Date(),retry=failed&&Number(entry.record.attemptCount)<3;
      familyInboxWorkerUpdateInbox_(ledger,entry,{status:failed?'failed':'completed',updatedAt:at.toISOString(),processingCompletedAt:at.toISOString(),
        claimedBy:'',leaseExpiresAt:'',retryable:retry,nextAttemptAt:retry?new Date(at.getTime()+5*60000).toISOString():'',errorCode:failed?body.errorCode:''});
      return {inboxId:claim.inboxId,status:failed?'failed':'completed',retryable:retry};
    }finally{lock.releaseLock();}
  });
}
