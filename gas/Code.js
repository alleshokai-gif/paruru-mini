const SHEET_NAME = '01_Inbox';
const DEBUG = false;
const HEADERS = [
  'id',
  'createdAt',
  'updatedAt',
  'title',
  'memo',
  'category',
  'type',
  'status',
  'priority',
  'dueDate',
  'dueTime',
  'eventStart',
  'eventStartTime',
  'eventEnd',
  'eventEndTime',
  'remindAt',
  'tags',
  'needsFollowup',
  'followupQuestion',
  'followupInputType',
  'aiSummary',
  'aiComment',
  'confidence',
  'source',
  'userId',
  'userDisplayName',
  'calendarSuffix',
  'deviceId',
  'visibility',
  'calendarTitle',
  'calendarSyncStatus',
  'calendarId',
  'calendarEventId',
  'calendarName',
  'calendarSyncedAt',
  'calendarStart',
  'calendarEnd',
  'calendarAllDay',
  'calendarLastError',
];

function doGet(e) {
  try {
    const action = getAction_(e);

    if (action === 'list') {
      return json_({
        success: true,
        data: listInboxItems_(),
        message: 'listed',
      });
    }

    if (action === 'notificationCandidates') {
      return notificationCandidates_(e.parameter || {});
    }

    if (action === 'calendarContextInternal') {
      return calendarContextInternal_(e.parameter || {}, 'GET');
    }

    return json_({
      success: false,
      message: 'unknown action',
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = body.action || 'create';

    if (action === 'createWithAI') {
      return createItemWithAI_(body);
    }

    if (action === 'createWithAIInternal') {
      return createItemWithAIInternal_(body);
    }

    if (action === 'calendarContextInternal') {
      return calendarContextInternal_(body, 'POST');
    }

    if (action === 'agentChat') {
      return agentChat_(body);
    }

    if (action === 'agentActionConfirm') {
      return agentActionConfirm_(body);
    }

    if (action === 'agentActionCancel') {
      return agentActionCancel_(body);
    }

    if (action === 'devicePairingBegin') {
      return devicePairingBegin_(body);
    }

    if (action === 'devicePairingApprove') {
      return devicePairingApprove_(body);
    }

    if (action === 'devicePairingStatus') {
      return devicePairingStatus_(body);
    }

    if (action === 'devicePairingList') {
      return devicePairingList_(body);
    }

    if (action === 'devicePairingRevoke') {
      return devicePairingRevoke_(body);
    }

    if (String(action).indexOf('devicePairing') === 0) {
      return json_({ success: false, data: {}, warnings: [], error: { code: 'UNSUPPORTED_DEVICE_PAIRING_ACTION' }, message: 'unsupported device pairing action' });
    }

    if (action === 'homeAgent') {
      return homeAgent_(body);
    }

    if (action === 'homeAgentAction') {
      return homeAgentAction_(body);
    }

    if (action === 'answerFollowup') {
      return answerFollowup_(body);
    }

    if (action === 'syncCalendar') {
      return syncCalendar_(body);
    }

    if (action === 'updateCalendar') {
      return updateCalendar_(body);
    }

    if (action === 'update') {
      return updateItem_(body);
    }

    if (action === 'delete') {
      return deleteItem_(body);
    }

    return createItem_(body);
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function createItem_(body) {
  const memo = String(body.memo || '').trim();

  if (!memo) {
    return json_({
      success: false,
      message: 'memo is required',
    });
  }

  const itemInput = validateAnalyzedItem_({
    title: body.title || memo.slice(0, 20),
    memo: memo,
    category: body.category || '未分類',
    type: body.type || '',
    status: 'Inbox',
    priority: body.priority || 'Normal',
    dueDate: body.dueDate || '',
    dueTime: body.dueTime || '',
    eventStart: body.eventStart || '',
    eventStartTime: body.eventStartTime || '',
    eventEnd: body.eventEnd || '',
    eventEndTime: body.eventEndTime || '',
    remindAt: body.remindAt || '',
    source: 'PWA',
    tags: normalizeTagsForSheet_(body.tags || ''),
    needsFollowup: normalizeBooleanForSheet_(body.needsFollowup),
    followupQuestion: body.followupQuestion || '',
    followupInputType: getFollowupInputTypeForItem_(body),
    aiSummary: body.aiSummary || '',
    aiComment: body.aiComment || '',
    confidence: normalizeNumberForSheet_(body.confidence),
    userId: body.userId || '',
    userDisplayName: body.userDisplayName || '',
    calendarSuffix: body.calendarSuffix || '',
    deviceId: body.deviceId || '',
    visibility: normalizeVisibility_(body.visibility),
    calendarTitle: body.calendarTitle || '',
    calendarSyncStatus: getInitialCalendarSyncStatus_(body),
    calendarId: '',
    calendarEventId: '',
    calendarName: '',
    calendarSyncedAt: '',
    calendarStart: '',
    calendarEnd: '',
    calendarAllDay: false,
    calendarLastError: '',
    createdAt: nowTokyoString_(),
    updatedAt: nowTokyoString_(),
  });
  itemInput.calendarSyncStatus = getInitialCalendarSyncStatus_(itemInput);
  const item = appendNewItem_(itemInput);

  return json_({
    success: true,
    data: { id: item.id },
    message: 'saved',
  });
}

function createItemWithAI_(body) {
  const memo = String(body.memo || '').trim();

  if (!memo) {
    return json_({
      success: false,
      status: 400,
      message: 'memo is required',
    });
  }

  try {
    return json_({
      success: true,
      item: createItemWithAIResult_(body, memo),
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function createItemWithAIResult_(body, memo, options) {
  const trustedOptions = options || {};
  debugLog_('[createWithAI] received action=createWithAI hasMemo=' + Boolean(memo));
    const analysis = enforceFollowupRules_(analyzeMemoWithAI_(memo), memo);
    const requestedPriority = normalizePriority_(body.priority);
    const now = nowTokyoString_();
    const itemInput = Object.assign({}, analysis, {
      memo: memo,
      category: body.category || analysis.category,
      priority: requestedPriority || analysis.priority,
      status: 'inbox',
      source: trustedOptions.source || 'ai',
      createdAt: now,
      updatedAt: now,
      aiComment: analysis.aiComment || '',
      tags: normalizeTagsForSheet_(analysis.tags || []),
      needsFollowup: normalizeBooleanForSheet_(analysis.needsFollowup),
      followupInputType: getFollowupInputTypeForItem_(analysis),
      eventEnd: analysis.eventEnd || '',
      eventEndTime: analysis.eventEndTime || '',
      remindAt: analysis.remindAt || '',
      confidence: normalizeNumberForSheet_(analysis.confidence),
      userId: body.userId || '',
      userDisplayName: body.userDisplayName || '',
      calendarSuffix: body.calendarSuffix || '',
      deviceId: body.deviceId || '',
      visibility: normalizeVisibility_(body.visibility),
      clientRequestId: trustedOptions.clientRequestId || '',
    });

    itemInput.calendarTitle = body.calendarTitle || '';
    itemInput.calendarSyncStatus = getInitialCalendarSyncStatus_(itemInput);
    itemInput.calendarId = '';
    itemInput.calendarEventId = '';
    itemInput.calendarName = '';
    itemInput.calendarSyncedAt = '';
    itemInput.calendarStart = '';
    itemInput.calendarEnd = '';
    itemInput.calendarAllDay = false;
    itemInput.calendarLastError = '';

    const savedItem = appendNewItem_(itemInput);
    debugLog_('[createWithAI] final priority: ' + savedItem.priority);
    const responseItem = Object.assign({}, analysis, itemInput, savedItem, {
      updatedAt: now,
    });

    return responseItem;
}

function answerFollowup_(body) {
  const id = String(body.id || '').trim();
  const answer = String(body.answer || '').trim();
  const answerDate = String(body.answerDate || '').trim();
  const answerTime = String(body.answerTime || '').trim();
  const providedAnswer = answer || answerDate || answerTime;

  if (!id) {
    return json_({ success: false, status: 400, message: 'id is required' });
  }

  if (!providedAnswer) {
    return json_({ success: false, status: 400, message: 'answer is required' });
  }

  try {
    const target = getItemById_(id);
    if (!target) {
      return json_({ success: false, message: 'not found' });
    }

    const inputType = normalizeFollowupInputType_(
      body.followupInputType || target.item.followupInputType,
      target.item.followupQuestion
    );
    const analysis = answerDate || answerTime
      ? {}
      : analyzeFollowupAnswerWithAI_(target.item, answer);
    const now = nowTokyoString_();
    const updates = buildFollowupUpdates_(target.item, analysis, {
      answer: answer,
      answerDate: answerDate,
      answerTime: answerTime,
      inputType: inputType,
      updatedAt: now,
    });
    updateRowFields_(target.sheet, target.rowNumber, target.index, updates);

    const updatedItem = Object.assign({}, target.item, updates);
    return json_({
      success: true,
      item: updatedItem,
      message: 'followup answered',
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function syncCalendar_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, status: 400, message: 'id is required' });
  }

  const lock = LockService.getScriptLock();
  var target = null;

  try {
    debugLog_('[syncCalendar] start id=' + id + ' target=' + String(body.calendarTarget || 'family'));
    lock.waitLock(10000);
    target = getItemById_(id);
    if (!target) {
      debugLog_('[syncCalendar] item not found id=' + id);
      return json_({ success: false, status: 404, message: 'not found' });
    }

    if (String(target.item.type || '').toLowerCase() !== 'event') {
      debugLog_('[syncCalendar] rejected non-event id=' + id + ' type=' + target.item.type);
      return json_({ success: false, status: 400, message: 'calendar sync requires event item' });
    }

    if (target.item.calendarEventId) {
      const existingStatus = normalizeCalendarSyncStatus_(target.item.calendarSyncStatus);
      debugLog_('[syncCalendar] existing eventId id=' + id + ' status=' + existingStatus);
      if (existingStatus === 'synced') {
        return json_({
          success: true,
          item: buildCalendarResponseItem_(target.item),
          message: 'calendar already synced',
        });
      }

      return json_({
        success: false,
        status: 409,
        message: 'calendar event already exists but is not synced',
      });
    }

    const calendarTarget = normalizeCalendarTarget_(body.calendarTarget || target.item.defaultCalendar || 'family');
    assertRequiredHeaders_(target.index, [
      'calendarTitle',
      'calendarSyncStatus',
      'calendarId',
      'calendarEventId',
      'calendarName',
      'calendarSyncedAt',
      'calendarStart',
      'calendarEnd',
      'calendarAllDay',
      'calendarLastError',
      'status',
      'updatedAt',
    ]);
    const calendarConfig = getCalendarConfig_(calendarTarget);
    debugLog_('[syncCalendar] calendar config loaded target=' + calendarTarget + ' hasId=' + Boolean(calendarConfig.calendarId));
    const calendar = getCalendarByConfig_(calendarConfig);
    const calendarName = calendar.getName();
    debugLog_('[syncCalendar] calendar loaded name=' + calendarName);
    const startDate = String(body.startDate || target.item.eventStart || '').trim();
    const startTime = String(body.startTime || target.item.eventStartTime || '').trim();
    const endDate = String(body.endDate || target.item.eventEnd || startDate).trim();
    const endTime = String(body.endTime || target.item.eventEndTime || '').trim();
    const allDay = normalizeBooleanForSheet_(body.allDay);

    if (!startDate) {
      throw new Error('startDate is required');
    }

    const suffix = getCalendarSuffix_(body, target.item);
    const baseTitle = String(body.calendarTitle || target.item.calendarTitle || target.item.title || target.item.memo || '').trim();
    const calendarTitle = buildCalendarTitle_(baseTitle, suffix);
    if (!calendarTitle) {
      throw new Error('calendarTitle is required');
    }

    var event;
    var calendarStart;
    var calendarEnd;

    if (allDay) {
      const start = parseDateOnly_(startDate);
      const endDateOnly = parseDateOnly_(endDate || startDate);
      if (endDateOnly.getTime() < start.getTime()) {
        throw new Error('終了日は開始日以降にしてな');
      }
      const end = addDays_(endDateOnly, 1);
      event = calendar.createAllDayEvent(calendarTitle, start, end, {
        description: buildCalendarDescription_(id, body, target.item),
      });
      calendarStart = startDate;
      calendarEnd = endDate || startDate;
    } else {
      const startDateTime = parseTokyoDateTime_(startDate, startTime);
      const normalizedEndDate = endDate || startDate;
      const normalizedEndTime = endTime || addMinutesToTime_(startTime, 60);
      const endDateTime = parseTokyoDateTime_(normalizedEndDate, normalizedEndTime);
      if (endDateTime.getTime() <= startDateTime.getTime()) {
        throw new Error('終了日時は開始日時より後にしてな');
      }

      event = calendar.createEvent(calendarTitle, startDateTime, endDateTime, {
        description: buildCalendarDescription_(id, body, target.item),
      });
      calendarStart = startDate + ' ' + startTime;
      calendarEnd = normalizedEndDate + ' ' + normalizedEndTime;
    }

    const calendarEventId = event && event.getId ? event.getId() : '';
    debugLog_('[syncCalendar] event created id=' + id + ' hasEventId=' + Boolean(calendarEventId));
    if (!calendarEventId) {
      throw new Error('calendarEventId was empty after event creation');
    }

    const now = nowTokyoString_();
    const updates = {
      calendarTitle: calendarTitle,
      calendarSyncStatus: 'synced',
      calendarId: calendarConfig.calendarId,
      calendarEventId: calendarEventId,
      calendarName: calendarName,
      calendarSyncedAt: now,
      calendarStart: calendarStart,
      calendarEnd: calendarEnd,
      calendarAllDay: allDay,
      calendarLastError: '',
      status: 'completed',
      updatedAt: now,
    };
    updateRowFields_(target.sheet, target.rowNumber, target.index, updates);
    SpreadsheetApp.flush();
    debugLog_('[syncCalendar] spreadsheet updated id=' + id);

    const savedTarget = getItemById_(id);
    const savedItem = savedTarget && savedTarget.item;
    const savedOk = savedItem &&
      normalizeCalendarSyncStatus_(savedItem.calendarSyncStatus) === 'synced' &&
      String(savedItem.calendarEventId || '').trim() &&
      String(savedItem.status || '').toLowerCase() === 'completed';

    debugLog_('[syncCalendar] final check id=' + id + ' success=' + Boolean(savedOk) + ' status=' + (savedItem && savedItem.calendarSyncStatus));
    if (!savedOk) {
      throw new Error('calendar sync was not persisted');
    }

    return json_({
      success: true,
      item: buildCalendarResponseItem_(savedItem),
      message: 'calendar synced',
    });
  } catch (error) {
    debugLog_('[syncCalendar] failed id=' + id + ' message=' + sanitizeCalendarError_(error));
    if (target) {
      updateRowFields_(target.sheet, target.rowNumber, target.index, {
        calendarSyncStatus: 'failed',
        calendarLastError: sanitizeCalendarError_(error),
        updatedAt: nowTokyoString_(),
      });
    }

    return json_({
      success: false,
      status: 400,
      message: sanitizeCalendarError_(error),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function updateCalendar_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, status: 400, message: 'id is required' });
  }

  const lock = LockService.getScriptLock();
  var target = null;

  try {
    lock.waitLock(10000);
    target = getItemById_(id);
    if (!target) {
      return json_({ success: false, status: 404, message: 'not found' });
    }

    if (!target.item.calendarEventId) {
      return json_({ success: false, status: 400, message: 'calendarEventId is required' });
    }

    const syncStatus = normalizeCalendarSyncStatus_(target.item.calendarSyncStatus);
    if (syncStatus !== 'synced' && syncStatus !== 'update_required') {
      return json_({ success: false, status: 400, message: 'calendar item is not updateable' });
    }

    const calendarTarget = normalizeCalendarTarget_(body.calendarTarget || 'family');
    const calendarConfig = getCalendarConfig_(calendarTarget);
    const calendar = getCalendarByConfig_(calendarConfig);
    const event = calendar.getEventById(target.item.calendarEventId);
    if (!event) {
      const missingMessage = '登録済み予定が見つかりません';
      updateRowFields_(target.sheet, target.rowNumber, target.index, {
        calendarSyncStatus: 'failed',
        calendarLastError: missingMessage,
        updatedAt: nowTokyoString_(),
      });
      return json_({ success: false, status: 404, message: missingMessage });
    }

    const startDate = String(body.startDate || target.item.eventStart || '').trim();
    const startTime = String(body.startTime || target.item.eventStartTime || '').trim();
    const endDate = String(body.endDate || target.item.eventEnd || startDate).trim();
    const endTime = String(body.endTime || target.item.eventEndTime || '').trim();
    const allDay = normalizeBooleanForSheet_(body.allDay);
    if (!startDate) {
      throw new Error('startDate is required');
    }

    const suffix = getCalendarSuffix_(body, target.item);
    const baseTitle = String(body.calendarTitle || target.item.title || target.item.memo || '').trim();
    const calendarTitle = buildCalendarTitle_(baseTitle, suffix);
    if (!calendarTitle) {
      throw new Error('calendarTitle is required');
    }

    var calendarStart;
    var calendarEnd;
    event.setTitle(calendarTitle);
    event.setDescription(buildCalendarDescription_(id, body, target.item));

    if (allDay) {
      const start = parseDateOnly_(startDate);
      const endDateOnly = parseDateOnly_(endDate || startDate);
      if (endDateOnly.getTime() < start.getTime()) {
        throw new Error('終了日は開始日以降にしてな');
      }
      event.setAllDayDates(start, addDays_(endDateOnly, 1));
      calendarStart = startDate;
      calendarEnd = endDate || startDate;
    } else {
      const startDateTime = parseTokyoDateTime_(startDate, startTime);
      const normalizedEndDate = endDate || startDate;
      const normalizedEndTime = endTime || addMinutesToTime_(startTime, 60);
      const endDateTime = parseTokyoDateTime_(normalizedEndDate, normalizedEndTime);
      if (endDateTime.getTime() <= startDateTime.getTime()) {
        throw new Error('終了日時は開始日時より後にしてな');
      }
      event.setTime(startDateTime, endDateTime);
      calendarStart = startDate + ' ' + startTime;
      calendarEnd = normalizedEndDate + ' ' + normalizedEndTime;
    }

    const now = nowTokyoString_();
    const updates = {
      calendarTitle: calendarTitle,
      calendarSyncStatus: 'synced',
      calendarSyncedAt: now,
      calendarStart: calendarStart,
      calendarEnd: calendarEnd,
      calendarAllDay: allDay,
      calendarLastError: '',
      updatedAt: now,
    };
    updateRowFields_(target.sheet, target.rowNumber, target.index, updates);

    return json_({
      success: true,
      item: buildCalendarResponseItem_(Object.assign({}, target.item, updates)),
      message: 'calendar updated',
    });
  } catch (error) {
    if (target) {
      updateRowFields_(target.sheet, target.rowNumber, target.index, {
        calendarSyncStatus: 'failed',
        calendarLastError: sanitizeCalendarError_(error),
        updatedAt: nowTokyoString_(),
      });
    }

    return json_({
      success: false,
      status: 400,
      message: sanitizeCalendarError_(error),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function appendNewItem_(item) {
  const memo = String(item.memo || '').trim();
  const now = nowTokyoString_();
  const createdAt = item.createdAt || now;
  const savedItem = {
    id: Utilities.getUuid(),
    createdAt: createdAt,
    updatedAt: item.updatedAt || createdAt,
    title: item.title || memo.slice(0, 20),
    memo: memo,
    category: item.category || '未分類',
    type: item.type || '',
    status: item.status || 'Inbox',
    priority: item.priority || 'Normal',
    dueDate: item.dueDate || '',
    dueTime: item.dueTime || '',
    eventStart: item.eventStart || '',
    eventStartTime: item.eventStartTime || '',
    eventEnd: item.eventEnd || '',
    eventEndTime: item.eventEndTime || '',
    remindAt: item.remindAt || '',
    tags: normalizeTagsForSheet_(item.tags || ''),
    needsFollowup: normalizeBooleanForSheet_(item.needsFollowup),
    followupQuestion: item.followupQuestion || '',
    followupInputType: getFollowupInputTypeForItem_(item),
    aiSummary: item.aiSummary || '',
    aiComment: item.aiComment || '',
    confidence: normalizeNumberForSheet_(item.confidence),
    source: item.source || 'PWA',
    userId: item.userId || '',
    userDisplayName: item.userDisplayName || '',
    calendarSuffix: item.calendarSuffix || '',
    deviceId: item.deviceId || '',
    visibility: normalizeVisibility_(item.visibility),
    clientRequestId: item.clientRequestId || '',
    calendarTitle: item.calendarTitle || '',
    calendarSyncStatus: item.calendarSyncStatus || getInitialCalendarSyncStatus_(item),
    calendarId: item.calendarId || '',
    _calendarEventId: item.calendarEventId || '',
    calendarName: item.calendarName || '',
    calendarSyncedAt: item.calendarSyncedAt || '',
    calendarStart: item.calendarStart || '',
    calendarEnd: item.calendarEnd || '',
    calendarAllDay: normalizeBooleanForSheet_(item.calendarAllDay),
    calendarLastError: item.calendarLastError || '',
  };

  const sheet = getInboxSheet_();
  const actualHeaders = getActualHeaders_(sheet);
  const row = actualHeaders.map(function(header) {
    return header ? savedItem[header] : '';
  });
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();
  actualHeaders.forEach(function(header, position) {
    if (shouldStoreAsText_(header)) {
      setSheetValueForField_(sheet, rowNumber, position + 1, header, savedItem[header]);
    }
  });

  return savedItem;
}

function updateItem_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, message: 'id is required' });
  }

  const sheet = getInboxSheet_();
  const index = getHeaderIndex_();
  const rowNumber = findRowNumberById_(sheet, id, index.id + 1);
  if (!rowNumber) {
    return json_({ success: false, message: 'not found' });
  }
  const beforeItem = getItemById_(id).item;

  const allowedFields = [
    'updatedAt',
    'title',
    'memo',
    'category',
    'type',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'eventStart',
    'eventStartTime',
    'eventEnd',
    'eventEndTime',
    'remindAt',
    'tags',
    'needsFollowup',
    'followupQuestion',
    'followupInputType',
    'aiSummary',
    'aiComment',
    'confidence',
    'source',
    'userId',
    'userDisplayName',
    'calendarSuffix',
    'deviceId',
    'visibility',
  ];
  if (!Object.prototype.hasOwnProperty.call(body, 'updatedAt')) {
    body.updatedAt = nowTokyoString_();
  }
  const afterItem = Object.assign({}, beforeItem);
  allowedFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      afterItem[field] = normalizeValueForSheet_(field, body[field]);
    }
  });
  const validatedItem = validateAnalyzedItem_(afterItem);
  ['needsFollowup', 'followupQuestion', 'followupInputType'].forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(index, field)) {
      afterItem[field] = validatedItem[field];
    }
  });
  allowedFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(body, field) || field === 'needsFollowup' || field === 'followupQuestion' || field === 'followupInputType') {
      if (Object.prototype.hasOwnProperty.call(index, field)) {
        setSheetValueForField_(sheet, rowNumber, index[field] + 1, field, afterItem[field]);
      }
    }
  });
  if (hasCalendarRelevantChanges_(beforeItem, afterItem)) {
    updateRowFields_(sheet, rowNumber, index, {
      calendarTitle: buildCalendarTitle_(afterItem.title || afterItem.memo || '', getCalendarSuffix_({}, afterItem)),
      calendarSyncStatus: 'update_required',
      calendarLastError: '',
    });
  }

  return json_({
    success: true,
    data: { id: id },
    item: sanitizeItemForClient_(afterItem),
    message: 'updated',
  });
}

