const SHEET_NAME = '01_Inbox';
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

  const item = appendNewItem_({
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
    Logger.log('[createWithAI] received body: ' + JSON.stringify(body));
    const analysis = enforceFollowupRules_(analyzeMemoWithAI_(memo), memo);
    const requestedPriority = normalizePriority_(body.priority);
    const now = nowTokyoString_();
    const itemInput = Object.assign({}, analysis, {
      memo: memo,
      category: body.category || analysis.category,
      priority: requestedPriority || analysis.priority,
      status: 'inbox',
      source: 'ai',
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
    Logger.log('[createWithAI] final priority: ' + savedItem.priority);
    const responseItem = Object.assign({}, analysis, itemInput, savedItem, {
      updatedAt: now,
    });

    return json_({
      success: true,
      item: responseItem,
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
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
    lock.waitLock(10000);
    target = getItemById_(id);
    if (!target) {
      return json_({ success: false, status: 404, message: 'not found' });
    }

    if (String(target.item.type || '').toLowerCase() !== 'event') {
      return json_({ success: false, status: 400, message: 'calendar sync requires event item' });
    }

    if (target.item.calendarEventId) {
      return json_({
        success: true,
        item: buildCalendarResponseItem_(target.item),
        message: target.item.calendarSyncStatus === 'update_required'
          ? 'calendar update required'
          : 'calendar already synced',
      });
    }

    const calendarTarget = normalizeCalendarTarget_(body.calendarTarget || target.item.defaultCalendar || 'family');
    const calendarConfig = getCalendarConfig_(calendarTarget);
    const calendar = getCalendarByConfig_(calendarConfig);
    const calendarName = calendar.getName();
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

    const now = nowTokyoString_();
    const updates = {
      calendarTitle: calendarTitle,
      calendarSyncStatus: 'synced',
      calendarId: calendarConfig.calendarId,
      calendarEventId: event.getId(),
      calendarName: calendarName,
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
      message: 'calendar synced',
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
    calendarTitle: item.calendarTitle || '',
    calendarSyncStatus: item.calendarSyncStatus || getInitialCalendarSyncStatus_(item),
    calendarId: item.calendarId || '',
    calendarEventId: item.calendarEventId || '',
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
  allowedFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      if (Object.prototype.hasOwnProperty.call(index, field)) {
        sheet.getRange(rowNumber, index[field] + 1).setValue(normalizeValueForSheet_(field, body[field]));
      }
    }
  });
  const afterItem = Object.assign({}, beforeItem);
  allowedFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      afterItem[field] = normalizeValueForSheet_(field, body[field]);
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
    item[header] = value instanceof Date ? value.toISOString() : value;
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
      sheet.getRange(rowNumber, index[field] + 1).setValue(normalizeValueForSheet_(field, updates[field]));
    }
  });
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
        item[header] = value instanceof Date ? value.toISOString() : value;
      });
      return sanitizeItemForClient_(item);
    })
    .reverse();
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
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return '';
  }

  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
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

  return normalizedAnalysis;
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

  return updates;
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

  console.log('HTTP Status: ' + statusCode);

  if (statusCode < 200 || statusCode >= 300) {
    console.error(responseText);

    throw new Error(
      'OpenAI APIエラー\n' +
      'HTTP Status: ' + statusCode + '\n' +
      responseText
    );
  }

  const responseData = JSON.parse(responseText);
  const outputText = extractOpenAIOutputText_(responseData);

  try {
    return JSON.parse(outputText);
  } catch (error) {
    console.error('AI出力: ' + outputText);

    throw new Error(
      'AIの返答をJSONとして読めんかったで: ' +
      error.message
    );
  }
}
