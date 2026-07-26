'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gasDir = path.resolve(__dirname, '..', 'gas');
let savedUpdates = null;
let appendCalls = 0;
const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  Utilities: {
    getUuid: () => '11111111-1111-4111-8111-111111111111',
    formatDate: () => '2026-07-18 12:00:00'
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
  }
};
vm.createContext(context);
new vm.Script(fs.readFileSync(path.join(gasDir, 'Code.js'), 'utf8'), { filename: 'Code.js' }).runInContext(context);
context.resolveAuthenticatedActor_ = () => ({ homeId: 'home', memberUserId: 'father', deviceId: 'father-device', role: 'admin' });
context.authorizeCapability_ = () => true;
context.getHomeMember_ = () => ({ displayName: 'Father', status: 'active' });
context.updateRowFields_ = (sheet, row, index, updates) => { savedUpdates = Object.assign({}, updates); };
context.appendNewItem_ = () => { appendCalls += 1; throw new Error('unexpected append'); };
function parse(output) { return JSON.parse(output.getContent()); }
function assert(value, message) { if (!value) throw new Error(message); }
function target(item) {
  context.getItemById_ = () => ({ item: Object.assign({
    id: '77777777-7777-4777-8777-777777777777',
    title: '部長に資料を提出する', memo: '部長に資料を提出する', category: '仕事',
    type: 'task', dueDate: '', dueTime: '', eventStart: '', eventStartTime: '', remindAt: '',
    needsFollowup: true, followupQuestion: '締切はいつ？', followupInputType: 'date',
    aiSummary: '部長に資料を提出する仕事タスク。締切が不明なため確認が必要です。'
  }, item || {}), sheet: {}, rowNumber: 2, index: {} });
  context.getOwnedMemoItem_ = context.getItemById_;
}
const tests = []; function test(name, fn) { tests.push({ name, fn }); }

test('task date answer rebuilds displayed aiSummary and updates one row', () => {
  savedUpdates = null; appendCalls = 0; target();
  const result = parse(context.answerFollowup_({ id: '77777777-7777-4777-8777-777777777777', answerDate: '2026-07-21', followupInputType: 'date' }));
  assert(result.success && savedUpdates, 'followup update failed');
  assert(!savedUpdates.aiSummary.includes('不明') && savedUpdates.aiSummary.includes('締切は7月21日です'), 'summary was not deterministically rebuilt');
  assert(savedUpdates.dueDate === '2026-07-21' && savedUpdates.needsFollowup === false, 'deadline or followup state wrong');
  assert(savedUpdates.followupQuestion === '' && savedUpdates.followupInputType === '', 'resolved fields not cleared');
  assert(result.item.aiSummary === savedUpdates.aiSummary && result.item.updatedAt === savedUpdates.updatedAt, 'API item differs from saved row');
  assert(appendCalls === 0, 'a new Inbox row was added');
});

test('remaining distinct followup is preserved', () => {
  savedUpdates = null; target();
  context.analyzeFollowupAnswerWithAI_ = () => ({
    dueDate: '2026-07-21', needsFollowup: true,
    followupQuestion: '提出時刻は何時？', followupInputType: 'time'
  });
  const result = parse(context.answerFollowup_({ id: '77777777-7777-4777-8777-777777777777', answer: '7月21日', followupInputType: 'text' }));
  assert(result.item.needsFollowup === true, 'remaining followup was incorrectly resolved');
  assert(result.item.followupQuestion === '提出時刻は何時？' && result.item.followupInputType === 'time', 'remaining followup changed');
});

test('event and reminder summaries use confirmed values without AI', () => {
  const eventSummary = vm.runInContext("buildResolvedFollowupSummary_({type:'event',title:'病院へ行く',eventStart:'2026-07-22',eventStartTime:'10:30'})", context);
  const reminderSummary = vm.runInContext("buildResolvedFollowupSummary_({type:'reminder',title:'薬を飲む',remindAt:'2026-07-23 08:00'})", context);
  assert(eventSummary.includes('予定は7月22日 10:30です'), 'event summary wrong');
  assert(reminderSummary.includes('通知は7月23日 08:00です'), 'reminder summary wrong');
});

let failures = 0;
for (const item of tests) { try { item.fn(); console.log('PASS ' + item.name); } catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); } }
if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');