function deleteItem_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, message: 'id is required' });
  }

  const sheet = getInboxSheet_();
  const index = getHeaderIndex_();
  const rowNumber = findRowNumberById_(sheet, id, index.id + 1);
  if (!rowNumber) {
    return json_({ success: false, message: 'not found' });
  }

  sheet.deleteRow(rowNumber);

  return json_({
    success: true,
    data: { id: id },
    message: 'deleted',
  });
}

function getItemById_(id) {
  const sheet = getInboxSheet_();
  const index = getHeaderIndex_();
  const rowNumber = findRowNumberById_(sheet, id, index.id + 1);
  if (!rowNumber) {
    return null;
  }

  const headers = getActualHeaders_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const item = {};
  headers.forEach(function(header, position) {
    if (!header) {
      return;
    }
    const value = row[position];
    item[header] = normalizeEngineCellValue_(header, value);
  });

  return {
    sheet: sheet,
    index: index,
    rowNumber: rowNumber,
    item: item,
  };
}

function updateRowFields_(sheet, rowNumber, index, updates) {
  Object.keys(updates).forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(index, field)) {
      setSheetValueForField_(sheet, rowNumber, index[field] + 1, field, updates[field]);
    }
  });
}

function setSheetValueForField_(sheet, rowNumber, columnNumber, field, value) {
  const range = sheet.getRange(rowNumber, columnNumber);
  const normalized = normalizeValueForSheet_(field, value);
  if (shouldStoreAsText_(field)) {
    range.setNumberFormat('@');
    range.setValue(String(normalized || ''));
    return;
  }

  range.setValue(normalized);
}

function shouldStoreAsText_(field) {
  return isDateOnlyHeader_(field) || isTimeOnlyHeader_(field) || field === 'remindAt' || field === 'calendarStart' || field === 'calendarEnd' || field === 'clientRequestId';
}

function assertRequiredHeaders_(index, fields) {
  const missing = fields.filter(function(field) {
    return !Object.prototype.hasOwnProperty.call(index, field);
  });

  if (missing.length > 0) {
    throw new Error('Spreadsheet headers missing: ' + missing.join(', '));
  }
}

function listInboxItems_() {
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const headers = getActualHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      const item = {};
      headers.forEach(function(header, index) {
        if (!header) {
          return;
        }
        const value = row[index];
        item[header] = normalizeEngineCellValue_(header, value);
      });
      return sanitizeItemForClient_(item);
    })
    .reverse();
}

function notificationCandidates_(params) {
  const targetDate = parseNotificationTargetDate_(params.date);
  const limit = normalizeNotificationLimit_(params.limit);
  const userId = String(params.userId || '').trim();
  const settings = buildTodayCalendarSettings_(params);
  const items = readInboxItemsForEngine_();
  const warnings = [];
  const paluruCandidates = buildNotificationCandidates_(items, {
    targetDate: targetDate,
    userId: userId,
    limit: 50,
  });
  let calendarCandidates = [];

  try {
    calendarCandidates = getTodayCalendarEvents_(targetDate, settings)
      .filter(function(event) {
        return isCalendarEventVisible_(event, settings);
      })
      .map(function(event, index) {
        return buildCalendarNotificationCandidate_(event, index);
      });
  } catch (error) {
    warnings.push('calendar_events_unavailable');
    debugLog_('[notificationCandidates] calendar read failed: ' + sanitizeCalendarError_(error));
  }

  const candidates = mergeTodayCandidates_(paluruCandidates, calendarCandidates)
    .slice(0, limit);

  return json_({
    success: true,
    targetDate: targetDate,
    count: candidates.length,
    items: candidates,
    warnings: warnings,
  });
}

function readInboxItemsForEngine_() {
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const headers = getActualHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      const item = {};
      headers.forEach(function(header, index) {
        if (!header) {
          return;
        }
        const value = row[index];
        item[header] = normalizeEngineCellValue_(header, value);
      });
      return item;
    });
}

function buildNotificationCandidates_(items, options) {
  const targetDate = options.targetDate;
  const userId = String(options.userId || '').trim();
  const limit = options.limit || 20;
  const candidates = [];

  items.forEach(function(item, index) {
    if (userId && String(item.userId || '') !== userId) {
      return;
    }

    const reasons = getNotificationReasons_(item, targetDate);
    if (reasons.length === 0) {
      return;
    }

    candidates.push(buildNotificationCandidate_(item, reasons, index));
  });

  return sortNotificationCandidates_(candidates).slice(0, limit);
}

function isNotificationCandidateSource_(item) {
  const status = String(item.status || '').trim().toLowerCase();
  if (isClosedStatus_(status)) {
    return false;
  }

  return status === 'inbox' || status === '';
}

function getNotificationReasons_(item, targetDate) {
  const reasons = [];
  if (!shouldShowInToday_(item, targetDate)) {
    return reasons;
  }

  const type = String(item.type || '').trim().toLowerCase();
  const isShopping = isShoppingNotificationItem_(item);
  const eventStart = normalizeDateOnlyString_(item.eventStart);
  if (type === 'event' && eventStart === targetDate) {
    reasons.push(normalizeTimeForCompare_(item.eventStartTime) ? 'event_today_timed' : 'event_today');
  }

  const dueDate = normalizeDateOnlyString_(item.dueDate);
  if (dueDate) {
    const diffDays = diffDateOnlyDays_(dueDate, targetDate);
    if (diffDays < 0) {
      reasons.push('overdue');
    } else if (diffDays === 0) {
      reasons.push(isShopping ? 'due_today' : (normalizeTimeForCompare_(item.dueTime) ? 'due_today_timed' : 'due_today'));
    } else if (isShopping && diffDays === 1) {
      reasons.push('due_tomorrow');
    } else if (isShopping && diffDays <= 7) {
      reasons.push('due_within_7_days');
    }
  }

  if (getReminderDateOnly_(item) === targetDate) {
    reasons.push('reminder_today');
  }

  if (normalizeBooleanForSheet_(item.needsFollowup)) {
    reasons.push('followup_required');
  }

  const priority = normalizePriority_(item.priority);
  if (priority === 'Urgent') {
    reasons.push('urgent');
  } else if (priority === 'High') {
    reasons.push('high_priority');
  }

  return reasons;
}

function buildNotificationCandidate_(item, reasons, index) {
  const title = String(item.title || item.memo || '無題').trim();
  return {
    sourceType: 'paluru',
    sourceId: item.id || '',
    id: item.id || '',
    title: title,
    cleanTitle: title,
    type: item.type || '',
    category: item.category || '',
    priority: normalizePriority_(item.priority) || item.priority || '',
    memberKey: item.userId || '',
    memberLabel: item.userDisplayName || '',
    dueDate: normalizeDateOnlyString_(item.dueDate),
    dueTime: normalizeTimeForCompare_(item.dueTime),
    eventStart: normalizeDateOnlyString_(item.eventStart),
    eventStartTime: normalizeTimeForCompare_(item.eventStartTime),
    eventEnd: normalizeDateOnlyString_(item.eventEnd),
    eventEndTime: normalizeTimeForCompare_(item.eventEndTime),
    remindAt: item.remindAt || '',
    startAt: buildCandidateDateTimeValue_(item.eventStart, item.eventStartTime),
    endAt: buildCandidateDateTimeValue_(item.eventEnd, item.eventEndTime),
    allDay: !normalizeTimeForCompare_(item.eventStartTime),
    actionable: String(item.type || '').trim().toLowerCase() === 'event',
    requiresUserAction: normalizeBooleanForSheet_(item.needsFollowup),
    calendarEventId: item.calendarEventId || '',
    needsFollowup: normalizeBooleanForSheet_(item.needsFollowup),
    reasons: reasons,
    notificationLevel: getNotificationLevel_(reasons),
    message: buildNotificationMessage_(title, reasons),
    userId: item.userId || '',
    userDisplayName: item.userDisplayName || '',
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
    _sortIndex: index,
  };
}

function sortNotificationCandidates_(items) {
  const reasonOrder = {
    overdue: 0,
    event_today_timed: 1,
    calendar_event_today_timed: 1,
    due_today_timed: 2,
    due_today: 3,
    reminder_today: 4,
    event_today: 5,
    calendar_event_today: 5,
    urgent: 6,
    followup_required: 7,
    due_tomorrow: 8,
    due_within_7_days: 9,
    high_priority: 10,
  };

  return items.sort(function(a, b) {
    const rankA = getNotificationReasonRank_(a.reasons, reasonOrder);
    const rankB = getNotificationReasonRank_(b.reasons, reasonOrder);
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const timeA = getCandidateTimeSortValue_(a);
    const timeB = getCandidateTimeSortValue_(b);
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    const createdA = parseNotificationDateTime_(a.createdAt);
    const createdB = parseNotificationDateTime_(b.createdAt);
    if (createdA !== createdB) {
      return createdB - createdA;
    }

    return a._sortIndex - b._sortIndex;
  }).map(function(item) {
    delete item._sortIndex;
    delete item._calendarEventId;
    return item;
  });
}

function getNotificationReasonRank_(reasons, reasonOrder) {
  return reasons.reduce(function(best, reason) {
    return Math.min(best, reasonOrder[reason]);
  }, 999);
}

function getNotificationLevel_(reasons) {
  if (reasons.indexOf('overdue') !== -1 || reasons.indexOf('urgent') !== -1) {
    return 'critical';
  }

  if (
    reasons.indexOf('due_today') !== -1 ||
    reasons.indexOf('due_today_timed') !== -1 ||
    reasons.indexOf('followup_required') !== -1
  ) {
    return 'high';
  }

  return 'normal';
}

function buildTodayCalendarSettings_(params) {
  const selected = String(params.selectedMemberKeys || 'father,family')
    .split(',')
    .map(function(value) { return String(value || '').trim(); })
    .filter(Boolean);
  return {
    userId: String(params.userId || 'father').trim() || 'father',
    selectedMemberKeys: selected.length > 0 ? selected : ['father', 'family'],
    includeUnknown: String(params.includeUnknown || '').toLowerCase() === 'true',
  };
}

function getTodayCalendarEvents_(targetDate, settings) {
  return CalendarReadService.readNormalizedDay(targetDate)
    .map(function(normalizedEvent) {
      return buildCalendarEventModel_(normalizedEvent, targetDate, settings);
    })
    .filter(function(event) {
      return event !== null;
    });
}

function buildCalendarEventModel_(event, targetDate) {
  const normalized = event && event.start instanceof Date
    ? event
    : CalendarReadService.normalizeEvent(event);
  if (!normalized) return null;
  const rawTitle = normalized.legacyRawTitle;
  const member = parseCalendarMemberTag_(rawTitle);
  const allDay = normalized.allDay;
  const start = normalized.start;
  const end = normalized.end;

  if (!calendarEventOverlapsTargetDate_(start, end, allDay, targetDate)) {
    return null;
  }

  const startDate = Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endDate = Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd');
  const startTime = allDay ? '' : Utilities.formatDate(start, 'Asia/Tokyo', 'HH:mm');
  const endTime = allDay ? '' : Utilities.formatDate(end, 'Asia/Tokyo', 'HH:mm');
  return {
    sourceType: 'google_calendar',
    sourceId: digestCalendarEventId_(normalized.rawEventId || rawTitle + startDate + startTime),
    id: 'gcal:' + digestCalendarEventId_(normalized.rawEventId || rawTitle + startDate + startTime),
    _calendarEventId: normalized.rawEventId,
    title: member.cleanTitle,
    cleanTitle: member.cleanTitle,
    rawTitle: rawTitle,
    type: 'event',
    memberKey: member.memberKey,
    memberLabel: member.memberLabel,
    matched: member.matched,
    eventStart: startDate,
    eventStartTime: startTime,
    eventEnd: endDate,
    eventEndTime: endTime,
    startAt: buildCandidateDateTimeValue_(startDate, startTime),
    endAt: buildCandidateDateTimeValue_(endDate, endTime),
    allDay: allDay,
    actionable: false,
    requiresUserAction: isCalendarEventNotificationCandidate_({
      title: member.cleanTitle,
      memberKey: member.memberKey,
      eventStart: startDate,
      eventStartTime: startTime,
    }),
    reasons: [startTime ? 'calendar_event_today_timed' : 'calendar_event_today'],
    notificationLevel: 'normal',
    message: member.cleanTitle,
    createdAt: '',
    updatedAt: '',
    _sortIndex: 10000 + dateTimeSortKey_(startDate, startTime),
  };
}

function calendarEventOverlapsTargetDate_(start, end, allDay, targetDate) {
  const targetStart = parseDateOnly_(targetDate);
  const targetEnd = new Date(targetStart.getTime());
  targetEnd.setDate(targetEnd.getDate() + 1);
  if (allDay) {
    const startDate = Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd');
    const endDate = Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd');
    return dateOnlyToEpochDay_(startDate) <= dateOnlyToEpochDay_(targetDate) &&
      dateOnlyToEpochDay_(targetDate) < dateOnlyToEpochDay_(endDate);
  }

  return start.getTime() < targetEnd.getTime() && end.getTime() > targetStart.getTime();
}

function parseCalendarMemberTag_(title) {
  const text = String(title || '').trim();
  const memberMap = getCalendarMemberMap_();
  const prefixMatch = text.match(/^[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/);
  const suffixMatch = text.match(/^(.*?)\s*[（(]\s*([^）)]+?)\s*[）)]$/);
  const tokenText = prefixMatch ? prefixMatch[1] : (suffixMatch ? suffixMatch[2] : '');
  const cleanTitle = prefixMatch ? prefixMatch[2] : (suffixMatch ? suffixMatch[1] : text);
  if (!tokenText) {
    return {
      memberKey: 'unknown',
      memberLabel: memberMap.unknown.label,
      cleanTitle: text,
      matched: false,
    };
  }

  const token = normalizeCalendarMemberToken_(tokenText);
  const member = memberMap[token] || memberMap.unknown;
  return {
    memberKey: member.key,
    memberLabel: member.label,
    cleanTitle: String(cleanTitle || '').trim() || text,
    matched: member.key !== 'unknown',
  };
}

function normalizeCalendarMemberToken_(value) {
  const token = String(value || '').trim();
  const aliases = {
    '父': 'father',
    '父ちゃん': 'father',
    '母': 'mother',
    '母ちゃん': 'mother',
    '長男': 'son1',
    '長女': 'daughter1',
    '次男': 'son2',
    '次女': 'daughter2',
    '家族': 'family',
    '全員': 'family',
  };
  return aliases[token] || token;
}

function getCalendarMemberMap_() {
  return {
    father: { key: 'father', label: '父' },
    mother: { key: 'mother', label: '母' },
    son1: { key: 'son1', label: '長男' },
    daughter1: { key: 'daughter1', label: '長女' },
    son2: { key: 'son2', label: '次男' },
    daughter2: { key: 'daughter2', label: '次女' },
    family: { key: 'family', label: '家族' },
    unknown: { key: 'unknown', label: '未分類' },
  };
}

function isCalendarEventVisible_(event, settings) {
  if (event.memberKey === 'unknown') {
    return Boolean(settings.includeUnknown);
  }

  return settings.selectedMemberKeys.indexOf(event.memberKey) !== -1;
}

function isCalendarEventNotificationCandidate_(event) {
  const title = String(event.title || '').trim();
  const actionKeywords = [
    'お迎え',
    '迎え',
    '送迎',
    '通院',
    '病院',
    '学校行事',
    '保護者会',
    '授業参観',
    '予定変更',
  ];
  if (event.memberKey === 'family') {
    return true;
  }

  return actionKeywords.some(function(keyword) {
    return title.indexOf(keyword) !== -1;
  });
}

function buildCalendarNotificationCandidate_(event, index) {
  const candidate = Object.assign({}, event);
  candidate._sortIndex = 10000 + index;
  return candidate;
}

function mergeTodayCandidates_(paluruCandidates, calendarCandidates) {
  const calendarByEventId = {};
  calendarCandidates.forEach(function(candidate) {
    if (candidate._calendarEventId) {
      calendarByEventId[candidate._calendarEventId] = candidate;
    }
  });

  const filteredPaluru = paluruCandidates.filter(function(candidate) {
    if (!candidate._calendarEventId) {
      return true;
    }
    return !calendarByEventId[candidate._calendarEventId];
  });

  const merged = filteredPaluru.slice();
  calendarCandidates.forEach(function(candidate) {
    const duplicate = merged.some(function(existing) {
      return areTodayCandidatesProbablySame_(existing, candidate);
    });
    if (!duplicate) {
      merged.push(candidate);
    }
  });

  return sortNotificationCandidates_(merged);
}

function areTodayCandidatesProbablySame_(left, right) {
  if (left._calendarEventId && right._calendarEventId && left._calendarEventId === right._calendarEventId) {
    return true;
  }

  const leftTitle = normalizeCandidateTitle_(left.cleanTitle || left.title);
  const rightTitle = normalizeCandidateTitle_(right.cleanTitle || right.title);
  if (!leftTitle || leftTitle !== rightTitle) {
    return false;
  }

  return normalizeDateOnlyString_(left.eventStart) === normalizeDateOnlyString_(right.eventStart) &&
    normalizeTimeForCompare_(left.eventStartTime) === normalizeTimeForCompare_(right.eventStartTime);
}

function normalizeCandidateTitle_(title) {
  return String(title || '')
    .replace(/^[（(]\s*[^）)]+?\s*[）)]\s*/, '')
    .replace(/\s*[（(]\s*[^）)]+?\s*[）)]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function buildCandidateDateTimeValue_(dateValue, timeValue) {
  const date = normalizeDateOnlyString_(dateValue);
  if (!date) {
    return '';
  }
  const time = normalizeTimeForCompare_(timeValue);
  return time ? date + ' ' + time : date;
}

function dateTimeSortKey_(dateValue, timeValue) {
  return dateOnlyToEpochDay_(dateValue) * 1440 + getTimeSortMinutes_(timeValue);
}

function getTimeSortMinutes_(timeValue) {
  const match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return 9999;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function digestCalendarEventId_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '').slice(0, 16);
}

function buildNotificationMessage_(title, reasons) {
  if (reasons.indexOf('overdue') !== -1) {
    return title + '、期限過ぎとるよ。僕のせいにはせんといてな。';
  }

  if (reasons.indexOf('due_today') !== -1) {
    return '兄弟、' + title + 'は今日まで。僕は覚えとったよ。';
  }

  if (reasons.indexOf('urgent') !== -1) {
    return '至急やで。' + title + '、先に見といて。';
  }

  if (reasons.indexOf('followup_required') !== -1) {
    return title + '、まだ確認が残っとるよ。答えとく？';
  }

  if (reasons.indexOf('due_tomorrow') !== -1) {
    return title + 'は明日まで。今日のうちにやっとく？';
  }

  if (reasons.indexOf('due_within_7_days') !== -1) {
    return title + 'は1週間以内。忘れんうちに見といてな。';
  }

  if (reasons.indexOf('high_priority') !== -1) {
    return title + '、優先度高め。忘れたら僕が見てたって言うよ。';
  }

  return title + '、確認しといてな。';
}

function shouldShowInToday_(item, targetDate) {
  if (!isNotificationCandidateSource_(item)) {
    return false;
  }

  if (normalizeDateOnlyString_(item.eventStart) === targetDate) {
    return true;
  }

  const dueDate = normalizeDateOnlyString_(item.dueDate);
  if (dueDate) {
    const diffDays = diffDateOnlyDays_(dueDate, targetDate);
    if (diffDays <= 0) {
      return true;
    }
    if (isShoppingNotificationItem_(item) && diffDays <= 7) {
      return true;
    }
  }

  if (getReminderDateOnly_(item) === targetDate) {
    return true;
  }

  return normalizeBooleanForSheet_(item.needsFollowup);
}

function isShoppingNotificationItem_(item) {
  const type = String(item && item.type || '').trim().toLowerCase();
  return ['shopping', '買い物', 'purchase', 'buy'].indexOf(type) !== -1;
}

function isClosedStatus_(status) {
  return ['done', 'completed', 'complete', 'cancelled', 'canceled', 'deleted'].indexOf(String(status || '').trim().toLowerCase()) !== -1;
}

function getReminderDateOnly_(item) {
  const reminderDate = normalizeDateOnlyString_(item.reminderDate);
  if (reminderDate) {
    return reminderDate;
  }

  const match = String(item.remindAt || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function getReminderTimeOnly_(item) {
  const reminderTime = normalizeTimeForCompare_(item.reminderTime);
  if (reminderTime) {
    return reminderTime;
  }

  const match = String(item.remindAt || '').trim().match(/(?:T| )(\d{1,2}):(\d{2})/);
  return match ? match[1].padStart(2, '0') + ':' + match[2] : '';
}

function getCandidateTimeSortValue_(candidate) {
  const time = candidate.eventStartTime || candidate.dueTime || getReminderTimeOnly_(candidate);
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return 9999;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatDateJa_(dateValue) {
  const normalized = normalizeDateOnlyString_(dateValue);
  if (!normalized) {
    return '';
  }

  const parts = normalized.split('-');
  return Number(parts[1]) + '/' + Number(parts[2]);
}

function formatTimeJa_(timeValue) {
  return normalizeTimeForCompare_(timeValue);
}

function formatItemDateTime_(item) {
  const type = String(item.type || '').trim().toLowerCase();
  if (type === 'event' && normalizeDateOnlyString_(item.eventStart)) {
    const start = [formatDateJa_(item.eventStart), formatTimeJa_(item.eventStartTime)].filter(Boolean).join(' ');
    const end = normalizeDateOnlyString_(item.eventEnd)
      ? [formatDateJa_(item.eventEnd), formatTimeJa_(item.eventEndTime)].filter(Boolean).join(' ')
      : '';
    return end ? start + '〜' + end : start;
  }

  if (type === 'task' && normalizeDateOnlyString_(item.dueDate)) {
    return [formatDateJa_(item.dueDate), formatTimeJa_(item.dueTime)].filter(Boolean).join(' ');
  }

  if (type === 'reminder') {
    return [formatDateJa_(getReminderDateOnly_(item)), formatTimeJa_(getReminderTimeOnly_(item))].filter(Boolean).join(' ');
  }

  return '';
}

function parseNotificationTargetDate_(value) {
  if (!value) {
    return todayTokyoDateString_();
  }

  const normalized = normalizeDateOnlyString_(value);
  if (!normalized) {
    throw new Error('date must be yyyy-MM-dd');
  }

  return normalized;
}

function normalizeNotificationLimit_(value) {
  const numberValue = Number(value || 20);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return 20;
  }

  return Math.min(Math.floor(numberValue), 50);
}

function normalizeEngineCellValue_(header, value) {
  if (value instanceof Date) {
    if (isDateOnlyHeader_(header)) {
      return normalizeDateForSheet_(value);
    }

    if (isTimeOnlyHeader_(header)) {
      return normalizeTimeForSheet_(value);
    }

    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }

  return value;
}

function isDateOnlyHeader_(header) {
  return [
    'dueDate',
    'eventStart',
    'eventEnd',
  ].indexOf(header) !== -1;
}

function isTimeOnlyHeader_(header) {
  return [
    'dueTime',
    'eventStartTime',
    'eventEndTime',
  ].indexOf(header) !== -1;
}

function normalizeDateOnlyString_(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function todayTokyoDateString_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function diffDateOnlyDays_(leftDate, rightDate) {
  return dateOnlyToEpochDay_(leftDate) - dateOnlyToEpochDay_(rightDate);
}

function dateOnlyToEpochDay_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function parseNotificationDateTime_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    ).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function getAction_(e) {
  if (!e || !e.parameter) {
    return '';
  }

  return String(e.parameter.action || '');
}

function getInboxSheet_() {
  const spreadsheet = getOrCreateSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeader_(sheet);
  return sheet;
}

function getOrCreateSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureHeader_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const currentHeaders = firstRow.filter(function(header) {
    return header;
  });

  if (currentHeaders.length === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  const missingHeaders = HEADERS.filter(function(header) {
    return currentHeaders.indexOf(header) === -1;
  });

  if (missingHeaders.length > 0) {
    sheet
      .getRange(1, lastColumn + 1, 1, missingHeaders.length)
      .setValues([missingHeaders]);
    sheet.setFrozenRows(1);
  }
}

function getHeaderIndex_() {
  const sheet = getInboxSheet_();
  return getActualHeaders_(sheet).reduce(function(index, header, position) {
    if (header) {
      index[header] = position;
    }
    return index;
  }, {});
}

function getActualHeaders_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
}

function findRowNumberById_(sheet, id, idColumnNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return 0;
  }

  const ids = sheet.getRange(2, idColumnNumber, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      return i + 2;
    }
  }

  return 0;
}

function hasCalendarRelevantChanges_(beforeItem, afterItem) {
  if (!beforeItem || !afterItem) {
    return false;
  }

  if (!beforeItem.calendarEventId) {
    return false;
  }

  const syncStatus = normalizeCalendarSyncStatus_(beforeItem.calendarSyncStatus);
  if (syncStatus !== 'synced' && syncStatus !== 'update_required') {
    return false;
  }

  const relevantFields = [
    'title',
    'eventStart',
    'eventStartTime',
    'eventEnd',
    'eventEndTime',
    'userId',
    'calendarSuffix',
  ];

  return relevantFields.some(function(field) {
    return normalizeCalendarComparableValue_(field, beforeItem[field]) !==
      normalizeCalendarComparableValue_(field, afterItem[field]);
  }) ||
    buildExpectedCalendarTitle_(beforeItem) !== buildExpectedCalendarTitle_(afterItem);
}

function normalizeCalendarComparableValue_(field, value) {
  if (field === 'eventStartTime' || field === 'eventEndTime') {
    return normalizeTimeForCompare_(value);
  }

  return String(value || '').trim();
}

function normalizeTimeForCompare_(value) {
  return normalizeTimeInput_(value);
}

function buildExpectedCalendarTitle_(item) {
  return buildCalendarTitle_(item.title || item.memo || '', getCalendarSuffix_({}, item));
}

function getInitialCalendarSyncStatus_(item) {
  const type = String(item.type || '').trim().toLowerCase();
  if (item.calendarSyncStatus) {
    return normalizeCalendarSyncStatus_(item.calendarSyncStatus);
  }

  return type === 'event' ? 'pending' : 'not_required';
}

function normalizeCalendarSyncStatus_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = [
    'not_required',
    'pending',
    'synced',
    'failed',
    'update_required',
    'deleted',
  ];

  return allowed.indexOf(normalized) !== -1 ? normalized : 'pending';
}

function normalizeVisibility_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = ['private', 'family', 'shared'];
  return allowed.indexOf(normalized) !== -1 ? normalized : 'private';
}

function normalizeCalendarTarget_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = ['family', 'personal', 'shared'];
  return allowed.indexOf(normalized) !== -1 ? normalized : 'family';
}

function getCalendarConfig_(calendarTarget) {
  const target = normalizeCalendarTarget_(calendarTarget);
  const propertyMap = {
    family: 'PALURU_FAMILY_CALENDAR_ID',
    personal: 'PALURU_PERSONAL_CALENDAR_ID',
    shared: 'PALURU_SHARED_CALENDAR_ID',
  };
  const propertyKey = propertyMap[target] || propertyMap.family;
  const calendarId = PropertiesService
    .getScriptProperties()
    .getProperty(propertyKey);

  if (!calendarId) {
    throw new Error(propertyKey + ' がScript Propertiesに設定されてへんで');
  }

  return {
    target: target,
    propertyKey: propertyKey,
    calendarId: calendarId,
  };
}

function getCalendarByConfig_(config) {
  const calendar = CalendarApp.getCalendarById(config.calendarId);
  if (!calendar) {
    throw new Error('登録先カレンダーが見つからへんで。権限かScript Propertiesを確認してな');
  }

  return calendar;
}

function getCalendarSuffix_(body, item) {
  const explicitSuffix = String(body.calendarSuffix || '').trim();
  if (explicitSuffix) {
    return explicitSuffix;
  }

  const storedSuffix = String(item.calendarSuffix || '').trim();
  if (storedSuffix) {
    return storedSuffix;
  }

  const displayName = String(body.userDisplayName || item.userDisplayName || '').trim();
  return displayName ? '（' + displayName + '）' : '';
}

function buildCalendarTitle_(title, suffix) {
  const baseTitle = String(title || '').trim();
  const normalizedSuffix = String(suffix || '').trim();
  if (!baseTitle || !normalizedSuffix) {
    return baseTitle;
  }

  if (baseTitle.endsWith(normalizedSuffix)) {
    return baseTitle;
  }

  return baseTitle + normalizedSuffix;
}

function parseDateOnly_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('日付はyyyy-MM-dd形式で指定してな');
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseTokyoDateTime_(dateValue, timeValue) {
  const dateMatch = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    throw new Error('日時はyyyy-MM-ddとHH:mm形式で指定してな');
  }

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2])
  );
}

function addDays_(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutesToTime_(timeValue, minutesToAdd) {
  const match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error('終了時刻を指定してな');
  }

  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + minutesToAdd;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function buildCalendarDescription_(id, body, item) {
  return [
    'PALURU Miniから登録',
    'PALURU ID: ' + id,
    '登録者: ' + (body.userDisplayName || item.userDisplayName || ''),
  ].join('\n');
}

function buildCalendarResponseItem_(item) {
  return {
    id: item.id,
    status: item.status,
    title: item.title,
    type: item.type,
    eventStart: item.eventStart,
    eventStartTime: item.eventStartTime,
    eventEnd: item.eventEnd,
    eventEndTime: item.eventEndTime,
    calendarTitle: item.calendarTitle,
    calendarSyncStatus: item.calendarSyncStatus,
    calendarEventId: item.calendarEventId,
    calendarName: item.calendarName,
    calendarSyncedAt: item.calendarSyncedAt,
    calendarStart: item.calendarStart,
    calendarEnd: item.calendarEnd,
    calendarAllDay: item.calendarAllDay,
    calendarLastError: item.calendarLastError || '',
  };
}

function sanitizeItemForClient_(item) {
  const clientItem = Object.assign({}, item);
  delete clientItem.calendarId;
  return clientItem;
}

function sanitizeCalendarError_(error) {
  const message = String(error && error.message ? error.message : error || 'calendar sync failed');
  return message
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .slice(0, 180);
}

function normalizeTagsForSheet_(tags) {
  if (Array.isArray(tags)) {
    return JSON.stringify(tags);
  }

  if (tags && typeof tags === 'object') {
    return JSON.stringify(tags);
  }

  return tags || '';
}

function normalizeBooleanForSheet_(value) {
  if (value === true || value === false) {
    return value;
  }

  if (value === 'true' || value === 'TRUE') {
    return true;
  }

  if (value === 'false' || value === 'FALSE') {
    return false;
  }

  return false;
}

function normalizeNumberForSheet_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return '';
  }

  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? '' : numberValue;
}

function normalizeValueForSheet_(field, value) {
  if (field === 'tags') {
    return normalizeTagsForSheet_(value);
  }

  if (isDateOnlyHeader_(field)) {
    return normalizeDateForSheet_(value);
  }

  if (isTimeOnlyHeader_(field)) {
    return normalizeTimeForSheet_(value);
  }

  if (field === 'needsFollowup') {
    return normalizeBooleanForSheet_(value);
  }

  if (field === 'calendarAllDay') {
    return normalizeBooleanForSheet_(value);
  }

  if (field === 'confidence') {
    return normalizeNumberForSheet_(value);
  }

  if (field === 'visibility') {
    return normalizeVisibility_(value);
  }

  if (field === 'calendarSyncStatus') {
    return normalizeCalendarSyncStatus_(value);
  }

  if (field === 'followupInputType') {
    if (!value) {
      return '';
    }
    return normalizeFollowupInputType_(value, '');
  }

  return value;
}

function normalizeDateForSheet_(value) {
  if (value instanceof Date) {
    const year = Number(Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy'));
    if (year <= 1900) {
      return '';
    }
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  const text = String(value || '').trim();
  const direct = normalizeDateOnlyString_(text);
  if (direct) {
    return direct;
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ]/);
  if (match && Number(match[1]) > 1900) {
    return match[1] + '-' + match[2] + '-' + match[3];
  }

  return '';
}

function normalizeTimeForSheet_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'HH:mm');
  }

  const text = String(value || '').trim();
  const direct = normalizeTimeInput_(text);
  if (direct) {
    return direct;
  }

  const match = text.match(/(?:T| )(\d{1,2}):(\d{2})/);
  return match ? match[1].padStart(2, '0') + ':' + match[2] : '';
}

function normalizeTimeInput_(value) {
  const text = normalizeAsciiDigits_(String(value || '').trim())
    .replace(/[：]/g, ':')
    .replace(/\s+/g, ' ');
  if (!text) {
    return '';
  }

  const isoMatch = text.match(/(?:T| )(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return normalizeHourMinute_(isoMatch[1], isoMatch[2], /pm/i.test(text), /am/i.test(text));
  }

  const colonMatch = text.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (colonMatch) {
    return normalizeHourMinute_(colonMatch[1], colonMatch[2], /^pm$/i.test(colonMatch[3] || ''), /^am$/i.test(colonMatch[3] || ''));
  }

  const jpMatch = text.match(/^(?:午(前|後)\s*)?(\d{1,2})\s*(?:時|じ)\s*(\d{1,2})?\s*(?:分)?/);
  if (jpMatch) {
    return normalizeHourMinute_(jpMatch[2], jpMatch[3] || '00', jpMatch[1] === '後', jpMatch[1] === '前');
  }

  const digitsMatch = text.match(/^(\d{3,4})$/);
  if (digitsMatch) {
    const digits = digitsMatch[1].padStart(4, '0');
    return normalizeHourMinute_(digits.slice(0, 2), digits.slice(2, 4), false, false);
  }

  return '';
}

function normalizeAsciiDigits_(value) {
  return String(value || '').replace(/[０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
}

function normalizeHourMinute_(hourValue, minuteValue, isPm, isAm) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return '';
  }
  if (isPm && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  if (isAm && hour === 12) {
    hour = 0;
  }
  if (hour < 0 || hour > 23) {
    return '';
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function normalizePriority_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const priorities = {
    low: 'Low',
    normal: 'Normal',
    high: 'High',
    urgent: 'Urgent',
  };

  return priorities[normalized] || '';
}

function normalizeFollowupInputType_(value, question) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowedTypes = ['date', 'datetime', 'time', 'text', 'yesno'];
  if (allowedTypes.indexOf(normalized) !== -1) {
    return normalized;
  }

  return inferFollowupInputType_(question);
}

function getFollowupInputTypeForItem_(item) {
  if (!normalizeBooleanForSheet_(item.needsFollowup) || !item.followupQuestion) {
    return '';
  }

  return normalizeFollowupInputType_(item.followupInputType, item.followupQuestion);
}

function validateAnalyzedItem_(item) {
  const validated = Object.assign({}, item);
  const type = String(validated.type || '').trim().toLowerCase();

  validated.dueDate = normalizeDateForSheet_(validated.dueDate);
  validated.dueTime = normalizeTimeForSheet_(validated.dueTime);
  validated.eventStart = normalizeDateForSheet_(validated.eventStart);
  validated.eventStartTime = normalizeTimeForSheet_(validated.eventStartTime);
  validated.eventEnd = normalizeDateForSheet_(validated.eventEnd);
  validated.eventEndTime = normalizeTimeForSheet_(validated.eventEndTime);

  if (type === 'task') {
    if (!validated.dueDate) {
      validated.needsFollowup = true;
      validated.followupQuestion = validated.followupQuestion || 'いつまでにやる？';
      validated.followupInputType = 'date';
    } else if (!validated.followupQuestion) {
      validated.needsFollowup = normalizeBooleanForSheet_(validated.needsFollowup);
      validated.followupInputType = getFollowupInputTypeForItem_(validated);
    }
  } else if (type === 'event') {
    if (validated.eventStart) {
      validated.needsFollowup = false;
      validated.followupQuestion = '';
      validated.followupInputType = '';
    } else {
      validated.needsFollowup = true;
      validated.followupQuestion = validated.followupQuestion || 'いつの予定？';
      validated.followupInputType = 'date';
    }
  } else if (type === 'reminder') {
    if (validated.remindAt || getReminderDateOnly_(validated)) {
      validated.needsFollowup = false;
      validated.followupQuestion = '';
      validated.followupInputType = '';
    } else {
      validated.needsFollowup = true;
      validated.followupQuestion = validated.followupQuestion || 'いつ通知する？';
      validated.followupInputType = 'datetime';
    }
  } else {
    validated.needsFollowup = normalizeBooleanForSheet_(validated.needsFollowup);
    validated.followupInputType = getFollowupInputTypeForItem_(validated);
  }

  return validated;
}

function inferFollowupInputType_(question) {
  const text = String(question || '');

  if (
    text.indexOf('何日の何時') !== -1 ||
    /いつ.*何時/.test(text) ||
    /日付.*時刻/.test(text) ||
    /訪問日.*何時/.test(text) ||
    text.indexOf('いつ通知') !== -1
  ) {
    return 'datetime';
  }

  if (
    text.indexOf('何時') !== -1 ||
    text.indexOf('時刻') !== -1 ||
    text.indexOf('何時まで') !== -1 ||
    text.indexOf('何時から') !== -1
  ) {
    return 'time';
  }

  if (
    text.indexOf('締切') !== -1 ||
    text.indexOf('いつまで') !== -1 ||
    text.indexOf('何日') !== -1 ||
    text.indexOf('予定日') !== -1 ||
    text.indexOf('いつ') !== -1
  ) {
    return 'date';
  }

  if (
    text.indexOf('はい') !== -1 ||
    text.indexOf('いいえ') !== -1 ||
    text.indexOf('必要') !== -1 ||
    text.indexOf('実行する') !== -1 ||
    text.indexOf('通知する') !== -1
  ) {
    return 'yesno';
  }

  return 'text';
}

function enforceFollowupRules_(analysis, memo) {
  const normalizedAnalysis = Object.assign({}, analysis);
  const isImportantWorkTask = isImportantWorkTaskMemo_(memo);

  if (isImportantWorkTask) {
    normalizedAnalysis.category = '仕事';
    normalizedAnalysis.type = 'task';
  }

  if (isWorkTaskMissingDue_(normalizedAnalysis, memo)) {
    normalizedAnalysis.needsFollowup = true;
    normalizedAnalysis.followupQuestion = normalizedAnalysis.followupQuestion || '締切はいつ？';
  }

  normalizedAnalysis.followupInputType = getFollowupInputTypeForItem_(normalizedAnalysis);

  return validateAnalyzedItem_(normalizedAnalysis);
}

function isImportantWorkTaskMemo_(memo) {
  const text = String(memo || '');
  const workSignals = [
    '部長',
    '課長',
    '上司',
    '社長',
    '会社',
    '顧客',
    '取引先',
    '資料',
    'メール',
    '会議',
    '出張',
  ];
  const taskSignals = [
    '送る',
    '提出',
    '共有',
    '確認',
    '作る',
    '修正',
    '連絡',
    '返信',
  ];

  return workSignals.some(function(keyword) {
    return text.indexOf(keyword) !== -1;
  }) && taskSignals.some(function(keyword) {
    return text.indexOf(keyword) !== -1;
  });
}

function isWorkTaskMissingDue_(analysis, memo) {
  if (analysis.category !== '仕事' || analysis.type !== 'task') {
    return false;
  }

  if (analysis.dueDate || analysis.dueTime) {
    return false;
  }

  const text = String(memo || '');
  const importantWorkKeywords = [
    '部長',
    '課長',
    '上司',
    '社長',
    '会社',
    '顧客',
    '取引先',
    '資料',
    'メール',
    '送る',
    '提出',
    '共有',
    '確認',
    '会議',
    '出張',
  ];

  return importantWorkKeywords.some(function(keyword) {
    return text.indexOf(keyword) !== -1;
  });
}

function analyzeFollowupAnswerWithAI_(item, answer) {
  const context = [
    'Follow-up回答の再解析です。',
    '回答単独を新規メモとして扱わず、必ず元アイテムの文脈と確認質問への回答として解析してください。',
    '既存JSON schemaで出力してください。',
    '元データは維持し、回答で確定した項目だけ反映できる値にしてください。',
    '',
    '元memo: ' + (item.memo || ''),
    '元title: ' + (item.title || ''),
    '元type: ' + (item.type || ''),
    '元category: ' + (item.category || ''),
    '元dueDate: ' + (item.dueDate || ''),
    '元dueTime: ' + (item.dueTime || ''),
    '元eventStart: ' + (item.eventStart || ''),
    '元eventStartTime: ' + (item.eventStartTime || ''),
    'followupQuestion: ' + (item.followupQuestion || ''),
    'followupInputType: ' + (item.followupInputType || ''),
    'answer: ' + answer,
    '',
    '重要:',
    '・answerが「明日」「来週」など相対表現なら現在日時基準で日付化する',
    '・締切への回答ならdueDate/dueTimeを更新する',
    '・予定日時への回答ならeventStart/eventStartTimeを更新する',
    '・回答で確認が解決したらneedsFollowupはfalse、followupQuestionは空文字にする',
  ].join('\n');

  return analyzeMemoWithAI_(context);
}

function buildFollowupUpdates_(item, analysis, context) {
  const updates = {
    updatedAt: context.updatedAt,
    needsFollowup: false,
    followupQuestion: '',
    followupInputType: '',
  };

  if (typeof analysis.confidence !== 'undefined') {
    updates.confidence = normalizeNumberForSheet_(analysis.confidence);
  }

  applyDirectFollowupAnswer_(updates, item, context);

  [
    'dueDate',
    'dueTime',
    'eventStart',
    'eventStartTime',
    'eventEnd',
    'eventEndTime',
    'remindAt',
    'aiSummary',
  ].forEach(function(field) {
    if (!updates[field] && analysis[field]) {
      updates[field] = analysis[field];
    }
  });

  if (!item.type && analysis.type) {
    updates.type = analysis.type;
  }

  if (!item.category && analysis.category) {
    updates.category = analysis.category;
  }

  if (!item.title && analysis.title) {
    updates.title = analysis.title;
  }

  if (Array.isArray(analysis.tags) && analysis.tags.length > 0) {
    updates.tags = normalizeTagsForSheet_(analysis.tags);
  }

  if (analysis.needsFollowup === true && String(analysis.followupQuestion || '').trim()) {
    updates.needsFollowup = true;
    updates.followupQuestion = String(analysis.followupQuestion).trim();
    updates.followupInputType = normalizeFollowupInputType_(
      analysis.followupInputType,
      updates.followupQuestion
    );
  }

  const finalItem = Object.assign({}, item, analysis, updates);
  const validatedFinalItem = validateAnalyzedItem_(finalItem);
  updates.needsFollowup = normalizeBooleanForSheet_(validatedFinalItem.needsFollowup);
  updates.followupQuestion = updates.needsFollowup ? String(validatedFinalItem.followupQuestion || '') : '';
  updates.followupInputType = updates.needsFollowup
    ? getFollowupInputTypeForItem_(validatedFinalItem)
    : '';

  const resolvedSummary = buildResolvedFollowupSummary_(Object.assign({}, finalItem, updates));
  if (resolvedSummary) updates.aiSummary = resolvedSummary;

  return updates;
}

function buildResolvedFollowupSummary_(item) {
  const type = String(item.type || '').trim().toLowerCase();
  const subject = buildFollowupSummarySubject_(item);
  if (!subject) return '';

  if (type === 'task' && normalizeDateOnlyString_(item.dueDate)) {
    const due = formatFollowupDateTimeSummary_(item.dueDate, item.dueTime);
    return subject + '。締切は' + due + 'です。';
  }
  if (type === 'event' && normalizeDateOnlyString_(item.eventStart)) {
    const start = formatFollowupDateTimeSummary_(item.eventStart, item.eventStartTime);
    return subject + '。予定は' + start + 'です。';
  }
  if (type === 'reminder' && getReminderDateOnly_(item)) {
    const reminder = formatFollowupDateTimeSummary_(getReminderDateOnly_(item), getReminderTimeOnly_(item));
    return subject + '。通知は' + reminder + 'です。';
  }
  return '';
}

function buildFollowupSummarySubject_(item) {
  return String(item.title || item.memo || '')
    .replace(/[。．.!！]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function formatFollowupDateTimeSummary_(dateValue, timeValue) {
  const normalizedDate = normalizeDateOnlyString_(dateValue);
  if (!normalizedDate) return '';
  const parts = normalizedDate.split('-');
  const dateText = Number(parts[1]) + '月' + Number(parts[2]) + '日';
  const normalizedTime = normalizeTimeForSheet_(timeValue);
  return normalizedTime ? dateText + ' ' + normalizedTime : dateText;
}

function applyDirectFollowupAnswer_(updates, item, context) {
  const question = String(item.followupQuestion || '');
  const inputType = context.inputType;

  if (context.answerDate) {
    if (isReminderQuestion_(question)) {
      updates.remindAt = joinDateTime_(context.answerDate, context.answerTime);
    } else if (isEventQuestion_(question, item)) {
      updates.eventStart = context.answerDate;
    } else {
      updates.dueDate = context.answerDate;
    }
  }

  if (context.answerTime) {
    if (isReminderQuestion_(question)) {
      updates.remindAt = joinDateTime_(context.answerDate || item.dueDate || item.eventStart, context.answerTime);
    } else if (isEventQuestion_(question, item) || inputType === 'datetime') {
      updates.eventStartTime = context.answerTime;
    } else {
      updates.dueTime = context.answerTime;
    }
  }

  if (inputType === 'yesno' && context.answer) {
    updates.aiComment = 'Follow-up回答: ' + context.answer;
  }
}

function isEventQuestion_(question, item) {
  const text = question + ' ' + String(item.memo || '') + ' ' + String(item.type || '');
  return (
    text.indexOf('訪問') !== -1 ||
    text.indexOf('予定') !== -1 ||
    text.indexOf('授業参観') !== -1 ||
    text.indexOf('何時から') !== -1 ||
    text.indexOf('event') !== -1
  );
}

function isReminderQuestion_(question) {
  return (
    question.indexOf('通知') !== -1 ||
    question.indexOf('リマインド') !== -1 ||
    question.indexOf('知らせ') !== -1
  );
}

function joinDateTime_(dateValue, timeValue) {
  if (dateValue && timeValue) {
    return dateValue + ' ' + timeValue;
  }

  return dateValue || timeValue || '';
}

function nowTokyoString_() {
  return Utilities.formatDate(
    new Date(),
    'Asia/Tokyo',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function debugLog_(message) {
  if (DEBUG) {
    Logger.log(message);
  }
}

function testOpenAIConnection() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されてへんで');
  }

  const url = 'https://api.openai.com/v1/responses';

  const payload = {
    model: 'gpt-5.5',
    input: 'あなたはAI秘書ぱるるです。「接続成功やで」とだけ返してください。',
    max_output_tokens: 50
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  console.log('HTTP Status: ' + statusCode);
  console.log(responseText);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      'OpenAI APIエラー\n' +
      'HTTP Status: ' + statusCode + '\n' +
      responseText
    );
  }

  const data = JSON.parse(responseText);
  const outputText = extractOpenAIOutputText_(data);

  console.log('ぱるる: ' + outputText);

  return outputText;
}


function extractOpenAIOutputText_(responseData) {
  const output = responseData.output || [];

  for (const item of output) {
    if (item.type !== 'message') continue;

    const content = item.content || [];

    for (const part of content) {
      if (part.type === 'output_text' && part.text) {
        return part.text;
      }
    }
  }

  throw new Error('OpenAIの応答本文が見つからへんかった');
}

function testPaluruAIAnalysis() {
  const memo = '7月20日13時半から授業参観';

  const result = analyzeMemoWithAI_(memo);

  console.log('AI解析結果');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

function testCreateItemWithAI_() {
  const response = createItemWithAI_({
    memo: '7月20日13時半から授業参観',
  });
  const result = JSON.parse(response.getContent());

  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.item) {
    console.log(JSON.stringify({
      id: result.item.id,
      title: result.item.title,
      category: result.item.category,
      type: result.item.type,
      eventStart: result.item.eventStart,
      eventStartTime: result.item.eventStartTime,
      aiSummary: result.item.aiSummary,
      confidence: result.item.confidence,
    }, null, 2));
  }

  return result;
}

function testWorkTaskFollowup_() {
  const memo = '部長へ資料を送る';
  const analysis = enforceFollowupRules_(analyzeMemoWithAI_(memo), memo);
  const result = {
    memo: memo,
    title: analysis.title,
    category: analysis.category,
    type: analysis.type,
    dueDate: analysis.dueDate,
    dueTime: analysis.dueTime,
    needsFollowup: analysis.needsFollowup,
    followupQuestion: analysis.followupQuestion,
  };

  console.log(JSON.stringify(result, null, 2));

  if (
    result.category !== '仕事' ||
    result.type !== 'task' ||
    result.dueDate ||
    result.dueTime ||
    result.needsFollowup !== true ||
    !result.followupQuestion
  ) {
    throw new Error('仕事taskの期限確認テストが期待値になってへんで');
  }

  return result;
}

function migrateSyncedEventsToCompleted_() {
  const sheet = getInboxSheet_();
  const headers = getActualHeaders_(sheet);
  const index = getHeaderIndex_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.log('対象件数: 0');
    return { targetCount: 0, updatedCount: 0 };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const targetRows = [];
  values.forEach(function(row, offset) {
    const item = {};
    headers.forEach(function(header, position) {
      if (header) {
        item[header] = row[position];
      }
    });

    if (
      String(item.type || '').toLowerCase() === 'event' &&
      String(item.status || '').toLowerCase() === 'inbox' &&
      String(item.calendarSyncStatus || '').toLowerCase() === 'synced' &&
      String(item.calendarEventId || '').trim()
    ) {
      targetRows.push(offset + 2);
    }
  });

  console.log('対象件数: ' + targetRows.length);
  targetRows.forEach(function(rowNumber) {
    updateRowFields_(sheet, rowNumber, index, {
      status: 'completed',
      updatedAt: nowTokyoString_(),
    });
  });
  console.log('更新件数: ' + targetRows.length);

  return {
    targetCount: targetRows.length,
    updatedCount: targetRows.length,
  };
}

function testNotificationCandidates_() {
  const targetDate = '2026-07-13';
  const sampleItems = [
    {
      id: 'A',
      status: 'inbox',
      type: 'task',
      title: '今日締切',
      priority: 'Normal',
      dueDate: '2026-07-13',
      createdAt: '2026-07-10 09:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'B',
      status: 'inbox',
      type: 'task',
      title: '昨日締切',
      priority: 'Normal',
      dueDate: '2026-07-12',
      createdAt: '2026-07-10 10:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'C',
      status: 'inbox',
      type: 'task',
      title: '明日締切',
      priority: 'Normal',
      dueDate: '2026-07-14',
      createdAt: '2026-07-10 11:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'D',
      status: 'inbox',
      type: 'note',
      title: '確認待ち',
      priority: 'Normal',
      needsFollowup: true,
      createdAt: '2026-07-10 12:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'E',
      status: 'inbox',
      type: 'event',
      title: '予定',
      priority: 'Urgent',
      dueDate: '2026-07-13',
      createdAt: '2026-07-10 13:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'F',
      status: 'completed',
      type: 'task',
      title: '完了済み',
      priority: 'Urgent',
      dueDate: '2026-07-13',
      createdAt: '2026-07-10 14:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
    {
      id: 'G',
      status: 'inbox',
      type: 'reminder',
      title: '至急確認',
      priority: 'Urgent',
      createdAt: '2026-07-10 15:00:00',
      userId: 'father',
      userDisplayName: '父',
    },
  ];
  const result = buildNotificationCandidates_(sampleItems, {
    targetDate: targetDate,
    userId: 'father',
    limit: 20,
  });
  const byId = result.reduce(function(map, item) {
    map[item.id] = item;
    return map;
  }, {});

  assertNotificationReason_(byId, 'A', 'due_today');
  assertNotificationReason_(byId, 'B', 'overdue');
  assertNotificationReason_(byId, 'C', 'due_tomorrow');
  assertNotificationReason_(byId, 'D', 'followup_required');
  if (byId.E) {
    throw new Error('eventは通知候補から除外されるべきやで');
  }
  if (byId.F) {
    throw new Error('completedは通知候補から除外されるべきやで');
  }
  assertNotificationReason_(byId, 'G', 'urgent');

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function assertNotificationReason_(itemsById, id, reason) {
  if (!itemsById[id]) {
    throw new Error(id + ' が通知候補に含まれてへんで');
  }

  if (itemsById[id].reasons.indexOf(reason) === -1) {
    throw new Error(id + ' に ' + reason + ' が付いてへんで');
  }
}

function testFamilyCalendarConnection() {
  const config = getCalendarConfig_('family');
  const calendar = getCalendarByConfig_(config);
  console.log('Family calendar connected: ' + calendar.getName());
  return {
    success: true,
    calendarName: calendar.getName(),
  };
}


function analyzeMemoWithAI_(memo) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されてへんで');
  }

  if (!memo || !String(memo).trim()) {
    throw new Error('解析するメモが空やで');
  }

  const now = new Date();
  const timeZone = Session.getScriptTimeZone() || 'Asia/Tokyo';

  const currentDateTime = Utilities.formatDate(
    now,
    timeZone,
    'yyyy-MM-dd HH:mm:ss'
  );

  const payload = {
    model: 'gpt-5.5',

    instructions: [
      'あなたは家庭用AI秘書「ぱるる」です。',
      'ユーザーが入力した雑多なメモを、指定されたJSON形式に整理してください。',
      '',
      '現在日時: ' + currentDateTime,
      'タイムゾーン: ' + timeZone,
      '',
      '重要ルール:',
      '・日本語で解析する',
      '・原文にない情報を勝手に作らない',
      '・不明な文字列項目は空文字にする',
      '・年が省略された日付は、現在日時を基準に次に来る未来の日付として解釈する',
      '・categoryとtypeとpriorityは指定候補から選ぶ',
      '・情報不足でも管理できる場合は質問しない',
      '・タスク管理上、重要な期限などが不足している場合のみ確認質問を作る',
      '・categoryが仕事、typeがtask、dueDateとdueTimeがどちらも空で、相手・提出物・送付先・目的から期限確認が重要な業務タスクなら、原則としてneedsFollowupをtrueにする',
      '・その場合のfollowupQuestionは「締切はいつ？」または文脈に合う自然な短い質問にする',
      '・needsFollowupがtrueの場合、followupInputTypeをdate/datetime/time/text/yesnoから選ぶ',
      '・締切、いつまで、何日、予定日を聞く質問はdateを基本にする',
      '・何時、時刻を聞く質問はtimeを基本にする',
      '・何日の何時、いつ通知する、日付と時刻の両方が必要な質問はdatetimeを基本にする',
      '・はい/いいえ、必要？、実行する？、通知する？の質問はyesnoを基本にする',
      '・買い物、単なるメモ、アイデア、締切がなくても成立する軽微な家庭タスクでは期限確認を求めない',
      '・titleは30文字以内の簡潔な表現にする',
      '・confidenceは0から1の数値にする'
    ].join('\n'),

    input: String(memo).trim(),

    reasoning: {
      effort: 'low'
    },

    text: {
      format: {
        type: 'json_schema',
        name: 'paluru_memo_analysis',
        strict: true,

        schema: {
          type: 'object',

          properties: {
            title: {
              type: 'string'
            },

            category: {
              type: 'string',
              enum: [
                '仕事',
                '学校',
                '家庭',
                '買い物',
                '健康',
                'お金',
                '予定',
                'アイデア',
                'その他'
              ]
            },

            type: {
              type: 'string',
              enum: [
                'note',
                'task',
                'event',
                'shopping',
                'idea',
                'reminder'
              ]
            },

            priority: {
              type: 'string',
              enum: [
                'Low',
                'Normal',
                'High',
                'Urgent'
              ]
            },

            dueDate: {
              type: 'string',
              description: '締切日。yyyy-MM-dd形式。不明なら空文字'
            },

            dueTime: {
              type: 'string',
              description: '締切時刻。HH:mm形式。不明なら空文字'
            },

            eventStart: {
              type: 'string',
              description: '予定開始日。yyyy-MM-dd形式。不明なら空文字'
            },

            eventStartTime: {
              type: 'string',
              description: '予定開始時刻。HH:mm形式。不明なら空文字'
            },

            eventEnd: {
              type: 'string',
              description: '予定終了日。yyyy-MM-dd形式。不明なら空文字'
            },

            eventEndTime: {
              type: 'string',
              description: '予定終了時刻。HH:mm形式。不明なら空文字'
            },

            remindAt: {
              type: 'string',
              description: 'リマインド日時。yyyy-MM-dd HH:mm形式。不明なら空文字'
            },

            tags: {
              type: 'array',
              items: {
                type: 'string'
              }
            },

            needsFollowup: {
              type: 'boolean',
              description: '仕事のtaskでdueDateとdueTimeが空、かつ期限確認が重要な業務タスクならtrue。買い物、単なるメモ、アイデア、軽微な家庭タスクではfalse。'
            },

            followupQuestion: {
              type: 'string',
              description: 'needsFollowupがtrueの場合だけ、ユーザーに確認する短い質問。不明な仕事タスクの締切確認は「締切はいつ？」を基本にする。'
            },

            followupInputType: {
              type: 'string',
              enum: [
                'date',
                'datetime',
                'time',
                'text',
                'yesno'
              ],
              description: 'followupQuestionに回答しやすい入力形式。締切/いつまで/何日/予定日はdate、何時/時刻はtime、日付と時刻の両方が必要ならdatetime、はい/いいえで答える質問はyesno、それ以外はtext。'
            },

            aiSummary: {
              type: 'string'
            },

            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1
            }
          },

          required: [
            'title',
            'category',
            'type',
            'priority',
            'dueDate',
            'dueTime',
            'eventStart',
            'eventStartTime',
            'eventEnd',
            'eventEndTime',
            'remindAt',
            'tags',
            'needsFollowup',
            'followupQuestion',
            'followupInputType',
            'aiSummary',
            'confidence'
          ],

          additionalProperties: false
        }
      }
    },

    max_output_tokens: 500
  };

  const response = UrlFetchApp.fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  debugLog_('[OpenAI] HTTP Status: ' + statusCode);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      'OpenAI APIエラー\n' +
      'HTTP Status: ' + statusCode
    );
  }

  const responseData = JSON.parse(responseText);
  const outputText = extractOpenAIOutputText_(responseData);

  try {
    return JSON.parse(outputText);
  } catch (error) {
    debugLog_('[OpenAI] JSON parse failed output length=' + outputText.length);

    throw new Error(
      'AIの返答をJSONとして読めんかったで: ' +
      error.message
    );
  }
}

function testPaluruTodayTopRules() {
  const targetDate = '2026-07-15';
  const cases = [
    ['today event', shouldShowInToday_({ status: 'inbox', type: 'event', eventStart: targetDate }, targetDate)],
    ['today due task', shouldShowInToday_({ status: 'inbox', type: 'task', dueDate: targetDate }, targetDate)],
    ['overdue task', shouldShowInToday_({ status: 'inbox', type: 'task', dueDate: '2026-07-14' }, targetDate)],
    ['today reminder', shouldShowInToday_({ status: 'inbox', type: 'reminder', remindAt: targetDate + ' 08:00:00' }, targetDate)],
    ['followup', shouldShowInToday_({ status: 'inbox', type: 'note', needsFollowup: true }, targetDate)],
    ['done excluded', !shouldShowInToday_({ status: 'Done', type: 'event', eventStart: targetDate }, targetDate)],
  ];

  assertPaluruTestCases_(cases);
  return cases;
}

function testPaluruFollowupRules() {
  const task = validateAnalyzedItem_({ type: 'task', dueDate: '' });
  const eventWithStart = validateAnalyzedItem_({ type: 'event', eventStart: '2026-07-15' });
  const eventWithoutStart = validateAnalyzedItem_({ type: 'event', eventStart: '' });
  const reminderWithoutDate = validateAnalyzedItem_({ type: 'reminder', remindAt: '' });
  const cases = [
    ['task missing due needs followup', task.needsFollowup === true && task.followupInputType === 'date'],
    ['event with start no followup', eventWithStart.needsFollowup === false],
    ['event missing start needs followup', eventWithoutStart.needsFollowup === true],
    ['reminder missing date needs followup', reminderWithoutDate.needsFollowup === true],
  ];

  assertPaluruTestCases_(cases);
  return cases;
}

function testPaluruDateTimeFormatting() {
  const cases = [
    ['1899 date suppressed', normalizeDateForSheet_('1899-12-30T05:02:40.000Z') === ''],
    ['time only extracted', normalizeTimeForSheet_('1899-12-30T05:02:40.000Z') === '05:02'],
    ['1325 normalized', normalizeTimeInput_('1325') === '13:25'],
    ['930 normalized', normalizeTimeInput_('930') === '09:30'],
    ['full width digits normalized', normalizeTimeInput_('１３２５') === '13:25'],
    ['jp time normalized', normalizeTimeInput_('13時25分') === '13:25'],
    ['pm time normalized', normalizeTimeInput_('1:25 PM') === '13:25'],
    ['empty event end omitted', formatItemDateTime_({ type: 'event', eventStart: '2026-07-15', eventStartTime: '13:25', eventEnd: '', eventEndTime: '' }) === '7/15 13:25'],
    ['event end omitted without eventEnd date', formatItemDateTime_({ type: 'event', eventStart: '2026-07-15', eventStartTime: '13:25', eventEnd: '', eventEndTime: '14:00' }) === '7/15 13:25'],
  ];

  assertPaluruTestCases_(cases);
  return cases;
}

function testPaluruCalendarMemberTagRules() {
  const father = parseCalendarMemberTag_('（父）会議');
  const fatherSuffix = parseCalendarMemberTag_('薬局（父）');
  const daughter = parseCalendarMemberTag_('(次女) 授業参観');
  const unknown = parseCalendarMemberTag_('タグなし予定');
  const settings = buildTodayCalendarSettings_({});
  const cases = [
    ['father tag parsed', father.memberKey === 'father' && father.cleanTitle === '会議'],
    ['father suffix tag parsed', fatherSuffix.memberKey === 'father' && fatherSuffix.cleanTitle === '薬局'],
    ['half width tag parsed', daughter.memberKey === 'daughter2' && daughter.cleanTitle === '授業参観'],
    ['unknown tag parsed', unknown.memberKey === 'unknown' && unknown.cleanTitle === 'タグなし予定'],
    ['default visible father', isCalendarEventVisible_({ memberKey: 'father' }, settings) === true],
    ['default visible family', isCalendarEventVisible_({ memberKey: 'family' }, settings) === true],
    ['default hidden unknown', isCalendarEventVisible_({ memberKey: 'unknown' }, settings) === false],
    ['pickup needs user action', isCalendarEventNotificationCandidate_({ title: 'りおたんのお迎え', memberKey: 'daughter2' }) === true],
  ];

  assertPaluruTestCases_(cases);
  return cases;
}

function assertPaluruTestCases_(cases) {
  const failed = cases.filter(function(testCase) {
    return !testCase[1];
  });
  if (failed.length > 0) {
    throw new Error('PALURU test failed: ' + failed.map(function(testCase) {
      return testCase[0];
    }).join(', '));
  }
}
