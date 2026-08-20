const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxSyWgosHRhERKpBrzoMLpdG5_2xe0mtThCkQDtucHyCODj6xbK00Nb9nSVk8Fqdmd5Eg/exec";

const APP_VERSION = "1.1.0";
const DEBUG = false;
const DEFAULT_PRIORITY = "";
const CHARACTER_BASE_PATH = "assets/character/paluru";
const assetUrl = (path) => `${path}?v=${globalThis.BUILD_ID}`;
const PROFILE_STORAGE_KEY = "paruru-mini-profile";
const AGENT_CHAT_SESSION_STORAGE_KEY = "paruru-mini-agent-chat-session-v1";
const HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY = "paruru-mini-home-agent-pairing-v1";
const HOME_CONTROL_PENDING_STORAGE_KEY = "paruru-mini-home-control-pending-v1";
const MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY = "paruru-mini-membership-registration-pending-v1";
const HOME_CONTROL_POLL_MILLISECONDS = 5000;
const NOTIFICATION_CACHE_MS = 5000;
const NOTIFICATION_DISPLAY_LIMIT = 5;
const TOKYO_TIME_ZONE = "Asia/Tokyo";
const DEFAULT_TOMORROW_SCHEDULE_START_TIME = "18:00";
const HOME_AGENT_QUESTION_PATTERNS = [
  /[？?]\s*$/,
  /教えて/,
  /なに|何/,
  /ある[？?]?/,
  /いる[？?]?/,
  /どう[？?]?/,
  /予定/,
  /給食/,
  /傘/,
  /持ち物/,
  /出発/,
  /暑い|寒い|蒸し|蒸す|温度|湿度|部屋/,
  /強めて|弱めて|除湿して|暖かくして|涼しくして|冷やして|温めて/,
  /自動制御|通常運転|一時停止/,
  /家の温度どう|家の中暑くない|部屋大丈夫|家の中どんな感じ/,
  /冷房効いとる|設定温度まで下がりそう|ちゃんと冷え|ぬるい/,
  /ちょっと暑い|少し暑い|ちょっと寒い|少し寒い|1度下げて|1度上げて|一度下げて|一度上げて/,];
const HOME_AGENT_MEMO_PRIORITY_PATTERNS = [
  /買う|購入|もらう|提出|送る|予約|登録|入れといて|入れて|メモ/,
  /^\s*\d{1,2}月\d{1,2}日/,
  /授業参観|面談|会議|歯医者|病院/,
];
const AGENT_CHAT_HOME_STATE_PATTERNS = [
  /暑い|寒い|蒸し|蒸す|温度|おんど|湿度|室温/,
  /家の温度どう|家の中暑くない|部屋大丈夫|家の中どんな感じ/,
  /冷房効いてる|冷房効いとる|設定温度まで下がりそう|ちゃんと冷え|ぬるい/,
];
const AGENT_CHAT_AIRCON_READ_PATTERNS = [
  /(?:エアコン|冷房|暖房).*(?:どうなって|状態|ついてる|ついとる|動いてる|動いとる|運転中|何度設定|設定温度|どのモード|モード|風量|効いてる|効いとる)/,
  /何度設定|設定温度|今どのモード|現在どのモード/,
  /自動制御.*(?:一時停止中|停止中|止まってる|止まっとる|どうなって|状態|動いてる|動いとる|通常運転中)/,
  /(?:一時停止中|停止中).*(?:自動制御)/,
];
const HOME_AGENT_AIRCON_COMMAND_PATTERNS = [
  /(?:エアコン|冷房|暖房).*(?:つけて|入れて|消して|止めて|切って|設定して|上げて|下げて|強くして|弱くして|強めて|弱めて)/,
  /(?:つけて|入れて|消して|止めて|切って).*(?:エアコン|冷房|暖房)/,
  /(?:1度|一度).*(?:下げて|上げて)/,
  /(?:除湿|冷房|暖房).*(?:にして|切り替えて)/,
  /風量.*(?:強く|弱く|上げて|下げて|して)/,
  /(?:リビング|居間|寝室|子ども部屋|子供部屋|書斎).*(?:温度|おんど).*(?:下げて|上げて)/,
  /自動制御.*(?:止めて|停止して|一時停止して|再開して|戻して|解除して)/,
  /通常運転.*(?:戻して|再開して)/,
];
const AGENT_AUTOMATION_CONTROL_PATTERNS = [
  /自動制御.*(?:止めて|停止して|一時停止して|再開して|戻して|解除して)/,
  /通常運転.*(?:戻して|再開して)/,
];
const LEGACY_HOME_AGENT_PRIORITY_PATTERNS = [
  /給食|傘|持ち物|出発/,
  /学校|授業|部活|登校|下校/,
];
const EXPLICIT_AGENT_MEMO_REQUEST_PATTERN = /(?:覚え(?:て|といて|ておいて)|メモ(?:して|しといて|っといて)|記録(?:して|しといて|っといて)|控え(?:て|といて)|保存(?:して|しといて)|残し(?:て|といて))\s*[。．.!！…]*$/;
const CALENDAR_WRITE_PATTERN = /(?:予定|スケジュール|カレンダー|予約|会議|面談|歯医者|病院).*(?:登録|追加|入れて|入れといて|作成|変更|移動|削除|キャンセル)|(?:登録|追加|作成|変更|移動|削除|キャンセル).*(?:予定|スケジュール|カレンダー)/;
const CALENDAR_IMPLICIT_WRITE_PATTERN = /(?:今日|明日|あした|明後日|あさって|\d{1,2}月\d{1,2}日)\s*\d{1,2}(?:時|:|：)\d{0,2}.*(?:歯医者|病院|会議|面談|予約|授業参観|予定)/;
const WEATHER_QUERY_PATTERN = /(?:外気温|外の(?:気温|天気)|天気|最高気温|最低気温|雨(?:降る|降り)|傘(?:いる|必要)|何度)/;
const CALENDAR_READ_TOPIC_PATTERN = /予定|スケジュール|カレンダー|何かある|忙しい|何時から/;
const CALENDAR_READ_CONTEXT_PATTERN = /今日|明日|今週|今後|これから|一週間|1週間|７日間?|7日間?|家族|みんな|全員|自分|私|父/;
const CALENDAR_NEXT_SEVEN_DAYS_PATTERN = /(?:これから|今後)?\s*(?:一週間|1週間|７日間?|7日間?)(?:の予定|のスケジュール)?/;
const HOME_INPUT_ACTIONS = Object.freeze({
  consult: Object.freeze({ label: "💬 相談する", sendingLabel: "💬 確認中…", hint: "確認・質問・操作" }),
  register: Object.freeze({ label: "📝 登録する", sendingLabel: "📝 登録中…", hint: "予定・タスク・メモ" }),
});
const HOME_INPUT_INTENTS = Object.freeze({ CONSULT_LIKELY: "CONSULT_LIKELY", REGISTER_LIKELY: "REGISTER_LIKELY", AMBIGUOUS: "AMBIGUOUS" });
const DEFAULT_PROFILE = {
  userId: "father",
  displayName: "父",
  calendarSuffix: "（父）",
  defaultCalendar: "family",
  selectedCalendarMemberKeys: ["father", "family"],
  includeUnknownCalendarEvents: false,
  tomorrowScheduleStartTime: DEFAULT_TOMORROW_SCHEDULE_START_TIME,
};

const PARURU_MESSAGES = {
  speech: {
    idle: "……メモしとく？",
    typing: "はいはい、聞いとるよ。",
    saving: "ちょっと待って。今まとめよる。",
    saved: "はいはい、預かったよ。",
    followup: "これ、もうひとつ聞いてええ？",
    calendarPrompt: "予定っぽいね。カレンダー入れる？",
    calendarSynced: "カレンダーに入れといたよ。",
    hasNotifications: "{{address}}、今日は気にしとくことあるよ。",
    noNotifications: "今日は急ぎなし。珍しいね、{{address}}。",
    error: "うまくいかんかった。もう一回だけ。",
    notificationOne: "{{address}}、ひとつ気にしといて。",
    notificationMany: (count) => `今日は${count}つあるよ。見といてな。`,
    homeAgent: "家の中、見てきたよ。",
  },
  state: {
    loading: "……ちょっと待って、{{address}}。",
    normal: "……メモしとく？",
    sending: "ちょっと待って。今まとめよる。",
    success: "はいはい、預かったよ。",
    empty: "{{address}}、何も書いてないよ。僕でも無理。",
    error: "うまくいかんかった。もう一回だけ試してみて。",
    inboxEmpty: "今日はまだ何も預かってないよ。珍しいね、{{address}}。",
    done: "直しといたよ。えらいえらい。",
    deleteConfirm: "ほんまに消す？ 後で泣いても知らんよ。",
    deleted: "消しといたよ。",
  },
  notification: {
    loadingLine: "ちょっと見てくる。",
    loadingBody: "読み込み中...",
    empty: "今日は急ぎなし。珍しいね、{{address}}。",
    loadedLine: "今日の予定とやること、まとめといたよ。",
    error: "うまく読めんかった。もう一回だけ試してみて。",
    fallback: "{{address}}、これ確認しといて。",
    more: (count) => `ほか${count}件`,
  },
  action: {
    profileSaved: "保存しといたよ、{{address}}。",
    detailOpenFailed: "詳細を開けんかった。Inboxで見てな。",
    followupSuccess: "直しといたよ。",
    followupError: "うまくいかんかった。もう一回だけ試してみて。",
    calendarInputInvalid: "日付とタイトル、もう一回見て。そこ大事やから。",
    calendarCreateSuccess: "カレンダーに入れといたよ。あとは忘れても知らんけど。",
    calendarUpdateSuccess: "直しといたよ。",
    calendarError: "カレンダー登録できんかった。もう一回試して。",
    homeAgentLoading: "ぱるるが家の中を確認中…",
    homeAgentError: "うまく見に行けんかった。もう一回試して。",
  },
  calendarStatus: {
    pending: "カレンダーにはまだ入れてないよ。",
    synced: "カレンダーには入れといたよ。",
    update_required: "カレンダーはまだ古いまま。サイネージにも反映されてないよ。",
    failed: "カレンダー連携でつまずいた。もう一回見る？",
  },
  notificationMessage: {
    overdue: (title) => `${title}、期限過ぎとるよ。僕のせいにはせんといてな。`,
    due_today: (title) => `{{address}}、${title}は今日まで。僕は覚えとったよ。`,
    urgent: (title) => `至急やで。${title}、先に見といて。`,
    followup_required: (title) => `${title}、まだ確認が残っとるよ。答えとく？`,
    due_tomorrow: (title) => `${title}は明日まで。今日のうちにやっとく？`,
    due_within_7_days: (title) => `${title}は1週間以内。忘れんうちに見といてな。`,
    high_priority: (title) => `${title}、優先度高め。忘れたら僕が見てたって言うよ。`,
    fallback: (title) => `${title}、確認しといてな。`,
  },
};
const PARURU_STATES = {
  loading: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_sleepy.png`),
    speech: "idle",
    line: PARURU_MESSAGES.state.loading,
  },
  normal: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`),
    speech: "idle",
    line: PARURU_MESSAGES.speech.idle,
  },
  sending: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`),
    speech: "saving",
    line: PARURU_MESSAGES.speech.saving,
  },
  success: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_smile.png`),
    speech: "saved",
    line: PARURU_MESSAGES.speech.saved,
    messageType: "success",
  },
  empty: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`),
    speech: "error",
    line: PARURU_MESSAGES.state.empty,
    messageType: "error",
  },
  error: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`),
    speech: "error",
    line: PARURU_MESSAGES.speech.error,
    messageType: "error",
  },
  inboxEmpty: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_sleepy.png`),
    line: PARURU_MESSAGES.state.inboxEmpty,
  },
  done: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_smile.png`),
    line: PARURU_MESSAGES.state.done,
    messageType: "success",
  },
  deleteConfirm: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`),
    line: PARURU_MESSAGES.state.deleteConfirm,
    messageType: "error",
  },
  deleted: {
    image: assetUrl(`${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`),
    line: PARURU_MESSAGES.state.deleted,
    messageType: "success",
  },
};

const CATEGORY_COLORS = {
  未分類: "#6c7087",
  家: "#5c6bc0",
  仕事: "#4766d8",
  買い物: "#2e7d5b",
  学校: "#7b61c9",
  薬局: "#d15b7a",
  開発: "#3367a8",
  お金: "#b7791f",
};

const TYPE_LABELS = {
  task: "タスク",
  event: "予定",
  shopping: "買い物",
  note: "メモ",
  idea: "アイデア",
  reminder: "リマインド",
};

const PRIORITY_ORDER = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

const categoryRules = {
  買い物: ["牛乳", "卵", "パン", "買う", "スーパー", "OK", "ライフ"],
  仕事: ["会議", "資料", "部長", "メール", "会社", "出張"],
  学校: ["学校", "給食", "面談", "受験", "宿題", "部活"],
  薬局: ["薬局", "薬", "在庫", "ロキソ", "処方", "患者"],
  開発: ["Git", "GAS", "CSS", "HTML", "JavaScript", "アプリ", "デプロイ"],
  お金: ["楽天", "カード", "家計", "支払い", "予算", "請求"],
  家: ["ゴミ", "洗濯", "掃除", "エアコン", "SwitchBot"],
};

const DUMMY_STORAGE_KEY = "paruru-mini-inbox";

let inboxItems = [];
let selectedItemId = "";
let activeView = "home";
let isSubmitting = false;
let isCalendarSyncing = false;
let categoryExplicitlySelected = false;
let priorityExplicitlySelected = false;
let userProfile = null;
let notificationCandidatesState = {
  lastFetchedAt: 0,
  inFlight: null,
  items: [],
  totalCount: 0,
  includeTomorrow: false,
  warnings: [],
};
let notificationBoundaryTimerId = null;
let notificationBoundaryTimerEnabled = false;
let originalEditDueDate = "";
let shoppingTimingTouched = false;

const form = document.querySelector("#inboxForm");
const memoInput = document.querySelector("#memo");
const categoryInput = document.querySelector("#category");
const priorityInputs = document.querySelectorAll('input[name="priority"]');
const paruruImage = document.querySelector("#paruruImage");
const paruruLine = document.querySelector("#paruruSpeech") || document.querySelector(".paruru-line");
const askPaluruButton = document.querySelector("#askPaluruButton");
const saveToPaluruButton = document.querySelector("#saveToPaluruButton");
const consultActionHint = document.querySelector("#consultActionHint");
const registerActionHint = document.querySelector("#registerActionHint");
const homeIntentConfirm = document.querySelector("#homeIntentConfirm");
const homeIntentConfirmMessage = document.querySelector("#homeIntentConfirmMessage");
const homeIntentConfirmSwitch = document.querySelector("#homeIntentConfirmSwitch");
const homeIntentConfirmKeep = document.querySelector("#homeIntentConfirmKeep");
const homeIntentConfirmCancel = document.querySelector("#homeIntentConfirmCancel");
const message = document.querySelector("#message");
const splash = document.querySelector("#splash");
const authLock = document.querySelector("#authLock");
const authLockMessage = document.querySelector("#authLockMessage");
const authLockUnpaired = document.querySelector("#authLockUnpaired");
const authLockPending = document.querySelector("#authLockPending");
const authLockUnassigned = document.querySelector("#authLockUnassigned");
const authLockError = document.querySelector("#authLockError");
const authLockDeviceName = document.querySelector("#authLockDeviceName");
const authLockBeginButton = document.querySelector("#authLockBeginButton");
const authLockRetryButton = document.querySelector("#authLockRetryButton");
const authLockReRegisterButton = document.querySelector("#authLockReRegisterButton");
const authLockCode = document.querySelector("#authLockCode");
const authLockExpiry = document.querySelector("#authLockExpiry");
const authLockMembershipBeginButton = document.querySelector("#authLockMembershipBeginButton");
const authLockMembershipPending = document.querySelector("#authLockMembershipPending");
const authLockMembershipCode = document.querySelector("#authLockMembershipCode");
const authLockMembershipExpiry = document.querySelector("#authLockMembershipExpiry");
const authLockMembershipMessage = document.querySelector("#authLockMembershipMessage");
const buildVersion = document.querySelector("#buildVersion");
const views = document.querySelectorAll(".app-view");
const navItems = document.querySelectorAll(".nav-item");
const viewNavigationItems = document.querySelectorAll("[data-target-view]");
const inboxList = document.querySelector("#inboxList");
const refreshInboxButton = document.querySelector("#refreshInboxButton");
const detailDialog = document.querySelector("#detailDialog");
const deleteDialog = document.querySelector("#deleteDialog");
const editForm = document.querySelector("#editForm");
const editId = document.querySelector("#editId");
const editTitle = document.querySelector("#editTitle");
const editMemo = document.querySelector("#editMemo");
const editCategory = document.querySelector("#editCategory");
const editPriority = document.querySelector("#editPriority");
const editType = document.querySelector("#editType");
const editStatus = document.querySelector("#editStatus");
const editShoppingPanel = document.querySelector("#editShoppingPanel");
const editShoppingTiming = document.querySelector("#editShoppingTiming");
const editDuePanel = document.querySelector("#editDuePanel");
const editDueDateField = document.querySelector("#editDueDateField");
const editDueDateLabel = document.querySelector("#editDueDateLabel");
const editDueTimeField = document.querySelector("#editDueTimeField");
const editDueDate = document.querySelector("#editDueDate");
const editDueTime = document.querySelector("#editDueTime");
const editEventPanel = document.querySelector("#editEventPanel");
const editEventStart = document.querySelector("#editEventStart");
const editEventStartTime = document.querySelector("#editEventStartTime");
const editEventEnd = document.querySelector("#editEventEnd");
const editEventEndTime = document.querySelector("#editEventEndTime");
const editReminderDate = document.querySelector("#editReminderDate");
const editReminderTime = document.querySelector("#editReminderTime");
const editReminderPanel = document.querySelector("#editReminderPanel");
const doneButton = document.querySelector("#doneButton");
const deleteButton = document.querySelector("#deleteButton");
const confirmDeleteButton = document.querySelector("#confirmDeleteButton");
const homeFollowup = document.querySelector("#homeFollowup");
const homeFollowupQuestion = document.querySelector("#homeFollowupQuestion");
const homeFollowupFields = document.querySelector("#homeFollowupFields");
const homeFollowupSubmit = document.querySelector("#homeFollowupSubmit");
const homeFollowupLater = document.querySelector("#homeFollowupLater");
const detailFollowup = document.querySelector("#detailFollowup");
const detailFollowupQuestion = document.querySelector("#detailFollowupQuestion");
const detailFollowupFields = document.querySelector("#detailFollowupFields");
const detailFollowupSubmit = document.querySelector("#detailFollowupSubmit");
const detailFollowupLater = document.querySelector("#detailFollowupLater");
const detailCalendarStatus = document.querySelector("#detailCalendarStatus");
const homeCalendarSync = document.querySelector("#homeCalendarSync");
const homeCalendarSyncFields = document.querySelector("#homeCalendarSyncFields");
const homeCalendarSubmit = document.querySelector("#homeCalendarSubmit");
const homeCalendarLater = document.querySelector("#homeCalendarLater");
const detailCalendarSync = document.querySelector("#detailCalendarSync");
const detailCalendarSyncFields = document.querySelector("#detailCalendarSyncFields");
const detailCalendarSubmit = document.querySelector("#detailCalendarSubmit");
const detailCalendarLater = document.querySelector("#detailCalendarLater");
const profileForm = document.querySelector("#profileForm");
const profileUserId = document.querySelector("#profileUserId");
const profileDisplayName = document.querySelector("#profileDisplayName");
const profileRole = document.querySelector("#profileRole");
const profileCalendarSuffix = document.querySelector("#profileCalendarSuffix");
const profileDefaultCalendar = document.querySelector("#profileDefaultCalendar");
const profileDeviceId = document.querySelector("#profileDeviceId");
const profileCalendarMembers = document.querySelector("#profileCalendarMembers");
const profileIncludeUnknownCalendarEvents = document.querySelector("#profileIncludeUnknownCalendarEvents");
const profileTomorrowScheduleStartTime = document.querySelector("#profileTomorrowScheduleStartTime");
const homeControlStatus = document.querySelector("#homeControlStatus");
const homeControlUnregistered = document.querySelector("#homeControlUnregistered");
const homeControlDeviceName = document.querySelector("#homeControlDeviceName");
const homeControlEnableButton = document.querySelector("#homeControlEnableButton");
const homeControlPending = document.querySelector("#homeControlPending");
const homeControlPendingCode = document.querySelector("#homeControlPendingCode");
const homeControlPendingExpiry = document.querySelector("#homeControlPendingExpiry");
const homeControlRegistered = document.querySelector("#homeControlRegistered");
const homeControlRegisteredLabel = document.querySelector("#homeControlRegisteredLabel");
const homeControlApprovePanel = document.querySelector("#homeControlApprovePanel");
const homeControlMembershipTemplate = document.querySelector("#homeControlMembershipTemplate");
const homeControlApproveCode = document.querySelector("#homeControlApproveCode");
const homeControlApproveButton = document.querySelector("#homeControlApproveButton");
const homeControlDeviceList = document.querySelector("#homeControlDeviceList");
const homeControlMessage = document.querySelector("#homeControlMessage");
const todayParuru = document.querySelector("#todayParuru");
const todayParuruLine = document.querySelector("#todayParuruLine");
const todayParuruList = document.querySelector("#todayParuruList");
const todayParuruAllButton = document.querySelector("#todayParuruAllButton");
const refreshNotificationsButton = document.querySelector("#refreshNotificationsButton");
const homeAgentCard = document.querySelector("#homeAgentCard");
const homeAgentContent = document.querySelector("#homeAgentContent");
const homeAgentRetryButton = document.querySelector("#homeAgentRetryButton");
const homeAgentCloseButton = document.querySelector("#homeAgentCloseButton");

let homeAgentConversationContext = {};
let pendingHomeAgentActionCandidate = null;
let pendingHomeAgentRetry = null;
let pendingHomeInputIntentConfirmation = null;
let homeControlPollTimer = null;
let membershipRegistrationPollTimer = null;
let activeMembershipContext = null;
let healthTaskCache = null;

function resolveNextHealthTask(dailyRecord, now) {
  return window.PALURUHealthRoutine?.resolveNextHealthTask(dailyRecord, now) || null;
}

async function fetchNextHealthTask_() {
  if (
    appAuthenticationState !== "active_member"
    || !normalPwaInitialized
    || activeMembershipContext?.role !== "self_record"
    || !activeMembershipContext?.memberUserId
  ) {
    return null;
  }
  try {
    const daily = await callAuthenticatedHealth_("health.daily.get", {
      localDate: new Date().toLocaleDateString("sv-SE", { timeZone: TOKYO_TIME_ZONE }),
      targetMemberUserId: activeMembershipContext.memberUserId,
    });
    const task = resolveNextHealthTask(daily, new Date());
    healthTaskCache = task ? Object.assign({}, task, { targetUserId: activeMembershipContext.memberUserId }) : null;
    return healthTaskCache;
  } catch (error) {
    debugLog("[Paruru] health task failed", error?.message || error);
    healthTaskCache = null;
    return null;
  }
}

function prependVirtualHealthTask_(items, task) {
  if (!task) return Array.isArray(items) ? items : [];
  const localDate = new Date().toLocaleDateString("sv-SE", { timeZone: TOKYO_TIME_ZONE });
  return [{
    id: `health-daily-${localDate}-${task.slot}`,
    type: "health_daily",
    title: task.title,
    memo: task.title,
    notificationLevel: task.overdue ? "urgent" : "normal",
    reasons: task.overdue ? ["overdue"] : [],
    virtual: true,
    healthAction: task.action,
    healthSlot: task.slot,
    targetUserId: task.targetUserId,
  }, ...(Array.isArray(items) ? items : [])];
}

setParuruState("loading");

if ("serviceWorker" in navigator) {
  let refreshingForNewServiceWorker = false;

  debugLog("[Paruru] build version", { appVersion: APP_VERSION, buildId: globalThis.BUILD_ID });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    debugLog("[Paruru] controllerchange");
    if (refreshingForNewServiceWorker) {
      return;
    }
    refreshingForNewServiceWorker = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", {
        scope: "./",
        updateViaCache: "none",
      })
      .then((registration) => {
        debugLog("[Paruru] Service Worker registered", {
          scope: registration.scope,
          updateViaCache: registration.updateViaCache,
        });
        logServiceWorkerState(registration);
        updateServiceWorker(registration);
        registration.update();
      })
      .catch(() => {
        // PWA registration failure should not block memo submission.
      });
  });
}

let appAuthenticationState = "booting";
let normalPwaInitialized = false;

function canUseHomeControl_() {
  return appAuthenticationState === "active_member"
    && Array.isArray(activeMembershipContext?.capabilities)
    && activeMembershipContext.capabilities.includes("home.control");
}
const NURSE_OKAN_HEALTH_ACTIONS = new Set([
  "health.context.get",
  "health.daily.get",
  "health.daily.recordSlot",
  "health.weight.list",
  "health.weight.record",
]);
const PET_HEALTH_ACTIONS = new Set([
  "pet.health.record",
  "pet.health.getDailySummary",
]);

async function callAuthenticatedHealth_(action, body = {}) {
  if (appAuthenticationState !== "active_member" || !normalPwaInitialized) {
    throw createHomeControlError("AUTHENTICATION_REQUIRED");
  }
  if (!NURSE_OKAN_HEALTH_ACTIONS.has(action)) {
    throw createHomeControlError("HEALTH_ACTION_NOT_ALLOWED");
  }
  const token = getHomeAgentPairingToken();
  if (!token || !userProfile?.deviceId) {
    throw createHomeControlError("AUTHENTICATION_REQUIRED");
  }
  try {
    return await callHomeControlApi({
      ...(body && typeof body === "object" ? body : {}),
      action,
      deviceId: userProfile.deviceId,
      pairingToken: token,
    });
  } catch (error) {
    if (error && typeof error === "object" && !error.code) error.code = "HOME_CONTROL_UNAVAILABLE";
    throw error;
  }
}

function buildAuthenticatedPetHealthPayload_(action, body = {}) {
  const input = body && typeof body === "object" ? body : {};
  if (action === "pet.health.record") {
    return {
      action,
      petId: input.petId,
      clientRequestId: input.clientRequestId,
      event: input.event,
    };
  }
  return {
    action,
    petId: input.petId,
    localDate: input.localDate,
  };
}

async function callAuthenticatedPetHealth_(action, body = {}) {
  if (appAuthenticationState !== "active_member" || !normalPwaInitialized) {
    throw createHomeControlError("AUTHENTICATION_REQUIRED");
  }
  if (!PET_HEALTH_ACTIONS.has(action)) {
    throw createHomeControlError("PET_HEALTH_ACTION_NOT_ALLOWED");
  }
  const token = getHomeAgentPairingToken();
  if (!token || !userProfile?.deviceId) {
    throw createHomeControlError("AUTHENTICATION_REQUIRED");
  }
  try {
    return await callHomeControlApi({
      ...buildAuthenticatedPetHealthPayload_(action, body),
      deviceId: userProfile.deviceId,
      pairingToken: token,
    });
  } catch (error) {
    if (error && typeof error === "object" && !error.code) error.code = "PET_HEALTH_UNAVAILABLE";
    throw error;
  }
}

function showAuthenticationState(message, state = "locked") {
  appAuthenticationState = state;
  if (state !== "active_member") {
    activeMembershipContext = null;
    if (typeof pendingHomeAgentActionCandidate !== "undefined") pendingHomeAgentActionCandidate = null;
  }
  splash?.classList.remove("is-hidden");
  const loading = splash?.querySelector(".splash-loading");
  if (loading) loading.textContent = message;
  if (state === "booting") {
    if (authLock) authLock.hidden = true;
    document.body.classList.remove("is-authenticated");
    return;
  }
  if (authLock) {
    authLock.hidden = false;
    authLockMessage.textContent = message;
    document.body.classList.remove("is-authenticated");
    [authLockUnpaired, authLockPending, authLockUnassigned, authLockError].forEach((element) => {
      if (element) element.hidden = true;
    });
    const panel = state === "unpaired"
      ? authLockUnpaired
      : state === "pairing_pending"
        ? authLockPending
        : state === "paired_unassigned"
          ? authLockUnassigned
          : authLockError;
    if (panel) panel.hidden = false;
  }
}

function setAuthenticationRetryState_(message, isBusy = false) {
  if (authLockMessage) authLockMessage.textContent = message;
  if (authLockRetryButton) {
    authLockRetryButton.disabled = isBusy;
    authLockRetryButton.textContent = isBusy ? "再確認中…" : "再確認";
  }
}

async function retryAuthentication_() {
  if (authLockRetryButton?.disabled) return;
  setAuthenticationRetryState_("端末を再確認中…", true);
  try {
    await initializeAuthenticatedPwa();
    if (appAuthenticationState === "active_member") {
      setAuthenticationRetryState_("端末を確認できました。");
      if (typeof message !== "undefined" && message) {
        message.textContent = "端末を確認できました。";
        message.className = "message success";
      }
      return;
    }
    if (appAuthenticationState === "revoked_error") {
      setAuthenticationRetryState_("再確認できませんでした。端末が無効化されている場合は再登録してください。");
    }
  } catch (error) {
    showAuthenticationState("再確認できませんでした。", "revoked_error");
  } finally {
    if (appAuthenticationState !== "active_member") setAuthenticationRetryState_(authLockMessage?.textContent || "再確認できませんでした。");
  }
}

function resetRevokedDeviceForReRegistration_() {
  if (appAuthenticationState !== "revoked_error") return;
  const confirmReRegistration = typeof window.confirm === "function"
    ? window.confirm("この端末を再登録します。端末の承認情報だけを削除し、プロフィールやメモは残ります。続けますか？")
    : false;
  if (!confirmReRegistration) return;
  localStorage.removeItem(HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY);
  clearHomeControlPending();
  clearMembershipRegistrationPending();
  showAuthenticationState("この端末は未登録です。既存の6桁コードで登録を開始してください。", "unpaired");
}

function initializeNormalPwaOnce() {
  if (normalPwaInitialized) return;
  normalPwaInitialized = true;
  document.body.classList.add("is-authenticated");
  if (authLock) authLock.hidden = true;
  notificationBoundaryTimerEnabled = true;
  renderProfileForm();
  setParuruState("normal");
  if (buildVersion) {
    buildVersion.textContent = `アプリVersion: ${APP_VERSION} / Build: ${globalThis.BUILD_ID}`;
  }
  splash?.classList.add("is-hidden");
  loadNotificationCandidates({ force: true });
}

function bindAuthenticationLockControls_() {
  authLockBeginButton?.addEventListener("click", async () => {
    if (homeControlDeviceName) homeControlDeviceName.value = authLockDeviceName.value;
    await beginHomeControlPairing();
    renderAuthenticationLock_();
  });
  authLockRetryButton?.addEventListener("click", retryAuthentication_);
  authLockReRegisterButton?.addEventListener("click", resetRevokedDeviceForReRegistration_);
  authLockMembershipBeginButton?.addEventListener("click", () => beginMembershipRegistration());
}

bindAuthenticationLockControls_();

function renderAuthenticationLock_() {
  const pending = getHomeControlPending();
  if (!pending) return;
  if (isHomeControlPendingExpired_(pending)) {
    expireHomeControlPending_();
    return;
  }
  showAuthenticationState("端末承認を待っています。", "pairing_pending");
  authLockCode.textContent = String(pending.code || "");
  authLockExpiry.textContent = formatHomeControlExpiry(pending.expiresAt);
  scheduleHomeControlPoll();
}

const renderMembershipRegistrationLock_ = function() {
  const pending = getMembershipRegistrationPending();
  if (pending && isMembershipRegistrationPendingExpired_(pending)) {
    expireMembershipRegistrationPending_();
    return;
  }
  showAuthenticationState(pending ? "家族登録の承認を待っています。" : "端末は承認済みです。家族登録を申請してください。", "paired_unassigned");
  if (authLockMembershipPending) authLockMembershipPending.hidden = !pending;
  if (authLockMembershipBeginButton) authLockMembershipBeginButton.hidden = Boolean(pending);
  if (pending) {
    if (authLockMembershipCode) authLockMembershipCode.textContent = String(pending.code || "");
    if (authLockMembershipExpiry) authLockMembershipExpiry.textContent = formatHomeControlExpiry(pending.expiresAt);
    scheduleMembershipRegistrationPoll();
  }
};

async function initializeAuthenticatedPwa() {
  showAuthenticationState("端末を確認中…", "booting");
  userProfile = loadUserProfile();
  const token = getHomeAgentPairingToken();
  if (!token) {
    const pending = getHomeControlPending();
    showAuthenticationState(pending ? "端末承認を待っています。" : "この端末は未登録です。端末登録を完了してください。", pending ? "pairing_pending" : "unpaired");
    renderAuthenticationLock_();
    return;
  }
  try {
    const membershipContext = await callHomeControlApi({ action: "membership.context.get", deviceId: userProfile.deviceId, pairingToken: token });
    activateMembershipContext_(membershipContext);
  } catch (error) {
    if (error?.code === "MEMBERSHIP_NOT_FOUND") {
      renderMembershipRegistrationLock_();
      return;
    }
    showAuthenticationState("端末登録を確認できませんでした。", "revoked_error");
    setAuthenticationRetryState_("端末登録を確認できませんでした。再確認するか、この端末を再登録してください。");
  }
}

const activateMembershipContext_ = function(membershipContext) {
  activeMembershipContext = {
    memberUserId: membershipContext.memberUserId,
    displayName: membershipContext.displayName,
    role: membershipContext.role,
    calendarSuffix: membershipContext.calendarSuffix,
    addressTerms: Object.assign({}, membershipContext.addressTerms || {}),
    capabilities: Array.isArray(membershipContext.capabilities) ? membershipContext.capabilities.slice() : [],
    allowedViews: Array.isArray(membershipContext.allowedViews) ? membershipContext.allowedViews.slice() : [],
  };
  clearMembershipRegistrationPending();
  appAuthenticationState = "active_member";
  initializeNormalPwaOnce();
  applyAllowedViews_();
  void switchView(activeView);
  document.dispatchEvent(new CustomEvent("paruru:authenticated", {
    detail: {
      context: {
        memberUserId: membershipContext.memberUserId,
        displayName: membershipContext.displayName,
        role: membershipContext.role,
        calendarSuffix: membershipContext.calendarSuffix,
        addressTerms: Object.assign({}, membershipContext.addressTerms || {}),
        capabilities: membershipContext.capabilities,
        allowedViews: membershipContext.allowedViews,
      },
      healthApi: callAuthenticatedHealth_,
      petHealthApi: callAuthenticatedPetHealth_,
    },
  }));
};

window.addEventListener("load", () => {
  initializeAuthenticatedPwa();
});

if (typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (normalPwaInitialized) loadNotificationCandidates({ force: true });
    }
  });
}

function updateServiceWorker(registration) {
  if (registration.waiting) {
    debugLog("[Paruru] Service Worker waiting on load");
    activateWaitingServiceWorker(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    debugLog("[Paruru] Service Worker updatefound");
    const newWorker = registration.installing;
    logServiceWorkerState(registration);
    if (!newWorker) {
      return;
    }

    newWorker.addEventListener("statechange", () => {
      debugLog("[Paruru] Service Worker installing state", newWorker.state);
      logServiceWorkerState(registration);
      if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
        activateWaitingServiceWorker(newWorker);
      }
    });
  });
}

function activateWaitingServiceWorker(worker) {
  debugLog("[Paruru] Service Worker skip waiting requested");
  worker.postMessage({ type: "SKIP_WAITING" });
}

function logServiceWorkerState(registration) {
  debugLog("[Paruru] Service Worker state", {
    installing: registration.installing?.state || null,
    waiting: registration.waiting?.state || null,
    active: registration.active?.state || null,
    controlled: Boolean(navigator.serviceWorker.controller),
  });
}

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

categoryInput.addEventListener("change", () => {
  categoryExplicitlySelected = Boolean(categoryInput.value);
});

priorityInputs.forEach((input) => {
  input.addEventListener("change", () => {
    priorityExplicitlySelected = Boolean(input.checked && input.value);
  });
});

memoInput.addEventListener("input", () => {
  if (pendingHomeInputIntentConfirmation) {
    hideHomeInputIntentConfirmation();
  }
  if (activeView !== "home" || isSubmitting) {
    return;
  }

  setParuruSpeech(memoInput.value.trim() ? "typing" : "idle");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
});

askPaluruButton.addEventListener("click", async () => {
  await submitHomeInput("consult");
});

saveToPaluruButton.addEventListener("click", async () => {
  await submitHomeInput("register");
});

homeIntentConfirmSwitch.addEventListener("click", async () => {
  const pending = pendingHomeInputIntentConfirmation;
  if (!pending) return;
  hideHomeInputIntentConfirmation();
  await submitHomeInput(pending.suggestedRoute, { memo: pending.memo, intentConfirmed: true });
});

homeIntentConfirmKeep.addEventListener("click", async () => {
  const pending = pendingHomeInputIntentConfirmation;
  if (!pending) return;
  hideHomeInputIntentConfirmation();
  await submitHomeInput(pending.selectedRoute, { memo: pending.memo, intentConfirmed: true });
});

homeIntentConfirmCancel.addEventListener("click", () => {
  hideHomeInputIntentConfirmation();
});

renderHomeInputActionButtons();

async function submitHomeInput(route, options = {}) {
  if (isSubmitting) {
    return;
  }

  const memo = String(options.memo || memoInput.value || "").trim();
  if (!memo) {
    setParuruState("empty", { showStatus: true });
    memoInput.focus();
    return;
  }

  const selectedRoute = route === "register" ? "register" : "consult";
  if (!options.intentConfirmed) {
    const intent = classifyHomeInputIntent(memo);
    const suggestedRoute = getSuggestedHomeInputRoute(intent);
    if (suggestedRoute && suggestedRoute !== selectedRoute) {
      renderHomeInputIntentConfirmation({ memo, selectedRoute, suggestedRoute });
      return;
    }
  }

  if (selectedRoute === "register") {
    await savePaluruMemo(memo);
    return;
  }
  await routePaluruRequest(memo);
}

function classifyHomeInputIntent(memo) {
  const value = String(memo || "").trim();
  if (!value) return HOME_INPUT_INTENTS.AMBIGUOUS;
  if (isCalendarWriteRequest(value) || isRegisterLikelyHomeInput(value)) return HOME_INPUT_INTENTS.REGISTER_LIKELY;
  if (isConsultLikelyHomeInput(value)) return HOME_INPUT_INTENTS.CONSULT_LIKELY;
  return HOME_INPUT_INTENTS.AMBIGUOUS;
}

function isRegisterLikelyHomeInput(value) {
  // A Today aggregate question may contain "やること".  It remains a
  // consultation when the existing consultation signals make that clear;
  // explicit registration wording keeps the existing registration flow.
  const todayAggregateConsult = isTodayParuruQuery(value) && isConsultLikelyHomeInput(value);
  return isExplicitAgentMemoRequest(value)
    || CALENDAR_IMPLICIT_WRITE_PATTERN.test(value)
    || /(?:タスク|リマインダー|買い物|メモ|予定|スケジュール|カレンダー).*(?:登録|追加|入れて|入れといて|作成|保存|残して)|(?:登録|追加|入れて|入れといて|作成|保存|残して).*(?:タスク|リマインダー|買い物|メモ|予定|スケジュール|カレンダー)/.test(value)
    || (!todayAggregateConsult && /(?:買う|購入|提出|持っていく|やること)/.test(value));
}

function isConsultLikelyHomeInput(value) {
  return isAutomationControlRequest(value) || isAirconOperationRequest(value) ||
    isLegacyHomeAgentPriorityQuery(value) || isCalendarReadQuery(value) ||
    isAirconReadQuery(value) || isLikelyAgentChatQuery(value) || isLikelyHomeAgentQuery(value) ||
    /[？?]\s*$|(?:教えて|調べて|検索して|相談|確認して|どう|なに|何)/.test(value);
}

function getSuggestedHomeInputRoute(intent) {
  if (intent === HOME_INPUT_INTENTS.CONSULT_LIKELY) return "consult";
  if (intent === HOME_INPUT_INTENTS.REGISTER_LIKELY) return "register";
  return "";
}

function renderHomeInputIntentConfirmation(options) {
  const selectedRoute = options?.selectedRoute === "register" ? "register" : "consult";
  const suggestedRoute = options?.suggestedRoute === "register" ? "register" : "consult";
  pendingHomeInputIntentConfirmation = {
    memo: String(options?.memo || ""),
    selectedRoute,
    suggestedRoute,
  };
  const isRegisterSuggestion = suggestedRoute === "register";
  homeIntentConfirmMessage.textContent = isRegisterSuggestion
    ? "登録する内容っぽいで。予定やタスクとして登録する？"
    : "これは相談したら、今ここで答えられそうやで。";
  homeIntentConfirmSwitch.textContent = HOME_INPUT_ACTIONS[suggestedRoute].label;
  homeIntentConfirmKeep.textContent = selectedRoute === "consult" ? "💬 相談のまま進む" : "📝 登録のまま進む";
  homeIntentConfirm.classList.remove("is-hidden");
  revealPanelIfNeeded(homeIntentConfirm);
}

function hideHomeInputIntentConfirmation() {
  pendingHomeInputIntentConfirmation = null;
  homeIntentConfirm.classList.add("is-hidden");
}

function renderHomeInputActionButtons(sendingRoute = "") {
  ["consult", "register"].forEach((route) => {
    const action = HOME_INPUT_ACTIONS[route];
    const button = route === "consult" ? askPaluruButton : saveToPaluruButton;
    const hint = route === "consult" ? consultActionHint : registerActionHint;
    const isSendingRoute = sendingRoute === route;
    button.textContent = isSendingRoute ? action.sendingLabel : action.label;
    button.setAttribute("aria-label", action.label + "。" + action.hint);
    hint.textContent = action.hint;
  });
}

async function routePaluruRequest(memo) {
  if (isAutomationControlRequest(memo)) {
    await submitAgentChatQuery(memo, { purpose: "automation-action" });
    return;
  }

  if (isAirconOperationRequest(memo)) {
    await submitAgentChatQuery(memo, { purpose: "aircon-action" });
    return;
  }

  // Weather, including umbrella questions, is the Phase 1A Tool Calling domain.
  // School and Lunch remain on the legacy HomeAgent path until their migration.
  if (isLegacyHomeAgentPriorityQuery(memo) && !isWeatherQuery(memo)) {
    await submitHomeAgentQuery(memo);
    return;
  }

  const calendarWriteRequest = isCalendarWriteRequest(memo);

  if (calendarWriteRequest) {
    await submitAgentChatQuery(memo, { purpose: "calendar-write-guidance" });
    return;
  }

  if (isTodayParuruQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "today-paruru" });
    return;
  }

  if (isCalendarReadQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "calendar" });
    return;
  }

  if (isAirconReadQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "home-read" });
    return;
  }

  if (isRoomTemperatureReadQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "home-read" });
    return;
  }

  if (isWeatherQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "weather" });
    return;
  }

  if (isLikelyAgentChatQuery(memo)) {
    await submitAgentChatQuery(memo, { purpose: "home-read" });
    return;
  }

  await submitAgentChatQuery(memo, { purpose: "general" });
}

async function savePaluruMemo(memoOverride = "") {
  if (isSubmitting) {
    return;
  }

  const memo = String(memoOverride || memoInput.value || "").trim();
  if (!memo) {
    setParuruState("empty", { showStatus: true });
    memoInput.focus();
    return;
  }

  const payload = buildCreateWithAIPayload(memo);

  setSending(true, "ぱるるが整理中…", "save");
  setParuruState("sending");
  showMessage(PARURU_STATES.sending.line, "");

  try {
    const result = await saveMemo(payload);
    form.reset();
    categoryInput.value = "";
    resetExplicitSelectionState();
    showSuccessResult(result);
    await loadNotificationCandidates({ force: true });
    if (activeView === "inbox") {
      await loadInbox();
    }
  } catch (error) {
    setParuruState("error", { showStatus: true });
  } finally {
    setSending(false);
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.targetView));
});

if (typeof document.addEventListener === "function") {
  document.addEventListener("paruru:view-request", (event) => {
    const viewName = event && event.detail && event.detail.viewName;
    switchView(viewName);
  });
}

refreshInboxButton.addEventListener("click", loadInbox);

inboxList.addEventListener("click", (event) => {
  if (event.target.closest("[data-inbox-retry]")) {
    loadInbox();
    return;
  }

  const card = event.target.closest(".inbox-card");
  if (!card) {
    return;
  }

  openDetail(card.dataset.id);
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = editId.value;
  const memo = editMemo.value.trim();
  if (!memo) {
    setParuruState("empty", { showStatus: true });
    editMemo.focus();
    return;
  }

  try {
    await updateInboxItem(id, buildEditUpdatePayload({
      title: editTitle.value.trim() || memo.slice(0, 20),
      memo,
      category: editCategory.value,
      priority: editPriority.value,
      type: editType.value,
      status: editStatus.value,
    }));
  } catch (error) {
    debugLog("[Paruru] edit update failed", error?.message || error);
    setParuruState("error", { showStatus: true });
    return;
  }

  detailDialog.close();
  try {
    const inboxLoaded = await loadInbox({ quiet: true });
    if (!inboxLoaded) throw new Error("INBOX_REFRESH_FAILED");
    await loadNotificationCandidates({ force: true, throwOnError: true });
  } catch (error) {
    debugLog("[Paruru] edit refresh failed", error?.message || error);
    showMessage("保存はできたけど、一覧の更新に失敗したで。", "error");
    return;
  }
  setParuruState("success", { showStatus: true });
});

editType.addEventListener("change", updateEditFormVisibility);
editShoppingTiming.addEventListener("change", () => {
  shoppingTimingTouched = true;
  updateEditFormVisibility();
});
editDueDate.addEventListener("change", () => {
  if (normalizeType(editType.value) === "shopping" && editShoppingTiming.value === "custom") {
    shoppingTimingTouched = true;
  }
});

doneButton.addEventListener("click", async () => {
  const id = editId.value;
  try {
    await updateInboxItem(id, { status: "Done" });
  } catch (error) {
    debugLog("[Paruru] complete update failed", error?.message || error);
    setParuruState("error");
    showMessage(buildInboxUpdateFailureMessage_(error), "error");
    return;
  }

  detailDialog.close();
  try {
    const inboxLoaded = await loadInbox({ quiet: true });
    if (!inboxLoaded) throw new Error("INBOX_REFRESH_FAILED");
    await loadNotificationCandidates({ force: true, throwOnError: true });
  } catch (error) {
    debugLog("[Paruru] complete refresh failed", error?.message || error);
    showMessage("完了できたけど、一覧の更新に失敗したで。", "error");
    return;
  }
  setParuruState("done", { showStatus: true });
});

deleteButton.addEventListener("click", () => {
  setParuruState("deleteConfirm", { showStatus: true });
  deleteDialog.showModal();
});

confirmDeleteButton.addEventListener("click", async () => {
  await deleteInboxItem(editId.value);
  deleteDialog.close();
  detailDialog.close();
  await loadInbox({ quiet: true });
  await loadNotificationCandidates({ force: true });
  setParuruState("deleted", { showStatus: true });
});

homeFollowupSubmit.addEventListener("click", () => submitFollowupAnswer("home"));
detailFollowupSubmit.addEventListener("click", () => submitFollowupAnswer("detail"));
homeFollowupLater.addEventListener("click", () => hideFollowupPanel("home"));
detailFollowupLater.addEventListener("click", () => hideFollowupPanel("detail"));
homeFollowup.addEventListener("click", (event) => handleFollowupPanelClick(event, "home"));
detailFollowup.addEventListener("click", (event) => handleFollowupPanelClick(event, "detail"));
homeCalendarSubmit.addEventListener("click", () => submitCalendarSync("home"));
detailCalendarSubmit.addEventListener("click", () => submitCalendarSync("detail"));
homeCalendarLater.addEventListener("click", () => hideCalendarSyncPanel("home"));
detailCalendarLater.addEventListener("click", () => hideCalendarSyncPanel("detail"));
refreshNotificationsButton.addEventListener("click", () => loadNotificationCandidates({ force: true }));
todayParuruList.addEventListener("click", (event) => {
  if (event.target.closest("[data-notification-refresh]")) {
    loadNotificationCandidates({ force: true });
    return;
  }

  const item = event.target.closest("[data-notification-id]");
  if (!item) {
    return;
  }
  if (item.dataset.healthAction === "daily" && item.dataset.healthSlot) {
    switchView("nurse-okan", {
      action: "daily",
      slot: item.dataset.healthSlot,
      targetUserId: item.dataset.healthTargetUserId,
    });
    return;
  }
  openNotificationDetail(item.dataset.notificationId);
});
todayParuruAllButton.addEventListener("click", () => switchView("inbox"));
homeAgentRetryButton.addEventListener("click", () => {
  if (isSubmitting || !pendingHomeAgentRetry) {
    return;
  }
  if (pendingHomeAgentRetry.type === "agentChat") {
    submitAgentChatQuery(pendingHomeAgentRetry.message, { request: pendingHomeAgentRetry });
    return;
  }
  if (pendingHomeAgentRetry.type === "homeAgent") {
    submitHomeAgentQuery(pendingHomeAgentRetry.message, { clientRequestId: pendingHomeAgentRetry.clientRequestId });
  }
});
homeAgentCloseButton.addEventListener("click", hideHomeAgentCard);
homeAgentCard.addEventListener("click", (event) => {
  if (event.target.closest("[data-home-agent-action-unconnected]")) {
    const confirmPanel = homeAgentContent.querySelector("[data-home-agent-confirm]");
    if (confirmPanel && !confirmPanel.querySelector(".home-agent-info")) {
      confirmPanel.insertAdjacentHTML("beforeend", `<p class="home-agent-info">実操作はまだ準備中やで。</p>`);
    }
    setParuruSpeech("idle", "実操作はまだ準備中やで。");
    return;
  }

  if (event.target.closest("[data-home-agent-action-execute]")) {
    executePendingHomeAgentAction();
    return;
  }

  const signageButton = event.target.closest("[data-home-agent-signage]");
  if (signageButton) {
    renderSignageConfirmation(signageButton.dataset.homeAgentSignage || "");
    return;
  }

  const actionButton = event.target.closest("[data-home-agent-action]");
  if (actionButton) {
    renderHomeAgentActionConfirmation(parseHomeAgentActionCandidate(actionButton.dataset.homeAgentAction || ""));
    return;
  }

  if (event.target.closest("[data-home-agent-confirm-close]")) {
    cancelPendingHomeAgentAction();
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userProfile = saveUserProfileFromForm();
  renderProfileForm();
  showMessage(formatParuruLine_(PARURU_MESSAGES.action.profileSaved), "success");
  await loadNotificationCandidates({ force: true });
});

homeControlEnableButton?.addEventListener("click", () => beginHomeControlPairing());
homeControlApproveButton?.addEventListener("click", () => approveHomeControlPairing());
homeControlDeviceList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-home-control-revoke]");
  if (button) revokeHomeControlDevice(button.dataset.homeControlRevoke || "");
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`)?.close();
  });
});

async function switchView(viewName) {
  const options = arguments[1] || {};
  const resolvedView = normalizeAllowedView_(viewName);
  if (!resolvedView) return;
  activeView = resolvedView;
  views.forEach((view) => {
    const allowed = isViewAllowed_(view.dataset.view);
    view.hidden = !allowed;
    view.classList.toggle("is-active", allowed && view.dataset.view === resolvedView);
  });
  navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.targetView === resolvedView));
  showMessage("", "");

  if (resolvedView === "inbox") {
    await loadInbox();
    return;
  }

  if (resolvedView === "home") {
    await loadNotificationCandidates();
  }

  if (resolvedView === "settings") {
    renderProfileForm();
    await renderHomeControlSettings();
  }

  if (resolvedView === "nurse-okan") {
    document.dispatchEvent(new CustomEvent("nurse-okan:opened", { detail: options || {} }));
  }

  if (resolvedView === "popio-health") {
    document.dispatchEvent(new CustomEvent("popio-health:opened", { detail: options || {} }));
  }

  setParuruState("normal");
}

async function loadInbox(options = {}) {
  if (!options.quiet) {
    setParuruState("loading");
    renderInboxLoading();
  }

  try {
    inboxItems = await fetchInboxItems();
    renderInboxList(inboxItems);
    if (inboxItems.length === 0) {
      setParuruState("inboxEmpty");
    } else if (!options.quiet) {
      setParuruState("normal");
    }
  } catch (error) {
    renderInboxError();
    setParuruState("error", { showStatus: true });
    return false;
  }

  return true;
}

async function saveMemo(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummyCreate(payload);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parseApiResponse(response);
}

async function callHomeAgent(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummyHomeAgent(payload);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parseApiResponse(response);
}

async function callAgentChat(payload) {
  if (!GAS_WEB_APP_URL) {
    throw new Error("PALURU Mini Gateway is unavailable");
  }

  const diagnostic = createAgentChatDiagnosticContext_(payload);
  logAgentChatDiagnostic_("info", "REQUEST_START", diagnostic, {});
  let response;
  try {
    response = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logAgentChatDiagnostic_("error", "FETCH_FAILED", diagnostic);
    throw createAgentChatClientError("AGENT_UNAVAILABLE", "FETCH_FAILED");
  }

  const responseDetails = getAgentChatResponseDetails_(response);
  logAgentChatDiagnostic_("info", "FETCH_RESPONSE", diagnostic, responseDetails);

  if (!response.ok) {
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_UNAVAILABLE" });
    throw createAgentChatClientError("AGENT_UNAVAILABLE", "HTTP_NOT_OK");
  }

  let rawResponse;
  let result;
  try {
    rawResponse = await response.clone().text();
  } catch (error) {
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_UNAVAILABLE" });
    throw createAgentChatClientError("AGENT_UNAVAILABLE", "BODY_READ_FAILED");
  }

  const bodyDetails = getAgentChatResponseBodyDetails_(rawResponse, responseDetails.contentType);
  if (bodyDetails.isEmpty) {
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_UNAVAILABLE" });
    throw createAgentChatClientError("AGENT_UNAVAILABLE", "EMPTY_RESPONSE");
  }

  try {
    result = JSON.parse(rawResponse);
  } catch (error) {
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_UNAVAILABLE" });
    throw createAgentChatClientError("AGENT_UNAVAILABLE", "JSON_PARSE_FAILED");
  }

  if (!result || typeof result !== "object") {
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_ERROR" });
    throw createAgentChatClientError("AGENT_ERROR", "INVALID_RESPONSE_SHAPE");
  }

  if (!result || result.success !== true) {
    const code = String(result && result.error && result.error.code || "AGENT_ERROR");
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code });
    throw createAgentChatClientError([
      "ACTOR_CONTRACT_INVALID", "TOOL_DISABLED", "CLIMATE_UNAVAILABLE", "WEATHER_UNAVAILABLE",
      "CALENDAR_UNAVAILABLE", "ROOM_NOT_FOUND", "FOLLOWUP_REQUIRED", "ACTION_NOT_ALLOWED",
      "CONFIRMATION_EXPIRED", "CONFIRMATION_ACTOR_MISMATCH", "AGENT_UNAVAILABLE", "AGENT_ERROR",
      "AGENT_BUSY", "AGENT_RATE_LIMITED", "CONFIGURATION_ERROR", "INVALID_INPUT", "TODAY_PARURU_UNAVAILABLE", "AUTOMATION_UPSTREAM_ERROR",
      "UPSTREAM_ERROR"
    ].includes(code) ? code : "AGENT_ERROR", "API_SUCCESS_FALSE");
  }
  try {
    const validated = validateAgentChatResponse(result, payload);
    logAgentChatDiagnostic_("info", "RESPONSE_OK", diagnostic, responseDetails);
    return validated;
  } catch (error) {
    const reason = error?.agentChatReason || "INVALID_RESPONSE_SHAPE";
    logAgentChatDiagnostic_("error", "API_ERROR", diagnostic, { ...responseDetails, code: "AGENT_ERROR" });
    throw createAgentChatClientError("AGENT_ERROR", reason);
  }
}

function createAgentChatDiagnosticContext_(payload) {
  return {
    action: String(payload?.action || "agentChat"),
    clientRequestIdSuffix: String(payload?.clientRequestId || "").slice(-8),
    startedAtMs: Date.now(),
  };
}

function getAgentChatResponseDetails_(response) {
  return {
    httpStatus: Number(response?.status || 0),
    contentType: String(response?.headers?.get?.("content-type") || ""),
  };
}

function getAgentChatResponseBodyDetails_(rawResponse, contentType) {
  const body = String(rawResponse || "");
  const trimmed = body.trim();
  const looksLikeHtml = /^<!doctype html|^<html[\s>]/i.test(trimmed);
  const looksLikeJson = /^[{\[]/.test(trimmed);
  return {
    contentType: String(contentType || ""),
    responseLength: body.length,
    isEmpty: trimmed.length === 0,
    reason: looksLikeHtml ? "HTML_RESPONSE" : looksLikeJson ? "JSON_RESPONSE" : "TEXT_RESPONSE",
  };
}

function logAgentChatDiagnostic_(level, reason, diagnostic, details = {}) {
  const output = {
    event: String(reason || "API_ERROR"),
    action: String(diagnostic?.action || "agentChat"),
    clientRequestIdSuffix: String(diagnostic?.clientRequestIdSuffix || ""),
    httpStatus: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null,
    errorCode: String(details.code || "").replace(/[^A-Z0-9_]/g, "").slice(0, 80) || null,
    elapsedMs: Math.max(0, Date.now() - Number(diagnostic?.startedAtMs || Date.now())),
    buildId: typeof BUILD_ID === "string" ? BUILD_ID : "",
  };
  const logger = level === "error" ? console.error : console.info;
  logger("[PALURU agentChat]", output);
}

function sanitizeAgentPerformanceDiagnostic_(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const keys = ["routerMs", "serviceMs", "totalMs", "openAiCallCount", "serviceCallCount"];
  const result = {};
  for (const key of keys) {
    const numeric = Number(source[key]);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    result[key] = numeric;
  }
  return result;
}

function createAgentChatClientError(code, agentChatReason = "") {
  const error = new Error("Agent Gateway request failed");
  error.code = code;
  error.agentChatReason = agentChatReason;
  return error;
}

async function executeHomeAgentAction(candidate) {
  if (!canUseHomeControl_()) throw createHomeControlError("HOME_CONTROL_FORBIDDEN");
  if (!GAS_WEB_APP_URL) {
    return {
      success: true,
      result: {
        activePause: candidate?.skill === "pauseRoomAutomation"
          ? { expiresAt: candidate?.parameters?.expiresAt || "" }
          : null,
      },
      message: "dummy home agent action",
    };
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "homeAgentAction",
      confirmationId: String(candidate?.confirmationId || ""),
      clientRequestId: String(candidate?.clientRequestId || ""),
      pairingToken: getHomeAgentPairingToken(),
    }),
  });

  return parseApiResponse(response);
}

async function executeAgentActionConfirmation(candidate) {
  if (!canUseHomeControl_()) throw createHomeControlError("HOME_CONTROL_FORBIDDEN");
  if (!GAS_WEB_APP_URL) {
    return {
      success: true,
      operation: candidate?.command === "automation.resume" ? "resume" : "pause",
      result: {
        activePause: candidate?.command === "automation.pause" ? { expiresAt: "" } : null,
      },
    };
  }

  const profile = getCurrentProfile();
  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "agentActionConfirm",
      confirmationId: String(candidate?.confirmationId || ""),
      clientRequestId: String(candidate?.clientRequestId || ""),
      deviceId: profile.deviceId,
      pairingToken: getHomeAgentPairingToken(),
    }),
  });

  return parseApiResponse(response);
}

async function cancelAgentActionConfirmation(candidate) {
  if (!canUseHomeControl_()) throw createHomeControlError("HOME_CONTROL_FORBIDDEN");
  if (!GAS_WEB_APP_URL) {
    return { success: true, status: "cancelled" };
  }
  const profile = getCurrentProfile();
  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "agentActionCancel",
      confirmationId: String(candidate?.confirmationId || ""),
      clientRequestId: String(candidate?.clientRequestId || ""),
      deviceId: profile.deviceId,
      pairingToken: getHomeAgentPairingToken(),
    }),
  });
  return parseApiResponse(response);
}

async function callHomeControlApi(payload) {
  if (!GAS_WEB_APP_URL) throw createHomeControlError("HOME_CONTROL_UNAVAILABLE");
  let response;
  try {
    response = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw createHomeControlError("HOME_CONTROL_UNAVAILABLE", { cause });
  }
  if (!response.ok) throw createHomeControlError("HOME_CONTROL_UNAVAILABLE", { httpStatus: response.status, response: await readHomeControlErrorResponse_(response) });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw createHomeControlError("HOME_CONTROL_UNAVAILABLE", { httpStatus: response.status, cause: error });
  }
  if (!result || result.success !== true) {
    throw createHomeControlError(String(result?.error?.code || "HOME_CONTROL_FAILED"), { httpStatus: response.status, response: result, message: result?.message });
  }
  return result.data || {};
}

async function readHomeControlErrorResponse_(response) {
  try { return await response.clone().json(); } catch (_) { return null; }
}

function createHomeControlError(code, details = {}) {
  const error = new Error(String(details.message || "Home control request failed"));
  error.code = String(code || "HOME_CONTROL_FAILED");
  if (Number.isFinite(Number(details.httpStatus))) error.httpStatus = Number(details.httpStatus);
  if (Object.prototype.hasOwnProperty.call(details, "response")) error.response = details.response;
  if (details.cause) error.cause = details.cause;
  return error;
}

function getHomeControlPending() {
  try {
    const value = JSON.parse(localStorage.getItem(HOME_CONTROL_PENDING_STORAGE_KEY) || "");
    return value && isUuid(value.requestId) && typeof value.requestSecret === "string" && typeof value.token === "string" ? value : null;
  } catch (error) {
    return null;
  }
}

function saveHomeControlPending(value) {
  localStorage.setItem(HOME_CONTROL_PENDING_STORAGE_KEY, JSON.stringify(value));
}

function clearHomeControlPending() {
  localStorage.removeItem(HOME_CONTROL_PENDING_STORAGE_KEY);
  if (homeControlPollTimer) {
    clearTimeout(homeControlPollTimer);
    homeControlPollTimer = null;
  }
}

function isHomeControlPendingExpired_(pending) {
  const now = Date.now();
  const codeExpiresAt = Date.parse(String(pending?.expiresAt || ""));
  const requestExpiresAt = Number(pending?.requestExpiresAt || 0);
  return (Number.isFinite(codeExpiresAt) && now >= codeExpiresAt)
    || (Number.isFinite(requestExpiresAt) && requestExpiresAt > 0 && now >= requestExpiresAt);
}

function expireHomeControlPending_() {
  clearHomeControlPending();
  showAuthenticationState("承認期限が切れました。もう一度登録してください。", "unpaired");
}

const getMembershipRegistrationPending = function() {
  try {
    const value = JSON.parse(localStorage.getItem(MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY) || "");
    return value && value.kind === "membership" && isUuid(value.requestId) && typeof value.requestSecret === "string" && /^\d{6}$/.test(String(value.code || "")) ? value : null;
  } catch (error) {
    return null;
  }
};

const saveMembershipRegistrationPending = function(value) {
  localStorage.setItem(MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY, JSON.stringify(value));
};

const clearMembershipRegistrationPending = function() {
  localStorage.removeItem(MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY);
  if (membershipRegistrationPollTimer) {
    clearTimeout(membershipRegistrationPollTimer);
    membershipRegistrationPollTimer = null;
  }
};

const isMembershipRegistrationPendingExpired_ = function(pending) {
  const now = Date.now();
  const codeExpiresAt = Date.parse(String(pending?.expiresAt || ""));
  const requestExpiresAt = Number(pending?.requestExpiresAt || 0);
  return (Number.isFinite(codeExpiresAt) && now >= codeExpiresAt)
    || (Number.isFinite(requestExpiresAt) && requestExpiresAt > 0 && now >= requestExpiresAt);
};

const expireMembershipRegistrationPending_ = function() {
  clearMembershipRegistrationPending();
  if (authLockMembershipMessage) authLockMembershipMessage.textContent = "承認期限が切れました。もう一度申請してください。";
  renderMembershipRegistrationLock_();
};

function setHomeControlMessage(message, type = "") {
  if (!homeControlMessage) return;
  homeControlMessage.textContent = message || "";
  homeControlMessage.className = `form-message${type ? ` ${type}` : ""}`;
}

function formatHomeControlExpiry(value) {
  const expires = Date.parse(String(value || ""));
  const remaining = Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - Date.now()) / 1000)) : 0;
  return remaining > 0 ? `有効期限：あと${Math.ceil(remaining / 60)}分` : "承認コードの期限が切れました。";
}

async function createHomeControlToken() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) throw createHomeControlError("HOME_CONTROL_CRYPTO_UNAVAILABLE");
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return { token, tokenHash };
}

async function beginHomeControlPairing() {
  if (homeControlEnableButton?.disabled) return;
  const profile = getCurrentProfile();
  const displayName = String(homeControlDeviceName?.value || profile.displayName || "この端末").trim();
  if (!displayName) {
    setHomeControlMessage("端末名を入力してな。", "error");
    return;
  }
  homeControlEnableButton.disabled = true;
  setHomeControlMessage("登録コードを準備中…");
  try {
    const generated = await createHomeControlToken();
    const data = await callHomeControlApi({ action: "devicePairingBegin", deviceId: profile.deviceId, displayName, tokenHash: generated.tokenHash });
    if (!isUuid(data.requestId) || !/^\d{6}$/.test(String(data.code || "")) || !String(data.requestSecret || "")) throw createHomeControlError("HOME_CONTROL_FAILED");
    saveHomeControlPending({ requestId: data.requestId, requestSecret: data.requestSecret, token: generated.token, code: data.code, expiresAt: data.expiresAt, requestExpiresAt: Date.now() + 15 * 60 * 1000, displayName });
    renderAuthenticationLock_();
  } catch (error) {
    setHomeControlMessage(getHomeControlPublicMessage(error?.code), "error");
  } finally {
    if (homeControlEnableButton) homeControlEnableButton.disabled = false;
  }
}

const beginMembershipRegistration = async function() {
  if (authLockMembershipBeginButton?.disabled) return;
  const profile = userProfile || loadUserProfile();
  const pairingToken = getHomeAgentPairingToken();
  if (!pairingToken) return;
  if (authLockMembershipBeginButton) authLockMembershipBeginButton.disabled = true;
  if (authLockMembershipMessage) authLockMembershipMessage.textContent = "家族登録の承認コードを準備中…";
  try {
    const data = await callHomeControlApi({ action: "membershipRegistrationBegin", deviceId: profile.deviceId, pairingToken });
    if (!isUuid(data.requestId) || !/^\d{6}$/.test(String(data.code || "")) || !String(data.requestSecret || "") ||
      !Number.isFinite(Date.parse(String(data.expiresAt || "")))) {
      throw createHomeControlError("MEMBERSHIP_REGISTRATION_REQUEST_INVALID");
    }
    saveMembershipRegistrationPending({
      kind: "membership", requestId: data.requestId, requestSecret: data.requestSecret,
      code: data.code, expiresAt: data.expiresAt, requestExpiresAt: Date.now() + 15 * 60 * 1000,
    });
    if (authLockMembershipMessage) authLockMembershipMessage.textContent = "父PCで承認してください。";
    renderMembershipRegistrationLock_();
  } catch (error) {
    if (authLockMembershipMessage) authLockMembershipMessage.textContent = getHomeControlPublicMessage(error?.code);
  } finally {
    if (authLockMembershipBeginButton) authLockMembershipBeginButton.disabled = false;
  }
};

async function pollHomeControlPairing() {
  const pending = getHomeControlPending();
  if (!pending) return;
  if (isHomeControlPendingExpired_(pending)) {
    expireHomeControlPending_();
    return;
  }
  try {
    const data = await callHomeControlApi({ action: "devicePairingStatus", requestId: pending.requestId, requestSecret: pending.requestSecret });
    if (data.status === "active") {
      localStorage.setItem(HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY, pending.token);
      clearHomeControlPending();
      setHomeControlMessage("この端末を登録したで。", "success");
      await initializeAuthenticatedPwa();
      return;
    }
    pending.expiresAt = data.expiresAt || pending.expiresAt;
    saveHomeControlPending(pending);
  } catch (error) {
    setHomeControlMessage(getHomeControlPublicMessage(error?.code), "error");
    if (["PAIRING_REQUEST_INVALID", "INVALID_PAIRING_CODE", "DEVICE_ALREADY_REGISTERED", "UNAUTHORIZED_DEVICE"].includes(error?.code)) {
      clearHomeControlPending();
      showAuthenticationState("端末登録を確認できませんでした。", "revoked_error");
      return;
    }
  }
  scheduleHomeControlPoll();
}

function scheduleHomeControlPoll() {
  if (homeControlPollTimer) clearTimeout(homeControlPollTimer);
  if (getHomeControlPending()) homeControlPollTimer = setTimeout(() => pollHomeControlPairing(), HOME_CONTROL_POLL_MILLISECONDS);
}

const pollMembershipRegistration = async function() {
  const pending = getMembershipRegistrationPending();
  if (!pending) return;
  if (isMembershipRegistrationPendingExpired_(pending)) {
    expireMembershipRegistrationPending_();
    return;
  }
  const profile = userProfile || loadUserProfile();
  const pairingToken = getHomeAgentPairingToken();
  if (!pairingToken) {
    clearMembershipRegistrationPending();
    showAuthenticationState("端末登録を確認できませんでした。", "revoked_error");
    return;
  }
  try {
    const data = await callHomeControlApi({
      action: "membershipRegistrationStatus", deviceId: profile.deviceId, pairingToken,
      requestId: pending.requestId, requestSecret: pending.requestSecret,
    });
    if (data.status === "approved") {
      try {
        const membershipContext = await callHomeControlApi({ action: "membership.context.get", deviceId: profile.deviceId, pairingToken });
        activateMembershipContext_(membershipContext);
        return;
      } catch (error) {
        if (["MEMBERSHIP_REGISTRATION_REQUEST_INVALID", "PAIRING_REQUEST_INVALID", "UNAUTHORIZED_DEVICE"].includes(error?.code)) {
          clearMembershipRegistrationPending();
          renderMembershipRegistrationLock_();
          return;
        }
        if (authLockMembershipMessage) authLockMembershipMessage.textContent = "家族登録を確認中です。";
      }
    } else if (data.status === "expired") {
      expireMembershipRegistrationPending_();
      return;
    } else if (data.status !== "pending") {
      clearMembershipRegistrationPending();
      renderMembershipRegistrationLock_();
      return;
    } else {
      pending.expiresAt = data.expiresAt || pending.expiresAt;
      saveMembershipRegistrationPending(pending);
    }
  } catch (error) {
    if (authLockMembershipMessage) authLockMembershipMessage.textContent = getHomeControlPublicMessage(error?.code);
    if (["MEMBERSHIP_REGISTRATION_REQUEST_INVALID", "PAIRING_REQUEST_INVALID", "UNAUTHORIZED_DEVICE"].includes(error?.code)) {
      clearMembershipRegistrationPending();
      renderMembershipRegistrationLock_();
      return;
    }
  }
  scheduleMembershipRegistrationPoll();
};

const scheduleMembershipRegistrationPoll = function() {
  if (membershipRegistrationPollTimer) clearTimeout(membershipRegistrationPollTimer);
  if (getMembershipRegistrationPending()) {
    membershipRegistrationPollTimer = setTimeout(() => pollMembershipRegistration(), HOME_CONTROL_POLL_MILLISECONDS);
  }
};

async function approveHomeControlPairing() {
  if (!canApproveHomeControlPairing_()) {
    setHomeControlMessage("この端末では新しい端末を承認できません。", "error");
    return;
  }
  const membershipTemplate = String(homeControlMembershipTemplate?.value || "").trim();
  if (!["father_add_device", "second_son_initial"].includes(membershipTemplate)) {
    setHomeControlMessage("登録する家族を選んでな。", "error");
    return;
  }
  const code = String(homeControlApproveCode?.value || "").trim();
  const profile = getCurrentProfile();
  if (!/^\d{6}$/.test(code)) {
    setHomeControlMessage("6桁の承認コードを入力してな。", "error");
    return;
  }
  if (homeControlApproveButton) homeControlApproveButton.disabled = true;
  try {
    const response = await callHomeControlApi({ action: "devicePairingApprove", deviceId: profile.deviceId, pairingToken: getHomeAgentPairingToken(), code, membershipTemplate });
    logDevicePairingApprovalResult_({ action: "devicePairingApprove", pairingCode: code, membershipTemplate, deviceId: profile.deviceId, success: true, errorCode: "", message: "", response });
    if (homeControlApproveCode) homeControlApproveCode.value = "";
    setHomeControlMessage("新しい端末を承認したで。", "success");
    await renderHomeControlSettings();
  } catch (error) {
    logDevicePairingApprovalResult_({ action: "devicePairingApprove", pairingCode: code, membershipTemplate, deviceId: profile.deviceId, success: false, errorCode: String(error?.response?.error?.code || error?.code || ""), message: String(error?.response?.message || error?.message || ""), response: error?.response || null });
    setHomeControlMessage(getHomeControlPublicMessage(error?.code), "error");
  } finally {
    if (homeControlApproveButton) homeControlApproveButton.disabled = false;
  }
}

function logDevicePairingApprovalResult_(details) {
  const entry = {
    action: String(details?.action || "devicePairingApprove"),
    pairingCode: String(details?.pairingCode || ""),
    membershipTemplate: String(details?.membershipTemplate || ""),
    deviceId: String(details?.deviceId || ""),
    success: Boolean(details?.success),
    errorCode: String(details?.errorCode || ""),
    message: String(details?.message || ""),
    response: details?.response || null,
  };
  (entry.success ? console.info : console.error)("[Paruru] devicePairingApprove", entry);
}

function canApproveHomeControlPairing_() {
  return appAuthenticationState === "active_member" && activeMembershipContext?.role === "admin";
}

async function revokeHomeControlDevice(targetDeviceId) {
  if (!canApproveHomeControlPairing_()) {
    return;
  }
  const profile = getCurrentProfile();
  try {
    await callHomeControlApi({ action: "devicePairingRevoke", deviceId: profile.deviceId, pairingToken: getHomeAgentPairingToken(), targetDeviceId });
    if (targetDeviceId === profile.deviceId) localStorage.removeItem(HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY);
    setHomeControlMessage("端末を失効したで。", "success");
    await renderHomeControlSettings();
  } catch (error) {
    setHomeControlMessage(getHomeControlPublicMessage(error?.code), "error");
  }
}

async function renderHomeControlSettings() {
  const profile = getCurrentProfile();
  const token = getHomeAgentPairingToken();
  const pending = getHomeControlPending();
  if (homeControlUnregistered) homeControlUnregistered.hidden = Boolean(token || pending);
  if (homeControlPending) homeControlPending.hidden = !pending;
  if (homeControlRegistered) homeControlRegistered.hidden = !token;
  const canApprove = canApproveHomeControlPairing_();
  if (homeControlApprovePanel) homeControlApprovePanel.hidden = !canApprove;
  if (homeControlApproveButton) homeControlApproveButton.disabled = !canApprove;
  if (homeControlDeviceList) {
    homeControlDeviceList.hidden = !canApprove;
    if (!canApprove) homeControlDeviceList.replaceChildren();
  }
  if (pending) {
    if (homeControlPendingCode) homeControlPendingCode.textContent = String(pending.code || "");
    if (homeControlPendingExpiry) homeControlPendingExpiry.textContent = formatHomeControlExpiry(pending.expiresAt);
    if (homeControlStatus) homeControlStatus.textContent = "この端末の承認を待っています。";
    scheduleHomeControlPoll();
    return;
  }
  if (!token) {
    if (homeControlStatus) homeControlStatus.textContent = "この端末は未登録です。";
    if (homeControlDeviceName && !homeControlDeviceName.value) homeControlDeviceName.value = `${profile.displayName || "ぱるる"}の端末`;
    return;
  }
  if (homeControlStatus) homeControlStatus.textContent = "この端末は登録済みです。";
  if (homeControlRegisteredLabel) homeControlRegisteredLabel.textContent = `${profile.displayName || "この"}端末で家電操作を利用できます。`;
  if (!canApprove) {
    return;
  }
  try {
    const data = await callHomeControlApi({ action: "devicePairingList", deviceId: profile.deviceId, pairingToken: token });
    renderHomeControlDeviceList(Array.isArray(data.devices) ? data.devices : []);
  } catch (error) {
    setHomeControlMessage(getHomeControlPublicMessage(error?.code), "error");
  }
}

function renderHomeControlDeviceList(devices) {
  if (!homeControlDeviceList) return;
  homeControlDeviceList.innerHTML = devices.length ? devices.map((device) => {
    const label = escapeHtml(String(device.displayName || "登録済み端末"));
    const state = device.status === "active" ? "登録済み" : device.status === "revoked" ? "失効済み" : "承認待ち";
    const isCurrent = device.isCurrent === true;
    const current = isCurrent ? '<span>この端末</span>' : "";
    const revoke = device.status === "active" && !isCurrent ? `<button type="button" class="secondary-button" data-home-control-revoke="${escapeHtml(String(device.deviceId || ""))}">失効</button>` : "";
    return `<div class="home-control-device-row"><span>${label}（${state}）</span>${current}${revoke}</div>`;
  }).join("") : "<p>登録済み端末を読み込めませんでした。</p>";
}

function getHomeControlPublicMessage(code) {
  if (code === "DEVICE_LIMIT_REACHED") return "登録できる端末数の上限です。";
  if (code === "PAIRING_CODE_RATE_LIMITED") return "承認コードの確認回数が多すぎます。しばらく待ってな。";
  if (code === "UNAUTHORIZED_DEVICE") return "この端末の登録状態を確認できませんでした。";
  if (code === "INVALID_PAIRING_CODE") return "承認コードを確認できませんでした。";
  return "家電操作の端末登録を完了できませんでした。";
}

function buildHomeAgentPayload(messageText, options = {}) {
  const profile = getCurrentProfile();
  return {
    action: "homeAgent",
    message: messageText,
    userId: profile.userId,
    userDisplayName: profile.displayName,
    calendarSuffix: profile.calendarSuffix,
    deviceId: profile.deviceId,
    clientRequestId: options.clientRequestId || createUuid(),
    pairingToken: getHomeAgentPairingToken(),
    conversationId: "",
    context: homeAgentConversationContext,
  };
}

async function submitHomeAgentQuery(messageText, options = {}) {
  const payload = buildHomeAgentPayload(messageText, options);
  pendingHomeAgentRetry = { type: "homeAgent", message: messageText, clientRequestId: payload.clientRequestId };
  clearAgentFormMessage();
  setSending(true, PARURU_MESSAGES.action.homeAgentLoading, "ask");
  setParuruSpeech("idle", "ちょっと家の中、見てくる。");
  renderHomeAgentLoading();

  try {
    const response = await callHomeAgent(payload);
    const result = normalizeHomeAgentResult(response);
    if (result.conversationContext) {
      homeAgentConversationContext = result.conversationContext;
    }
    memoInput.value = "";
    pendingHomeAgentRetry = null;
    clearAgentFormMessage();
    renderHomeAgentResult(result);
    setParuruSpeech("idle", getHomeAgentSpeech(result));
    resetParuruSpeechSoon();
    revealPanelIfNeeded(homeAgentCard);
  } catch (error) {
    renderHomeAgentError({ retryable: true });
    setParuruState("error");
    revealPanelIfNeeded(homeAgentCard);
  } finally {
    setSending(false);
  }
}

function buildAgentChatPayload(messageText, options = {}) {
  const profile = getCurrentProfile();
  const sessionId = options.sessionId || getOrCreateAgentChatSessionId();
  const clientRequestId = options.clientRequestId || createUuid();
  return {
    action: "agentChat",
    message: String(messageText || "").trim(),
    sessionId,
    clientRequestId,
    deviceId: profile.deviceId,
    pairingToken: getHomeAgentPairingToken(),
    requestMetadata: buildAgentRequestMetadata(messageText, {
      purpose: options.purpose,
      sessionId,
      clientRequestId,
      memoAttributes: options.memoAttributes,
    }),
  };
}

function buildAgentRequestMetadata(messageText, options = {}) {
  const text = String(messageText || "").trim();
  const profile = getCurrentProfile();
  const roomHint = resolveAgentRoomHint(text);
  const familyScope = /家族|みんな|全員/.test(text);
  return {
    sessionId: String(options.sessionId || ""),
    clientRequestId: String(options.clientRequestId || ""),
    purpose: String(options.purpose || "home-state").slice(0, 80),
    intent: classifyHomeInputIntent(text),
    roomHint,
    calendarScopeHint: familyScope ? "family" : "mine",
    todayParuruSettings: {
      selectedMemberKeys: resolveCalendarMemberKeysForServer(profile.selectedCalendarMemberKeys),
      includeUnknown: profile.includeUnknownCalendarEvents === true,
      tomorrowScheduleStartTime: getTomorrowScheduleStartTime(profile),
      scope: familyScope ? "family" : "mine",
    },
    memoAttributes: normalizeAgentMemoAttributes(options.memoAttributes),
  };
}

function resolveAgentRoomHint(text) {
  const value = String(text || "");
  if (/リビング|居間/.test(value)) return "living";
  if (/寝室/.test(value)) return "bedroom";
  if (/子ども部屋|子供部屋|キッズ/.test(value)) return "kids_room";
  if (/書斎|仕事部屋/.test(value)) return "study";
  return null;
}

function normalizeAgentMemoAttributes(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    visibility: String(source.visibility || "").slice(0, 40),
    category: String(source.category || "").slice(0, 80),
    priority: String(source.priority || "").slice(0, 40),
  };
}

async function submitAgentChatQuery(messageText, options = {}) {
  const request = options.request || {
    type: "agentChat",
    purpose: options.purpose || "home-state",
    ...buildAgentChatPayload(messageText, options),
  };
  const payload = {
    action: request.action,
    message: request.message,
    sessionId: request.sessionId,
    clientRequestId: request.clientRequestId,
    deviceId: request.deviceId,
    pairingToken: request.pairingToken,
    requestMetadata: request.requestMetadata,
  };
  pendingHomeAgentRetry = request;
  const loadingMessage = request.purpose === "calendar"
    ? "ぱるるが予定を確認中…"
    : request.purpose === "today-paruru"
      ? "ぱるるが予定を確認中…（今日の予定とタスク）"
    : request.purpose === "home-read"
      ? (isAirconReadQuery(request.message)
        ? "ぱるるがエアコンの状態を確認中…"
        : "ぱるるが家の状態を確認中…")
    : request.purpose === "automation-action"
      ? "ぱるるが操作内容を確認中…"
      : request.purpose === "aircon-action"
        ? "ぱるるが操作内容を確認中…"
      : "ぱるるが確認中…";
  clearAgentFormMessage();
  setSending(true, loadingMessage, "ask");
  setParuruSpeech("idle", loadingMessage);
  renderHomeAgentLoading(loadingMessage);
  const requestStartedAt = new Date().toISOString();

  try {
    const result = await callAgentChat(payload);
    if (!result.actionConfirmation) {
      memoInput.value = "";
    }
    pendingHomeAgentRetry = null;
    clearAgentFormMessage();
    renderAgentChatReply(result.reply);
    if (result.actionConfirmation) {
      if (canUseHomeControl_()) {
        renderHomeAgentActionConfirmation({
          type: "agentActionConfirmation",
          confirmationId: result.actionConfirmation.confirmationId,
          clientRequestId: result.clientRequestId,
          command: result.actionConfirmation.command,
          roomLabel: result.actionConfirmation.roomLabel,
          actionLabel: result.actionConfirmation.command === "automation.pause" ? "実行する" : "実行する",
          confirmationMessage: result.actionConfirmation.summary,
        });
      } else {
        renderHomeAgentControlUnavailableNotice();
      }
    }
    if (result.followup) {
      try {
        renderFollowupPanel("home", {
          id: result.followup.itemId,
          needsFollowup: true,
          followupQuestion: result.followup.question,
          followupInputType: result.followup.inputType,
          followupOrigin: "agentChat",
        });
      } catch (error) {
        error.agentChatReason = "FOLLOWUP_FAILED";
        throw error;
      }
    } else if (request.purpose === "memo") {
      hideFollowupPanel("home");
    }
    setParuruSpeech("homeAgent");
    resetParuruSpeechSoon();
    revealPanelIfNeeded(homeAgentCard);
  } catch (error) {
    const retryable = error && error.code === "AGENT_UNAVAILABLE";
    logAgentChatDiagnostic_("error", "API_ERROR", {
      action: String(request.action || "agentChat"),
      clientRequestId: String(request.clientRequestId || ""),
      startedAtMs: Date.parse(requestStartedAt),
    }, {
      code: String(error?.code || "AGENT_ERROR"),
    });
    const errorMessage = getAgentChatUserMessage(error?.code, retryable);
    renderHomeAgentError({ retryable, message: errorMessage });
    setParuruState("error");
    revealPanelIfNeeded(homeAgentCard);
  } finally {
    setSending(false);
  }
}

function getAgentChatUserMessage(code, retryable = false) {
  if (retryable || code === "AGENT_UNAVAILABLE") {
    return "一時的に確認先へつながらんかった。少し待ってからもう一回試して。";
  }
  const messages = {
    ACTOR_CONTRACT_INVALID: "この端末の利用情報を確認できんかった。端末の登録状態を確認してな。",
    TOOL_DISABLED: "この相談機能は今は使えんようにしとる。",
    CLIMATE_UNAVAILABLE: "室温・湿度を今は取得できんかった。",
    WEATHER_UNAVAILABLE: "外の天気を今は取得できんかった。",
    CALENDAR_UNAVAILABLE: "予定を今は取得できんかった。",
    TODAY_PARURU_UNAVAILABLE: "今日の予定とタスクを今はまとめて確認できんかった。",
    ROOM_NOT_FOUND: "指定された部屋を見つけられんかった。",
    FOLLOWUP_REQUIRED: "確認に必要な情報が足りんかった。部屋や日時を教えてな。",
    ACTION_NOT_ALLOWED: "この端末ではその操作はできん。",
    AUTOMATION_UPSTREAM_ERROR: "家電・自動制御の確認先につながらんかった。実行はしてないで。",
    UPSTREAM_ERROR: "確認先のサービスにつながらんかった。実行や保存はしてないで。",
    CONFIRMATION_EXPIRED: "確認の期限が切れとる。もう一度相談してな。",
    CONFIRMATION_ACTOR_MISMATCH: "確認を作った端末と違うため実行できん。",
    AGENT_BUSY: "利用が集中しとる。少し待ってからもう一回試してな。",
    AGENT_RATE_LIMITED: "少し待ってからもう一回試してな。",
    INVALID_INPUT: "入力内容を確認してな。",
  };
  return messages[code] || "今はこの確認を完了できんかった。繰り返しても直らん場合は設定を確認してな。";
}

function validateAgentChatResponse(response, request) {
  const reply = String(response && response.reply || "").trim();
  if (
    !response ||
    response.success !== true ||
    !reply ||
    response.sessionId !== request.sessionId ||
    response.clientRequestId !== request.clientRequestId
  ) {
    const error = new Error("Invalid Agent Gateway response");
    error.agentChatReason = "INVALID_RESPONSE_SHAPE";
    throw error;
  }
  const result = { reply, sessionId: request.sessionId, clientRequestId: request.clientRequestId };
  if (Object.prototype.hasOwnProperty.call(response, "followup")) {
    try {
      result.followup = validateAgentFollowup(response.followup);
    } catch (error) {
      error.agentChatReason = "FOLLOWUP_FAILED";
      throw error;
    }
  }
  if (Object.prototype.hasOwnProperty.call(response, "actionConfirmation")) {
    result.actionConfirmation = validateAgentActionConfirmation(response.actionConfirmation);
  }
  return result;
}

function validateAgentActionConfirmation(confirmation) {
  const confirmationId = String(confirmation?.confirmationId || "").trim();
  const command = String(confirmation?.command || "").trim();
  const roomLabel = String(confirmation?.roomLabel || "").trim();
  const summary = String(confirmation?.summary || "").trim();
  const expiresAt = String(confirmation?.expiresAt || "").trim();
  const allowedCommands = new Set(["automation.pause", "automation.resume", "aircon.power", "aircon.applySettings"]);
  if (confirmation?.required !== true || !isUuid(confirmationId) || !allowedCommands.has(command)
      || !roomLabel || Array.from(roomLabel).length > 40
      || !summary || Array.from(summary).length > 200
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)) {
    throw new Error("Invalid Agent action confirmation");
  }
  return { required: true, confirmationId, command, roomLabel, summary, expiresAt };
}

function validateAgentFollowup(followup) {
  const itemId = String(followup?.itemId || "").trim();
  const question = String(followup?.question || "").trim();
  const inputType = String(followup?.inputType || "").trim();
  const allowedTypes = new Set(["date", "datetime", "time", "text", "yesno"]);
  if (followup?.required !== true || !isUuid(itemId) || !question
      || Array.from(question).length > 300 || !allowedTypes.has(inputType)) {
    throw new Error("Invalid Agent Gateway followup");
  }
  return { required: true, itemId, question, inputType };
}

function buildMemoCredentialPayload(action) {
  const profile = getCurrentProfile();
  return {
    ...(action ? { action } : {}),
    deviceId: profile.deviceId,
    pairingToken: getHomeAgentPairingToken(),
  };
}

function buildCreateWithAIPayload(memo) {
  const selectedPriority = getSelectedPriority();
  const profile = getCurrentProfile();
  const payload = {
    action: "createWithAI",
    memo,
    userId: profile.userId,
    userDisplayName: profile.displayName,
    calendarSuffix: profile.calendarSuffix,
    deviceId: profile.deviceId,
    visibility: "private",
    ...buildMemoCredentialPayload(),
  };

  if (categoryExplicitlySelected && categoryInput.value) {
    payload.category = categoryInput.value;
  }

  if (priorityExplicitlySelected || selectedPriority !== DEFAULT_PRIORITY) {
    payload.priority = selectedPriority;
  }

  debugLog("[Paruru] createWithAI payload", {
    action: payload.action,
    hasMemo: Boolean(payload.memo),
    category: payload.category || "",
    priority: payload.priority || "",
    userId: payload.userId || "",
    hasDeviceId: Boolean(payload.deviceId),
  });
  return payload;
}

async function fetchInboxItems() {
  if (!GAS_WEB_APP_URL) {
    return sortInboxItemsNewestFirst(loadDummyItems().filter(isInboxItem));
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(buildMemoCredentialPayload("list")),
  });
  const result = await parseApiResponse(response);
  return sortInboxItemsNewestFirst((result.data || []).filter(isInboxItem));
}

async function loadNotificationCandidates(options = {}) {
  const now = Date.now();
  if (!options.force && notificationCandidatesState.inFlight) {
    return notificationCandidatesState.inFlight;
  }

  if (!options.force && now - notificationCandidatesState.lastFetchedAt < NOTIFICATION_CACHE_MS) {
    const healthTask = await fetchNextHealthTask_();
    const displayItems = prependVirtualHealthTask_(notificationCandidatesState.items, healthTask);
    renderNotificationCandidates(
      displayItems,
      notificationCandidatesState.totalCount + (healthTask ? 1 : 0),
      notificationCandidatesState.includeTomorrow
    );
    renderNotificationWarnings(notificationCandidatesState.warnings);
    scheduleNotificationBoundary(notificationCandidatesState.items);
    return notificationCandidatesState.items;
  }

  const hasPreviousItems = notificationCandidatesState.items.length > 0;
  if (!hasPreviousItems) renderNotificationLoading();
  notificationCandidatesState.inFlight = fetchNotificationCandidates()
    .then((result) => {
      const items = result.items || [];
      notificationCandidatesState = {
        lastFetchedAt: Date.now(),
        inFlight: null,
        items,
        totalCount: result.count || items.length,
        includeTomorrow: Boolean(result.includeTomorrow),
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
      return fetchNextHealthTask_().then((healthTask) => {
        const displayItems = prependVirtualHealthTask_(items, healthTask);
        renderNotificationCandidates(
          displayItems,
          notificationCandidatesState.totalCount + (healthTask ? 1 : 0),
          notificationCandidatesState.includeTomorrow
        );
        renderNotificationWarnings(notificationCandidatesState.warnings);
        scheduleNotificationBoundary(items);
        return items;
      });
    })
    .catch((error) => {
      debugLog("[Paruru] notification candidates failed", error?.message || error);
      notificationCandidatesState.inFlight = null;
      if (options.throwOnError) {
        renderNotificationError();
        throw error;
      }
      if (notificationCandidatesState.items.length > 0) {
        notificationCandidatesState.warnings = ["notification_refresh_failed"];
        const displayItems = prependVirtualHealthTask_(notificationCandidatesState.items, healthTaskCache);
        renderNotificationCandidates(
          displayItems,
          notificationCandidatesState.totalCount + (healthTaskCache ? 1 : 0),
          notificationCandidatesState.includeTomorrow
        );
        renderNotificationWarnings(notificationCandidatesState.warnings);
        scheduleNotificationBoundary(notificationCandidatesState.items);
        return notificationCandidatesState.items;
      }
      renderNotificationError();
      return [];
    });

  return notificationCandidatesState.inFlight;
}

if (typeof document.addEventListener === "function") {
  document.addEventListener("nurse-okan:daily-saved", () => {
    healthTaskCache = null;
    notificationCandidatesState.lastFetchedAt = 0;
    if (activeView === "home") {
      void loadNotificationCandidates({ force: true });
    }
  });
}

async function fetchNotificationCandidates() {
  const profile = getCurrentProfile();
  if (!GAS_WEB_APP_URL) {
    const plan = getRollingCalendarRequestPlan(Date.now(), getTomorrowScheduleStartTime(profile));
    return buildRollingNotificationResult(
      await dummyNotificationCandidates(profile.userId),
      null,
      plan,
      Date.now()
    );
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      ...buildMemoCredentialPayload("todayParuruContext"),
      selectedMemberKeys: resolveCalendarMemberKeysForServer(profile.selectedCalendarMemberKeys).join(","),
      includeUnknown: profile.includeUnknownCalendarEvents ? "true" : "false",
      tomorrowScheduleStartTime: getTomorrowScheduleStartTime(profile),
    }),
  });
  return parseApiResponse(response);
}

async function fetchNotificationCandidatesForDate(profile, targetDate) {
  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      ...buildMemoCredentialPayload("notificationCandidates"),
      limit: "50",
      date: targetDate,
      selectedMemberKeys: resolveCalendarMemberKeysForServer(profile.selectedCalendarMemberKeys).join(","),
      includeUnknown: profile.includeUnknownCalendarEvents ? "true" : "false",
    }),
  });
  return parseApiResponse(response);
}

function buildRollingNotificationResult(todayResult, tomorrowResult, plan, nowMs) {
  const todayItems = Array.isArray(todayResult?.items) ? todayResult.items : [];
  const nonCalendarItems = todayItems.filter((item) => !isGoogleCalendarCandidate(item));
  const todayCalendarItems = sortRollingCalendarItems(todayItems
    .filter(isGoogleCalendarCandidate)
    .map((item) => ({ ...item, rollingDisplayDate: plan.today, rollingDay: "today" }))
    .filter((item) => isRollingCalendarCandidateVisible(item, plan.today, nowMs)));
  const tomorrowCalendarItemsRaw = plan.includeTomorrow && Array.isArray(tomorrowResult?.items)
    ? sortRollingCalendarItems(tomorrowResult.items
      .filter(isGoogleCalendarCandidate)
      .map((item) => ({ ...item, rollingDisplayDate: plan.tomorrow, rollingDay: "tomorrow" }))
      .filter((item) => isRollingCalendarCandidateVisible(item, plan.tomorrow, nowMs)))
    : [];
  const todayCalendarKeys = new Set(todayCalendarItems.map(buildCalendarOccurrenceKey));
  const tomorrowCalendarItems = tomorrowCalendarItemsRaw.filter((item) => {
    const key = buildCalendarOccurrenceKey(item);
    return !key || !todayCalendarKeys.has(key);
  });
  const items = [...nonCalendarItems, ...todayCalendarItems, ...tomorrowCalendarItems];
  const warnings = [
    ...(Array.isArray(todayResult?.warnings) ? todayResult.warnings : []),
    ...(Array.isArray(tomorrowResult?.warnings) ? tomorrowResult.warnings : []),
  ];
  if ([...todayCalendarItems, ...tomorrowCalendarItems].some((item) => item.rollingWarning === "calendar_end_missing")) {
    warnings.push("calendar_end_missing");
  }
  return {
    success: true,
    items,
    count: items.length,
    includeTomorrow: plan.includeTomorrow,
    warnings: [...new Set(warnings)],
  };
}

function isGoogleCalendarCandidate(item) {
  return String(item?.sourceType || "") === "google_calendar";
}

function buildCalendarOccurrenceKey(item) {
  if (!isGoogleCalendarCandidate(item)) return "";
  const stableId = String(item.sourceId || item.id || "").trim();
  const start = String(item.startAt || buildRollingDateTime(item.eventStart, item.eventStartTime) || "").trim();
  const end = String(item.endAt || buildRollingDateTime(item.eventEnd, item.eventEndTime) || item.eventEnd || "").trim();
  if (stableId && start) return `id:${stableId}|start:${start}|end:${end}`;
  const title = String(item.rawTitle || item.cleanTitle || item.title || "").trim();
  const member = String(item.memberKey || "").trim();
  if (!start || !end || !title) return "";
  return `fallback:${start}|${end}|${title}|${member}|${Boolean(item.allDay)}`;
}

function isRollingCalendarCandidateVisible(item, displayDate, nowMs) {
  if (!isGoogleCalendarCandidate(item)) return true;
  if (item.allDay === true) {
    const exclusiveEndDate = normalizeRollingDate(item.eventEnd || item.endAt);
    if (!exclusiveEndDate) {
      item.rollingWarning = "calendar_end_missing";
      return true;
    }
    return displayDate < exclusiveEndDate;
  }
  const endMs = parseTokyoCandidateDateTime(item.endAt || buildRollingDateTime(item.eventEnd, item.eventEndTime));
  if (endMs === null) {
    item.rollingWarning = "calendar_end_missing";
    return true;
  }
  return endMs > nowMs;
}

function sortRollingCalendarItems(items) {
  return [...items].sort((left, right) => {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) return left.allDay ? -1 : 1;
    const leftStart = parseTokyoCandidateDateTime(left.startAt || buildRollingDateTime(left.eventStart, left.eventStartTime));
    const rightStart = parseTokyoCandidateDateTime(right.startAt || buildRollingDateTime(right.eventStart, right.eventStartTime));
    if (leftStart === null && rightStart === null) return 0;
    if (leftStart === null) return 1;
    if (rightStart === null) return -1;
    return leftStart - rightStart;
  });
}

async function updateInboxItem(id, updates) {
  if (!GAS_WEB_APP_URL) {
    return dummyUpdate(id, updates);
  }

  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({ ...buildMemoCredentialPayload("update"), id, ...updates }),
    });

    return await parseApiResponse(response);
  } catch (error) {
    logInboxUpdateFailure_(id, error);
    throw error;
  }
}

async function answerFollowup(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummyAnswerFollowup(payload);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ ...buildMemoCredentialPayload("answerFollowup"), ...payload }),
  });

  return parseApiResponse(response);
}

async function syncCalendar(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummySyncCalendar(payload);
  }

  debugLog("[Paruru] syncCalendar payload", sanitizeCalendarPayloadForLog(payload));
  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ ...buildMemoCredentialPayload("syncCalendar"), ...payload }),
  });

  return parseApiResponse(response, { debugLabel: "syncCalendar" });
}

async function updateCalendar(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummyUpdateCalendar(payload);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ ...buildMemoCredentialPayload("updateCalendar"), ...payload }),
  });

  return parseApiResponse(response);
}

async function deleteInboxItem(id) {
  if (!GAS_WEB_APP_URL) {
    return dummyDelete(id);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ ...buildMemoCredentialPayload("delete"), id }),
  });

  return parseApiResponse(response);
}

async function parseApiResponse(response, options = {}) {
  const debugLabel = options.debugLabel || "";
  if (debugLabel) {
    debugLog(`[Paruru] ${debugLabel} HTTP status`, response.status);
  }

  if (!response.ok) {
    const error = new Error(`Request failed: ${response.status}`);
    error.httpStatus = response.status;
    error.responseSuccess = null;
    throw error;
  }

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    const error = new Error("Invalid API response");
    error.httpStatus = response.status;
    error.responseSuccess = null;
    throw error;
  }
  if (debugLabel) {
    debugLog(`[Paruru] ${debugLabel} parsed response`, sanitizeApiResponseForLog(result));
  }

  if (!result.success) {
    const error = new Error(result.message || "API failed");
    error.httpStatus = response.status;
    error.responseSuccess = false;
    error.responseErrorCode = String(result?.error?.code || "").trim();
    error.responseMessage = String(result?.message || "").trim();
    if (error.responseErrorCode) error.code = error.responseErrorCode;
    throw error;
  }

  return result;
}

function logInboxUpdateFailure_(id, error) {
  const profile = getCurrentProfile();
  const pairingToken = getHomeAgentPairingToken();
  console.error("[Paruru] Inbox update failed", {
    action: "update",
    httpStatus: Number.isFinite(Number(error?.httpStatus)) ? Number(error.httpStatus) : null,
    responseSuccess: typeof error?.responseSuccess === "boolean" ? error.responseSuccess : null,
    responseErrorCode: String(error?.responseErrorCode || error?.code || "").trim(),
    responseMessage: String(error?.responseMessage || error?.message || "").trim(),
    inboxId: String(id || "").trim(),
    role: String(activeMembershipContext?.role || "").trim(),
    hasDeviceId: Boolean(profile?.deviceId),
    hasPairingToken: Boolean(pairingToken),
  });
}

function buildInboxUpdateFailureMessage_(error) {
  const code = String(error?.responseErrorCode || error?.code || "").trim();
  return `完了できませんでした${code ? `（${code}）` : ""}`;
}

function renderInboxLoading() {
  inboxList.innerHTML = `<div class="empty-state">読み込み中...</div>`;
}

function renderInboxError() {
  inboxList.innerHTML = `
    <div class="empty-state inbox-error-state">
      <p>Inboxを読み込めませんでした。</p>
      <button type="button" class="secondary-button" data-inbox-retry>再試行</button>
    </div>
  `;
}

function renderNotificationLoading() {
  setNotificationViewState("loading");
  todayParuru.classList.remove("is-hidden");
  todayParuruLine.textContent = formatParuruLine_(PARURU_MESSAGES.notification.loadingLine);
  todayParuruLine.classList.remove("is-hidden");
  todayParuruList.innerHTML = `<p class="today-paruru-empty">${escapeHtml(formatParuruLine_(PARURU_MESSAGES.notification.loadingBody))}</p>`;
  todayParuruAllButton.classList.add("is-hidden");
}

function renderNotificationError() {
  setNotificationViewState("error");
  setParuruSpeech("error");
  todayParuru.classList.remove("is-hidden");
  todayParuruLine.classList.add("is-hidden");
  todayParuruLine.textContent = "";
  todayParuruList.innerHTML = `
    <div class="today-paruru-error">
      <p>${escapeHtml(formatParuruLine_(PARURU_MESSAGES.notification.error))}</p>
      <button class="secondary-button" type="button" data-notification-refresh>もう一回</button>
    </div>
  `;
  todayParuruAllButton.classList.add("is-hidden");
}

function renderNotificationWarnings(warnings) {
  const values = Array.isArray(warnings) ? warnings : [];
  let text = "";
  if (values.includes("tomorrow_notifications_unavailable")) {
    text = "明日の予定だけ取得できんかった。今日の分は表示しとるで。";
  } else if (values.includes("notification_refresh_failed")) {
    text = "更新できんかったので、直前の内容を表示しとるで。";
  }
  if (!text) return;
  todayParuruList.insertAdjacentHTML("beforeend", `
    <div class="today-paruru-error today-paruru-inline-warning">
      <p>${escapeHtml(text)}</p>
      <button class="secondary-button" type="button" data-notification-refresh>もう一回</button>
    </div>
  `);
}

function renderNotificationCandidates(items, totalCount, includeTomorrow = false) {
  const visibleItems = selectRollingNotificationItems(items, NOTIFICATION_DISPLAY_LIMIT, includeTomorrow);
  if (visibleItems.length === 0) {
    setNotificationViewState("loaded-empty");
    setParuruSpeech("noNotifications");
    todayParuru.classList.add("is-hidden");
    todayParuruLine.classList.add("is-hidden");
    todayParuruLine.textContent = "";
    todayParuruList.innerHTML = "";
    todayParuruAllButton.classList.add("is-hidden");
    return;
  }

  setNotificationViewState("loaded-with-items");
  todayParuru.classList.remove("is-hidden");
  setParuruSpeech("idle", buildNotificationSummarySpeech(totalCount || visibleItems.length));
  todayParuruLine.textContent = formatParuruLine_(PARURU_MESSAGES.notification.loadedLine);
  todayParuruLine.classList.remove("is-hidden");
  todayParuruList.innerHTML = renderRollingNotificationItems(visibleItems, includeTomorrow) + renderNotificationMore(totalCount, visibleItems.length);
  todayParuruAllButton.classList.remove("is-hidden");
}

function selectRollingNotificationItems(items, limit, includeTomorrow) {
  const source = Array.isArray(items) ? items : [];
  if (!includeTomorrow || source.length <= limit) return source.slice(0, limit);
  const reserved = [];
  const todayItem = source.find((item) => item.rollingDay === "today");
  const tomorrowItem = source.find((item) => item.rollingDay === "tomorrow");
  if (todayItem) reserved.push(todayItem);
  if (tomorrowItem) reserved.push(tomorrowItem);
  const remaining = source.filter((item) => !reserved.includes(item));
  return [...remaining.slice(0, Math.max(0, limit - reserved.length)), ...reserved];
}

function renderRollingNotificationItems(items, includeTomorrow) {
  const nonCalendar = items.filter((item) => !isGoogleCalendarCandidate(item));
  const todayCalendar = items.filter((item) => item.rollingDay === "today");
  const tomorrowCalendar = items.filter((item) => item.rollingDay === "tomorrow");
  let html = nonCalendar.map(renderNotificationItem).join("");
  if (!includeTomorrow) {
    return html + todayCalendar.map(renderNotificationItem).join("");
  }
  if (todayCalendar.length > 0) html += renderCalendarGroup("今日の残り", todayCalendar);
  if (tomorrowCalendar.length > 0) html += renderCalendarGroup("明日の予定", tomorrowCalendar);
  return html;
}

function renderCalendarGroup(label, items) {
  return `<section class="today-paruru-group" aria-label="${escapeHtml(label)}">
    <h3 class="today-paruru-group-title">${escapeHtml(label)}</h3>
    ${items.map(renderNotificationItem).join("")}
  </section>`;
}

function setNotificationViewState(stateName) {
  todayParuru.dataset.state = stateName;
}

function buildNotificationSummarySpeech(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (safeCount <= 1) {
    return formatParuruLine_(PARURU_MESSAGES.speech.notificationOne);
  }
  return formatParuruLine_(PARURU_MESSAGES.speech.notificationMany(safeCount));
}

function renderNotificationItem(item) {
  const level = normalizeNotificationLevel(item.notificationLevel);
  const labels = (item.reasons || []).slice(0, 2).map(renderNotificationReasonLabel).join("");
  const healthAttributes = item.virtual && item.healthAction === "daily"
    ? ` data-health-action="daily" data-health-slot="${escapeHtml(item.healthSlot || "")}" data-health-target-user-id="${escapeHtml(item.targetUserId || "")}"`
    : "";
  return `
    <button class="today-paruru-item today-paruru-${escapeHtml(level)}" type="button" data-notification-id="${escapeHtml(item.id)}"${healthAttributes}>
      <span class="today-paruru-badges">
        ${renderNotificationLevelBadge(level)}
        ${labels}
      </span>
      <span class="today-paruru-message">${escapeHtml(buildTodayDisplayLine(item))}</span>
    </button>
  `;
}

function buildTodayDisplayLine(item) {
  const title = item.title || item.memo?.slice(0, 20) || formatParuruLine_(PARURU_MESSAGES.notification.fallback);
  const reasons = item.reasons || [];

  if (normalizeType(item.type) === "shopping") {
    if (reasons.includes("overdue")) return `期限超過 ${title}`;
    if (reasons.includes("due_today")) return `今日まで ${title}`;
    if (reasons.includes("due_tomorrow")) return `明日まで ${title}`;
    if (reasons.includes("due_within_7_days")) return `1週間以内 ${title}`;
  }

  if (reasons.includes("overdue")) {
    return `期限切れ ${title}`;
  }

  if (reasons.includes("event_today_timed")) {
    return `${formatTimeJa(item.eventStartTime)} ${formatMemberPrefix(item)}${title}`.trim();
  }

  if (reasons.includes("event_today")) {
    return `今日 ${formatMemberPrefix(item)}${title}`;
  }

  if (reasons.includes("calendar_event_today_timed")) {
    return `${formatTimeJa(item.eventStartTime)} ${formatMemberPrefix(item)}${item.cleanTitle || title}`.trim();
  }

  if (reasons.includes("calendar_event_today")) {
    return `今日 ${formatMemberPrefix(item)}${item.cleanTitle || title}`;
  }

  if (reasons.includes("due_today_timed")) {
    return `${formatTimeJa(item.dueTime)}まで ${title}`.trim();
  }

  if (reasons.includes("due_today")) {
    return `今日中 ${title}`;
  }

  if (reasons.includes("reminder_today")) {
    const reminderTime = formatTimeJa(getReminderTimeValue(item));
    return `${reminderTime || "今日"} ${title}`.trim();
  }

  if (reasons.includes("followup_required")) {
    return `要確認 ${title}`;
  }

  return item.message || title;
}

function formatMemberPrefix(item) {
  const label = String(item.memberLabel || "").trim();
  if (!label || label === "未分類") {
    return "";
  }
  return `${label}・`;
}

function renderNotificationMore(totalCount, visibleCount) {
  const rest = Math.max(0, totalCount - visibleCount);
  if (rest <= 0) {
    return "";
  }

  return `<p class="today-paruru-more">${escapeHtml(PARURU_MESSAGES.notification.more(rest))}</p>`;
}

function renderNotificationLevelBadge(level) {
  const labels = {
    critical: "重要",
    high: "要確認",
    normal: "通常",
  };
  return `<span class="today-paruru-badge level-${escapeHtml(level)}">${escapeHtml(labels[level] || "通常")}</span>`;
}

function renderNotificationReasonLabel(reason) {
  const labels = {
    overdue: "期限切れ",
    event_today_timed: "予定",
    event_today: "予定",
    calendar_event_today_timed: "予定",
    calendar_event_today: "予定",
    due_today: "今日締切",
    due_today_timed: "今日締切",
    due_tomorrow: "明日まで",
    due_within_7_days: "1週間以内",
    reminder_today: "通知",
    followup_required: "確認待ち",
    urgent: "至急",
    high_priority: "High",
  };
  const label = labels[reason];
  return label ? `<span class="today-paruru-badge reason-${escapeHtml(reason)}">${escapeHtml(label)}</span>` : "";
}

function normalizeNotificationLevel(level) {
  return ["critical", "high", "normal"].includes(level) ? level : "normal";
}

function renderInboxList(items) {
  if (items.length === 0) {
    inboxList.innerHTML = `<div class="empty-state">今日はまだ何も預かってないよ。</div>`;
    return;
  }

  inboxList.innerHTML = items.map((item) => `
    <article class="inbox-card ${isFollowupNeeded(item) ? "has-followup" : ""}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(normalizeType(item.type))}" data-category="${escapeHtml(item.category || "未分類")}" data-priority="${escapeHtml(normalizePriority(item.priority))}" data-followup="${isFollowupNeeded(item) ? "true" : "false"}" data-has-due="${item.dueDate ? "true" : "false"}" data-has-event="${item.eventStart ? "true" : "false"}">
      <div class="card-main">
        <h2>${escapeHtml(item.title || item.memo?.slice(0, 20) || "無題")}</h2>
        ${renderFollowupBadge(item)}
      </div>
      <div class="card-meta">
        <span class="category-chip" style="--category-color: ${getCategoryColor(item.category)}">${escapeHtml(item.category || "未分類")}</span>
        ${renderPriorityChip(item.priority)}
        ${renderTypeChip(item.type)}
        ${renderCalendarStatusChip(item)}
      </div>
      ${renderScheduleLine(item)}
      ${renderFollowupLine(item)}
      ${renderAiSummary(item)}
      <time class="card-created">登録: ${escapeHtml(formatCreatedAt(item.createdAt))}</time>
    </article>
  `).join("");
}

function renderPriorityChip(priority) {
  const normalized = normalizePriority(priority);
  return `<span class="priority-chip priority-${escapeHtml(normalized)}">${escapeHtml(normalized)}</span>`;
}

function renderTypeChip(type) {
  const normalized = normalizeType(type);
  const label = TYPE_LABELS[normalized] || "メモ";
  return `<span class="type-chip type-${escapeHtml(normalized)}">${escapeHtml(label)}</span>`;
}

function renderCalendarStatusChip(item) {
  const status = normalizeCalendarSyncStatus(item.calendarSyncStatus);
  if (status === "synced" && item.calendarEventId) {
    return `<span class="calendar-status-chip calendar-status-synced">カレンダー登録済み</span>`;
  }

  if (status === "update_required" && item.calendarEventId) {
    return `<span class="calendar-status-chip calendar-status-update-required">カレンダー更新待ち</span>`;
  }

  if (status === "failed") {
    return `<span class="calendar-status-chip calendar-status-failed">カレンダー連携エラー</span>`;
  }

  if (shouldShowCalendarCandidate(item)) {
    return `<span class="calendar-status-chip calendar-status-pending">カレンダー未登録</span>`;
  }

  return "";
}

function renderFollowupBadge(item) {
  if (!isFollowupNeeded(item)) {
    return "";
  }

  return `<span class="followup-badge">確認待ち</span>`;
}

function renderScheduleLine(item) {
  const type = normalizeType(item.type);
  const statusLabel = getDueStatusLabel(item);

  if (type === "task" && item.dueDate) {
    const dueText = formatItemDateTime(item);
    const status = statusLabel ? `<span class="date-status date-status-${escapeHtml(statusLabel.key)}">${escapeHtml(statusLabel.label)}</span>` : "";
    return `<p class="card-schedule">${status}<span>締切: ${escapeHtml(dueText)}</span></p>`;
  }

  if (type === "event" && item.eventStart) {
    return `<p class="card-schedule"><span>予定: ${escapeHtml(formatItemDateTime(item))}</span></p>`;
  }

  if (type === "reminder" && getReminderDateValue(item)) {
    return `<p class="card-schedule"><span>通知: ${escapeHtml(formatItemDateTime(item))}</span></p>`;
  }

  if (type === "shopping") {
    return `<p class="card-schedule subtle">買い物リスト</p>`;
  }

  return "";
}

function renderFollowupLine(item) {
  if (!isFollowupNeeded(item) || !item.followupQuestion) {
    return "";
  }

  return `<p class="card-followup-question">${escapeHtml(item.followupQuestion)}</p>`;
}

function renderAiSummary(item) {
  if (!item.aiSummary) {
    return "";
  }

  return `<p class="card-summary">${escapeHtml(item.aiSummary)}</p>`;
}

function sortInboxItemsNewestFirst(items) {
  return items
    .map((item, index) => ({
      item,
      index,
      createdAt: parseSortableDateValue(item.createdAt),
      updatedAt: parseSortableDateValue(item.updatedAt),
    }))
    .sort((a, b) => {
      if (a.createdAt !== null && b.createdAt !== null && a.createdAt !== b.createdAt) {
        return b.createdAt - a.createdAt;
      }

      if (a.updatedAt !== null && b.updatedAt !== null && a.updatedAt !== b.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }

      if (a.updatedAt !== b.updatedAt) {
        return (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity);
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function isInboxItem(item) {
  const status = normalizeInboxStatus(item && item.status);
  return status !== "completed" && status !== "deleted";
}

function normalizeInboxStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized || normalized === "inbox") {
    return "inbox";
  }
  if (["done", "complete", "completed"].includes(normalized)) {
    return "completed";
  }
  if (["delete", "deleted", "trash", "trashed"].includes(normalized)) {
    return "deleted";
  }
  return "active";
}

function normalizeType(type) {
  const normalized = String(type || "note").trim().toLowerCase();
  if (["買い物", "purchase", "buy"].includes(normalized)) {
    return "shopping";
  }
  return Object.prototype.hasOwnProperty.call(TYPE_LABELS, normalized) ? normalized : "note";
}

function normalizePriority(priority) {
  const normalized = String(priority || "Normal").trim();
  return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, normalized) ? normalized : "Normal";
}

function normalizeCalendarSyncStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const allowed = ["not_required", "pending", "synced", "failed", "update_required", "deleted"];
  return allowed.includes(normalized) ? normalized : "";
}

function renderDetailCalendarStatus(item) {
  const status = normalizeCalendarSyncStatus(item.calendarSyncStatus);
  const chip = renderCalendarStatusChip(item);
  const messages = {
    pending: PARURU_MESSAGES.calendarStatus.pending,
    synced: PARURU_MESSAGES.calendarStatus.synced,
    update_required: PARURU_MESSAGES.calendarStatus.update_required,
    failed: item.calendarLastError || PARURU_MESSAGES.calendarStatus.failed,
  };

  if (!chip && !messages[status]) {
    detailCalendarStatus.classList.add("is-hidden");
    detailCalendarStatus.innerHTML = "";
    return;
  }

  detailCalendarStatus.innerHTML = `${chip}<span>${escapeHtml(messages[status] || "")}</span>`;
  detailCalendarStatus.className = `detail-calendar-status detail-calendar-status-${escapeHtml(status || "none")}`;
}

async function openNotificationDetail(id) {
  if (!id) {
    return;
  }

  const candidate = notificationCandidatesState.items.find((item) => item.id === id);
  if (candidate?.sourceType === "google_calendar") {
    showTemporaryParuruMessage("カレンダー予定は表示だけやで。変更はGoogleカレンダー側でお願いな。", "");
    return;
  }

  if (!inboxItems.some((item) => item.id === id)) {
    try {
      inboxItems = await fetchInboxItems();
    } catch (error) {
      showMessage(PARURU_MESSAGES.action.detailOpenFailed, "error");
      return;
    }
  }

  openDetail(id);
}

function openDetail(id) {
  const item = inboxItems.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  selectedItemId = id;
  editId.value = item.id;
  editTitle.value = item.title || item.memo?.slice(0, 20) || "";
  editMemo.value = item.memo || "";
  editCategory.value = item.category || "未分類";
  editPriority.value = item.priority || "Normal";
  editType.value = normalizeType(item.type);
  editStatus.value = normalizeEditableStatus(item.status);
  editDueDate.value = normalizeDateInputValue(item.dueDate);
  editDueTime.value = normalizeTimeLabel(item.dueTime);
  editEventStart.value = normalizeDateInputValue(item.eventStart);
  editEventStartTime.value = normalizeTimeLabel(item.eventStartTime);
  editEventEnd.value = normalizeDateInputValue(item.eventEnd);
  editEventEndTime.value = normalizeTimeLabel(item.eventEndTime);
  editReminderDate.value = getReminderDateValue(item);
  editReminderTime.value = getReminderTimeValue(item);
  originalEditDueDate = normalizeDateInputValue(item.dueDate);
  shoppingTimingTouched = false;
  editShoppingTiming.value = classifyShoppingTiming(originalEditDueDate);
  updateEditFormVisibility();
  renderDetailCalendarStatus(item);
  renderFollowupPanel("detail", item);
  renderCalendarSyncPanel("detail", item);
  detailDialog.showModal();
}

function updateEditFormVisibility() {
  const type = normalizeType(editType.value);
  const isShopping = type === "shopping";
  const isTask = type === "task";
  editShoppingPanel.hidden = !isShopping;
  editDuePanel.hidden = !(isTask || (isShopping && editShoppingTiming.value === "custom"));
  editDueDateField.hidden = !(isTask || (isShopping && editShoppingTiming.value === "custom"));
  editDueTimeField.hidden = !isTask;
  editEventPanel.hidden = type !== "event";
  editReminderPanel.hidden = type !== "reminder";
  editDueDateLabel.textContent = isShopping ? "買う日" : "締切日";
}

function buildEditUpdatePayload(base) {
  const payload = { ...base };
  const type = normalizeType(editType.value);
  if (type === "task") {
    payload.dueDate = normalizeDateInputValue(editDueDate.value);
    payload.dueTime = normalizeTimeLabel(editDueTime.value);
  } else if (type === "event") {
    payload.eventStart = normalizeDateInputValue(editEventStart.value);
    payload.eventStartTime = normalizeTimeLabel(editEventStartTime.value);
    payload.eventEnd = normalizeDateInputValue(editEventEnd.value);
    payload.eventEndTime = normalizeTimeLabel(editEventEndTime.value);
  } else if (type === "reminder") {
    payload.remindAt = buildReminderAtValue(editReminderDate.value, editReminderTime.value);
  } else if (type === "shopping" && shoppingTimingTouched) {
    payload.dueDate = getShoppingDueDate(editShoppingTiming.value, editDueDate.value);
    if (editShoppingTiming.value === "none") {
      payload.dueTime = "";
    }
  }
  return payload;
}

function classifyShoppingTiming(dueDate, todayParts = getTodayTokyoParts()) {
  const normalized = normalizeDateInputValue(dueDate);
  if (!normalized) return "none";
  const dueParts = parseYmd(normalized);
  if (!dueParts) return "custom";
  const dueDay = getDateOnlyEpochDay(dueParts);
  const today = getDateOnlyEpochDay(todayParts);
  if (dueDay === today) return "today";
  if (dueDay === today + 1) return "tomorrow";
  if (dueDay >= today + 2 && dueDay <= today + 7) return "within_7_days";
  return "custom";
}

function getShoppingDueDate(timing, customDate, todayParts = getTodayTokyoParts()) {
  const today = getDateOnlyEpochDay(todayParts);
  if (timing === "today") return epochDayToYmd(today);
  if (timing === "tomorrow") return epochDayToYmd(today + 1);
  if (timing === "within_7_days") return epochDayToYmd(today + 7);
  if (timing === "custom") return normalizeDateInputValue(customDate);
  return "";
}

function setSending(isSending, statusText = "", route = "") {
  isSubmitting = isSending;
  askPaluruButton.disabled = isSending;
  saveToPaluruButton.disabled = isSending;
  renderHomeInputActionButtons(isSending ? (route === "save" ? "register" : "consult") : "");
}

function setParuruState(stateName, options = {}) {
  const state = PARURU_STATES[stateName] || PARURU_STATES.normal;
  paruruImage.src = state.image;
  setParuruSpeech(state.speech, state.line);

  if (options.showStatus) {
    showMessage(formatParuruLine_(state.line), state.messageType || "");
  }
}

function setParuruSpeech(stateName = "idle", customLine = "") {
  const line = customLine || PARURU_MESSAGES.speech[stateName] || PARURU_MESSAGES.speech.idle;
  paruruLine.textContent = formatParuruLine_(line);
}

function formatParuruLine_(template) {
  return formatAddressedLine_(template, activeMembershipContext?.addressTerms?.paruru);
}

function formatAddressedLine_(template, address) {
  const text = String(template || "");
  const normalizedAddress = String(address || "").trim();
  if (normalizedAddress) return text.split("{{address}}").join(normalizedAddress);
  return text.replace(/(?:、|\s)?\{\{address\}\}(?:、|\s)?/g, "");
}

function resetParuruSpeechSoon(delay = 4500) {
  window.clearTimeout(resetParuruSpeechSoon.timer);
  resetParuruSpeechSoon.timer = window.setTimeout(() => {
    if (activeView === "home" && !isSubmitting && !memoInput.value.trim()) {
      setParuruSpeech("idle");
    }
  }, delay);
}

function showParuruMessage(line, type, imageState = "normal") {
  const state = PARURU_STATES[imageState] || PARURU_STATES.normal;
  paruruImage.src = state.image;
  setParuruSpeech("idle", line);
  showMessage(formatParuruLine_(line), type || "");
}

function showTemporaryParuruMessage(line, type, imageState = "normal") {
  showParuruMessage(line, type, imageState);
  resetParuruSpeechSoon();
}

function revealPanelIfNeeded(panel) {
  if (!panel || panel.classList.contains("is-hidden") || isElementMostlyVisible(panel)) {
    return;
  }

  requestAnimationFrame(() => {
    panel.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

function isElementMostlyVisible(element) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const visibleTop = Math.max(rect.top, 0);
  const visibleBottom = Math.min(rect.bottom, viewportHeight);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return visibleHeight >= Math.min(rect.height * 0.72, 160);
}

function showSuccessResult(result) {
  const item = result?.item;
  const followupQuestion = item?.followupQuestion;
  setParuruState("success", { showStatus: true });

  if (isFollowupNeeded(item) && followupQuestion) {
    setParuruSpeech("followup");
    showMessage(`確認したいこと: ${followupQuestion}`, "success");
    renderFollowupPanel("home", item);
  } else {
    hideFollowupPanel("home");
  }

  renderCalendarSyncPanel("home", item);
}

function resetExplicitSelectionState() {
  categoryExplicitlySelected = false;
  priorityExplicitlySelected = false;
}

function getSelectedPriority() {
  return new FormData(form).get("priority") || DEFAULT_PRIORITY;
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
}

function clearAgentFormMessage() {
  showMessage("", "");
}

function isLikelyHomeAgentQuery(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }

  if (HOME_AGENT_MEMO_PRIORITY_PATTERNS.some((pattern) => pattern.test(value))) {
    return false;
  }

  return HOME_AGENT_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

function isLikelyAgentChatQuery(text) {
  const value = String(text || "").trim();
  if (!value || HOME_AGENT_MEMO_PRIORITY_PATTERNS.some((pattern) => pattern.test(value))) {
    return false;
  }
  return AGENT_CHAT_HOME_STATE_PATTERNS.some((pattern) => pattern.test(value));
}

function isRoomTemperatureReadQuery(text) {
  const value = String(text || "").trim();
  return Boolean(resolveAgentRoomHint(value)) && /(?:温度|おんど|何度|何℃|湿度|室温)/.test(value);
}

function isAirconReadQuery(text) {
  const value = String(text || "").trim();
  if (!value || isAirconCommandRequest(value)) {
    return false;
  }
  return AGENT_CHAT_AIRCON_READ_PATTERNS.some((pattern) => pattern.test(value));
}

function isAirconCommandRequest(text) {
  const value = String(text || "").trim();
  return Boolean(value) && HOME_AGENT_AIRCON_COMMAND_PATTERNS.some((pattern) => pattern.test(value));
}

function isAutomationControlRequest(text) {
  const value = String(text || "").trim();
  return Boolean(value) && AGENT_AUTOMATION_CONTROL_PATTERNS.some((pattern) => pattern.test(value));
}

function isAirconOperationRequest(text) {
  const value = String(text || "").trim();
  return Boolean(value) && !isAutomationControlRequest(value) && isAirconCommandRequest(value);
}

function isExplicitAgentMemoRequest(text) {
  return EXPLICIT_AGENT_MEMO_REQUEST_PATTERN.test(String(text || "").trim());
}

function isCalendarWriteRequest(text) {
  return CALENDAR_WRITE_PATTERN.test(String(text || "").trim());
}

function isCalendarReadQuery(text) {
  const value = String(text || "").trim();
  if (!value || isCalendarWriteRequest(value) || isLegacyHomeAgentPriorityQuery(value)) {
    return false;
  }
  if (CALENDAR_NEXT_SEVEN_DAYS_PATTERN.test(value)) {
    return true;
  }
  if (!CALENDAR_READ_TOPIC_PATTERN.test(value)) {
    return false;
  }
  if (CALENDAR_READ_CONTEXT_PATTERN.test(value)) {
    return true;
  }
  if (/何時から/.test(value)) {
    const subject = value.replace(/[？?。!！\s]/g, "").replace(/(?:は)?何時から(?:ですか)?/, "");
    return subject.length >= 2;
  }
  return false;
}

function isTodayParuruQuery(text) {
  const value = String(text || "").trim();
  if (!value || isCalendarWriteRequest(value)) return false;
  // Today Paruru owns Calendar + Inbox aggregate requests, not Calendar-only
  // schedule questions.  Keep the existing aggregate markers here so the
  // Calendar read predicate can own "今日の予定" without adding a new router.
  return /今日\s*(?:の)?\s*何(?:が|か)?ある/.test(value)
    || (value.includes("今日") && value.includes("やること"));
}

function isWeatherQuery(text) {
  return WEATHER_QUERY_PATTERN.test(String(text || "").trim());
}

function isLegacyHomeAgentPriorityQuery(text) {
  const value = String(text || "").trim();
  // Air-conditioner requests are always routed through Agent Chat.  The
  // remaining legacy path is intentionally limited to the out-of-scope
  // school/lunch helpers until they are migrated separately.
  return Boolean(value) && LEGACY_HOME_AGENT_PRIORITY_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeHomeAgentResult(response) {
  const result = response?.result || response?.data || response?.item || {};
  return {
    ...result,
    actionCandidates: result.actionCandidates || response?.actionCandidates || [],
    warnings: result.warnings || response?.warnings || [],
    signageMessage: result.signageMessage || response?.signageMessage || "",
  };
}

function renderHomeAgentLoading(messageText) {
  homeAgentCard.classList.remove("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "true");
  homeAgentRetryButton.classList.add("is-hidden");
  const text = String(messageText || "ぱるるが家の様子を見てる…");
  homeAgentContent.innerHTML = `<p class="home-agent-empty">${escapeHtml(text)}</p>`;
}

function renderHomeAgentError(options = {}) {
  homeAgentCard.classList.remove("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "false");
  homeAgentRetryButton.classList.toggle("is-hidden", options.retryable !== true);
  const text = String(options.message || PARURU_MESSAGES.action.homeAgentError);
  homeAgentContent.innerHTML = `<p class="home-agent-error">${escapeHtml(text)}</p>`;
}

function hideHomeAgentCard() {
  homeAgentCard.classList.add("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "false");
  homeAgentContent.innerHTML = "";
  homeAgentRetryButton.classList.add("is-hidden");
  clearAgentFormMessage();
}

function renderHomeAgentResult(result) {
  homeAgentCard.classList.remove("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "false");
  homeAgentRetryButton.classList.add("is-hidden");

  const sections = [
    renderHomeAgentSummary(result.summary),
    renderHomeAgentScheduleSection(result.schedule),
    renderHomeAgentSchoolSection(result.school),
    renderHomeAgentLunchSection(result.lunch),
    renderHomeAgentWeatherSection(result.weather),
    renderHomeAgentRoomClimateSection(result.roomClimate),
    renderHomeAgentClimateTrendSection(result.climateTrend),
    renderHomeAgentClimateOverviewSection(result.roomClimateOverview),
    renderHomeAgentRoomAlertsSection(result.roomClimateAlerts),
    renderHomeAgentProposalSection(result.proposal),
    renderHomeAgentListSection("持ち物", result.suggestedItems),
    renderHomeAgentListSection("通知候補", result.notificationCandidates),
    renderHomeAgentWarnings(result.warnings),
    renderHomeAgentActions(result),
  ].filter(Boolean);

  homeAgentContent.innerHTML = sections.length > 0
    ? sections.join("")
    : `<p class="home-agent-empty">見られる情報はなかったよ。</p>`;
}

function renderAgentChatReply(reply) {
  renderHomeAgentResult({ summary: reply });
}

function renderHomeAgentSummary(summary) {
  if (!String(summary || "").trim()) {
    return "";
  }
  return `<p class="home-agent-summary">${escapeHtml(summary)}</p>`;
}

function renderHomeAgentListSection(title, value) {
  const items = normalizeHomeAgentList(value);
  if (items.length === 0) {
    return "";
  }

  return renderHomeAgentSection(title, items);
}

function renderHomeAgentSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  return `
    <section class="home-agent-section">
      <h2>${escapeHtml(title)}</h2>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderHomeAgentScheduleSection(schedule) {
  const items = normalizeHomeAgentList(schedule);
  return renderHomeAgentSection("予定", items);
}

function renderHomeAgentSchoolSection(school) {
  if (!school) {
    return "";
  }

  if (typeof school === "string") {
    const text = school.trim();
    return text ? renderHomeAgentSection("学校", [text]) : "";
  }

  const items = [];
  if (school.isSchoolDay === true) {
    items.push("学校あり");
  } else if (school.isSchoolDay === false) {
    items.push("学校なし");
  }

  normalizeHomeAgentList(school.events).forEach((eventText) => {
    if (eventText) {
      items.push(eventText);
    }
  });

  return renderHomeAgentSection("学校", items);
}

function renderHomeAgentLunchSection(lunch) {
  if (!lunch) {
    return "";
  }

  if (typeof lunch === "string") {
    const text = lunch.trim();
    return text ? renderHomeAgentSection("給食", [text]) : "";
  }

  const status = String(lunch.status || "").trim();
  if (status === "available" && String(lunch.menu || "").trim()) {
    return renderHomeAgentSection("給食", [String(lunch.menu).trim()]);
  }
  if (status === "no_lunch") {
    return renderHomeAgentSection("給食", ["給食なし"]);
  }
  if (status === "no_data" || status === "data_missing") {
    return renderHomeAgentSection("給食", ["給食データなし"]);
  }

  return "";
}

function renderHomeAgentWeatherSection(weather) {
  if (!weather) {
    return "";
  }

  if (typeof weather === "string") {
    const text = weather.trim();
    return text ? renderHomeAgentSection("天気", [text]) : "";
  }

  const items = [];
  const weatherText = String(weather.weather || weather.condition || "").trim();
  if (weatherText) {
    items.push(weatherText);
  }

  const currentTemperature = formatHomeAgentTemperature(weather.currentTemperature ?? weather.temperature);
  const minTemperature = formatHomeAgentTemperature(weather.minTemperature);
  const maxTemperature = formatHomeAgentTemperature(weather.maxTemperature);
  if (currentTemperature) {
    items.push(currentTemperature);
  } else if (minTemperature && maxTemperature) {
    items.push(`${minTemperature}〜${maxTemperature}`);
  } else if (maxTemperature) {
    items.push(`最高${maxTemperature}`);
  } else if (minTemperature) {
    items.push(`最低${minTemperature}`);
  }

  const precipitation = formatHomeAgentPercent(weather.precipitationProbability ?? weather.precipitation);
  if (precipitation) {
    items.push(`降水確率${precipitation}`);
  }

  return renderHomeAgentSection("天気", items.slice(0, 3));
}

function renderHomeAgentRoomClimateSection(climate) {
  if (!climate) {
    return "";
  }
  const items = [];
  if (climate.displayName) items.push(`部屋: ${climate.displayName}`);
  if (climate.temperature !== "" && climate.temperature != null) items.push(`温度: ${climate.temperature}℃`);
  if (climate.humidity !== "" && climate.humidity != null) items.push(`湿度: ${climate.humidity}％`);
  if (climate.measuredAt) items.push(`取得: ${climate.measuredAt}`);
  if (climate.comfortLabel) items.push(`ひとこと: ${climate.comfortLabel}`);
  if (climate.currentAirconState && (climate.currentAirconState.power || climate.currentAirconState.mode)) {
    const aircon = climate.currentAirconState;
    items.push(`エアコン: ${[aircon.power, aircon.mode, aircon.temperature ? `${aircon.temperature}℃` : ""].filter(Boolean).join(" ")}`);
  }
  if (climate.activePause) {
    items.push(`自動制御: 一時停止中${climate.activePause.expiresAt ? ` (${climate.activePause.expiresAt}まで)` : ""}`);
  }
  return renderHomeAgentSection("部屋の状態", items);
}

function renderHomeAgentRoomAlertsSection(alerts) {
  const items = normalizeHomeAgentList(alerts);
  return renderHomeAgentSection("気になる部屋", items);
}

function renderHomeAgentClimateTrendSection(trend) {
  if (!trend) {
    return "";
  }
  const items = [];
  if (trend.sampleCount !== undefined) items.push(`サンプル: ${trend.sampleCount}件`);
  if (trend.latestTemperature !== "" && trend.latestTemperature != null) items.push(`最新: ${formatHomeAgentTemperature(trend.latestTemperature)}`);
  if (trend.delta !== "" && trend.delta != null) items.push(`変化: ${trend.delta}℃`);
  if (trend.trend) items.push(`傾向: ${formatHomeAgentTrendLabel(trend.trend)}${trend.trendRate !== "" && trend.trendRate != null ? ` (${trend.trendRate}℃/10分)` : ""}`);
  if (trend.measuredFrom || trend.measuredTo) items.push(`${trend.measuredFrom || ""} - ${trend.measuredTo || ""}`);
  return renderHomeAgentSection("温度傾向", items.slice(0, 5));
}

function renderHomeAgentClimateOverviewSection(overview) {
  if (!overview || !Array.isArray(overview.rooms) || overview.rooms.length === 0) {
    return "";
  }
  const items = overview.rooms.slice(0, 3).map((room) => {
    const parts = [
      room.displayName || room.roomId || "部屋",
      formatHomeAgentTemperature(room.temperature),
      formatHomeAgentPercent(room.humidity),
      room.stateLabel || (room.state ? formatHomeAgentClimateStateLabel(room.state) : ""),
      room.actionComment || "",
    ].filter(Boolean);
    return parts.join(" / ");
  });
  return renderHomeAgentSection("家の温度", items);
}
function renderHomeAgentProposalSection(proposal) {
  if (!proposal) {
    return "";
  }
  const items = [];
  if (proposal.displayName) items.push(`対象: ${proposal.displayName}`);
  if (proposal.action === "set_aircon") {
    const mode = proposal.mode === "heat" ? "暖房" : proposal.mode === "dry" ? "除湿" : "冷房";
    if (proposal.currentRoomTemp !== "" && proposal.currentRoomTemp != null) items.push(`現在室温: ${formatHomeAgentTemperature(proposal.currentRoomTemp)}`);
    if (proposal.humidity !== "" && proposal.humidity != null) items.push(`湿度: ${formatHomeAgentPercent(proposal.humidity)}`);
    if (proposal.trend) items.push(`傾向: ${formatHomeAgentTrendLabel(proposal.trend)}${proposal.trendRate !== "" && proposal.trendRate != null ? ` (${proposal.trendRate}℃/10分)` : ""}`);
    if (proposal.currentSetTemp !== "" && proposal.currentSetTemp != null) items.push(`現在設定: ${mode}${formatHomeAgentTemperature(proposal.currentSetTemp)}`);
    if (proposal.proposedSetTemp !== "" && proposal.proposedSetTemp != null) items.push(`提案設定: ${mode}${formatHomeAgentTemperature(proposal.proposedSetTemp)}`);
    if (proposal.durationMinutes) items.push(`継続時間: ${proposal.durationMinutes}分`);
    if (proposal.reason) items.push(`理由: ${formatHomeAgentProposalReason(proposal.reason)}`);
    items.push("終了後は通常の自動制御へ戻す想定やで。");
    items.push("この版では実操作も一時停止保存もまだしない。");  } else if (proposal.action === "pause_room_automation") {
    items.push(`自動制御を${proposal.expiresAt || "一時的に"}まで止める候補`);
  } else if (proposal.action === "resume_room_automation") {
    items.push("通常運転へ戻す候補");
  }
  items.push("確認するまで操作しないよ。");
  return renderHomeAgentSection("操作候補", items);
}

function renderHomeAgentWarnings(warnings) {
  const items = normalizeHomeAgentList(warnings);
  if (items.length === 0) {
    return "";
  }

  return `
    <section class="home-agent-section home-agent-warning-section">
      <h2>確認できんかったこと</h2>
      <ul>${items.map((item) => `<li class="home-agent-warning">${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderHomeAgentActions(result) {
  const actionCandidates = Array.isArray(result.actionCandidates) ? result.actionCandidates : [];
  if (actionCandidates.length > 0 && !canUseHomeControl_()) {
    return renderHomeAgentControlUnavailableNotice(true);
  }
  const nonSignageCandidates = actionCandidates.filter((candidate) => !isSignageActionCandidate(candidate));
  const candidate = findSignageActionCandidate(result.actionCandidates);
  if (!candidate && nonSignageCandidates.length === 0) {
    return "";
  }

  const buttons = [];
  if (candidate) {
    const messageText = getSignageMessage(result, candidate);
    buttons.push(`<button type="button" data-home-agent-signage="${escapeHtml(messageText)}">サイネージで知らせる</button>`);
  }
  nonSignageCandidates.forEach((actionCandidate) => {
    const encoded = encodeURIComponent(JSON.stringify(actionCandidate));
    buttons.push(`<button type="button" data-home-agent-action="${escapeHtml(encoded)}">${escapeHtml(getHomeAgentActionLabel(actionCandidate))}</button>`);
  });
  buttons.push(`<button class="secondary-button" type="button" data-home-agent-confirm-close>そのまま</button>`);
  return `<div class="home-agent-actions">${buttons.join("")}</div>`;
}

function renderHomeAgentControlUnavailableNotice(returnHtml = false) {
  const notice = `<p class="home-agent-empty home-agent-control-unavailable">この端末では家の状態確認だけ利用できます。</p>`;
  if (returnHtml) return notice;
  homeAgentContent.insertAdjacentHTML("beforeend", notice);
  pendingHomeAgentActionCandidate = null;
  return "";
}

function parseHomeAgentActionCandidate(encoded) {
  try {
    return JSON.parse(decodeURIComponent(encoded || ""));
  } catch (error) {
    debugLog("[Paruru] invalid Home Agent action candidate", error?.message || error);
    return null;
  }
}

function normalizeHomeAgentList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(formatHomeAgentValue).filter(Boolean);
  }

  const text = String(value).trim();
  return text ? [text] : [];
}

function formatHomeAgentValue(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "";
  }
  if (typeof value === "object") {
    if (value.message) {
      return String(value.message).trim();
    }
    if (value.title) {
      const timeText = extractHomeAgentTime(value.start || value.startTime || value.time || "");
      return [timeText, value.title, value.location || ""].filter(Boolean).join(" ");
    }
    if (value.name) {
      return [value.name, value.value || ""].filter(Boolean).join(": ");
    }
    return "";
  }
  return String(value).trim();
}

function extractHomeAgentTime(value) {
  const text = String(value || "");
  const match = text.match(/(?:^|\s)(\d{1,2}:\d{2})/);
  return match ? match[1] : "";
}

function formatHomeAgentTemperature(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "";
  }
  const text = String(value).trim();
  if (!text) {
    return "";
  }
  return /℃$/.test(text) ? text : `${text}℃`;
}

function formatHomeAgentPercent(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "";
  }
  const text = String(value).trim();
  if (!text) {
    return "";
  }
  return /%|％$/.test(text) ? text : `${text}％`;
}

function formatHomeAgentTrendLabel(value) {
  const key = String(value || "").trim();
  if (key === "rising") return "上昇中";
  if (key === "falling") return "下降中";
  if (key === "stable") return "横ばい";
  if (key === "unknown") return "温度の動きはまだデータ不足";
  return key;
}

function formatHomeAgentClimateStateLabel(value) {
  const key = String(value || "").trim();
  const labels = {
    hot: "暑め",
    slightly_hot: "少し暑め",
    cold: "寒め",
    slightly_cold: "少し寒め",
    humid: "湿度高め",
    dry: "乾燥気味",
    stale: "センサー古め",
    comfortable: "快適",
    unknown: "データ不足",
    too_hot: "かなり暑い",
  };
  return labels[key] || "状態は確認中";
}

function formatHomeAgentProposalReason(value) {
  const key = String(value || "").trim();
  const labels = {
    above_target_and_rising: "目標より高く、まだ上がり気味",
    above_target_and_not_improving: "目標より高く、下がりきっていない",
    below_target_and_falling: "目標より低く、まだ下がり気味",
    hot: "暑いという体感",
    cold: "寒いという体感",
    stronger: "強めたいという指定",
    weaker: "弱めたいという指定",
    explicit_down: "1度下げる指定",
    explicit_up: "1度上げる指定",
  };
  return labels[key] || key;
}

function findSignageActionCandidate(candidates) {
  if (!Array.isArray(candidates)) {
    return null;
  }
  return candidates.find((candidate) => {
    return isSignageActionCandidate(candidate);
  }) || null;
}

function isSignageActionCandidate(candidate) {
  if (typeof candidate === "string") {
    return candidate === "createSignageAlert";
  }
  return candidate?.type === "createSignageAlert"
    || candidate?.action === "createSignageAlert"
    || candidate?.skill === "createSignageAlert";
}

function getHomeAgentActionLabel(candidate) {
  if (candidate?.actionLabel) return String(candidate.actionLabel);
  if (candidate?.command === "automation.pause") return "実行する";
  if (candidate?.command === "automation.resume") return "実行する";
  const skill = candidate?.skill || candidate?.action || "";
  if (skill === "setAirconOverride") return "この設定にする";
  if (skill === "pauseRoomAutomation") return "自動制御だけ止める";
  if (skill === "resumeRoomAutomation") return "通常運転に戻す";
  return "候補を確認する";
}

function getSignageMessage(result, candidate) {
  if (typeof candidate === "object") {
    return candidate.signageMessage
      || candidate.message
      || candidate.parameters?.message
      || candidate.payload?.message
      || result.signageMessage
      || result.summary
      || "";
  }
  return result.signageMessage || result.summary || "";
}

function renderSignageConfirmation(signageMessage) {
  const existing = homeAgentContent.querySelector("[data-home-agent-confirm]");
  if (existing) {
    existing.remove();
  }

  homeAgentContent.insertAdjacentHTML("beforeend", `
    <div class="home-agent-confirm" data-home-agent-confirm>
      <p>この内容をサイネージで読み上げる？</p>
      <p>${escapeHtml(signageMessage || "内容は未指定です。")}</p>
      <div class="home-agent-confirm-actions">
        <button class="secondary-button" type="button" data-home-agent-confirm-close>あとで</button>
      </div>
    </div>
  `);
  revealPanelIfNeeded(homeAgentCard);
}

function renderHomeAgentActionConfirmation(actionCandidate) {
  if (!canUseHomeControl_()) {
    pendingHomeAgentActionCandidate = null;
    renderHomeAgentControlUnavailableNotice();
    return;
  }
  const existing = homeAgentContent.querySelector("[data-home-agent-confirm]");
  if (existing) {
    existing.remove();
  }

  pendingHomeAgentActionCandidate = actionCandidate;
  const actionLabel = getHomeAgentActionLabel(actionCandidate);
  const skill = actionCandidate?.skill || actionCandidate?.action || actionCandidate?.command || "";
  const canExecute = (actionCandidate?.type === "homeAgentActionConfirmation" || actionCandidate?.type === "agentActionConfirmation")
    && isUuid(actionCandidate?.confirmationId)
    && isUuid(actionCandidate?.clientRequestId);
  const message = skill === "setAirconOverride"
      ? "この版ではエアコン温度変更はまだ未接続。押しても実操作もpause保存もしないよ。"
    : String(actionCandidate?.confirmationMessage || "この端末では操作を利用できんで。");
  const executeButton = skill === "setAirconOverride"
    ? `<button type="button" data-home-agent-action-unconnected>${escapeHtml(actionLabel)}</button>`
    : canExecute
    ? `<button type="button" data-home-agent-action-execute>${escapeHtml(actionLabel)}</button>`
    : "";

  homeAgentContent.insertAdjacentHTML("beforeend", `
    <div class="home-agent-confirm" data-home-agent-confirm>
      <p>この操作を実行する？</p>
      <p>${escapeHtml(message)}</p>
      <div class="home-agent-confirm-actions">
        <button class="secondary-button" type="button" data-home-agent-confirm-close>やめる</button>
        ${executeButton}
      </div>
    </div>
  `);
  revealPanelIfNeeded(homeAgentCard);
}

function hideSignageConfirmation() {
  homeAgentContent.querySelector("[data-home-agent-confirm]")?.remove();
  pendingHomeAgentActionCandidate = null;
}

async function cancelPendingHomeAgentAction() {
  const candidate = pendingHomeAgentActionCandidate;
  if (!canUseHomeControl_()) {
    hideSignageConfirmation();
    return;
  }
  if (!candidate || candidate.type !== "agentActionConfirmation") {
    hideSignageConfirmation();
    return;
  }
  const confirmPanel = homeAgentContent.querySelector("[data-home-agent-confirm]");
  const closeButton = confirmPanel?.querySelector("[data-home-agent-confirm-close]");
  if (closeButton) {
    closeButton.disabled = true;
    closeButton.textContent = "取り消し中…";
  }
  try {
    const response = await cancelAgentActionConfirmation(candidate);
    if (!response.success) {
      throw new Error(response.message || response.error?.message || "agent action cancel failed");
    }
    hideSignageConfirmation();
    hideHomeAgentCard();
    setParuruSpeech("idle", "やめといたで。");
  } catch (error) {
    debugLog("[Paruru] Agent action cancel failed", error?.message || error);
    if (closeButton) {
      closeButton.disabled = false;
      closeButton.textContent = "やめる";
    }
    if (confirmPanel && !confirmPanel.querySelector(".home-agent-error")) {
      confirmPanel.insertAdjacentHTML("beforeend", `<p class="home-agent-error">取り消しに失敗したで。期限切れまで実行せんようにしてな。</p>`);
    }
  }
}

async function executePendingHomeAgentAction() {
  const candidate = pendingHomeAgentActionCandidate;
  if (!candidate) {
    return;
  }
  if (!canUseHomeControl_()) {
    hideSignageConfirmation();
    return;
  }

  const confirmPanel = homeAgentContent.querySelector("[data-home-agent-confirm]");
  const executeButton = confirmPanel?.querySelector("[data-home-agent-action-execute]");
  if (executeButton) {
    executeButton.disabled = true;
    executeButton.textContent = "ちょっと待って。";
  }

  try {
    const response = candidate.type === "agentActionConfirmation"
      ? await executeAgentActionConfirmation(candidate)
      : await executeHomeAgentAction(candidate);
    if (!response.success && !["failed", "unknown"].includes(response.status)) {
      throw new Error(response.message || response.error?.message || "home agent action failed");
    }
    const result = response.result || {};
    const successMessage = formatAgentActionResult(response, result, candidate);
    pendingHomeAgentActionCandidate = null;
    homeAgentCard.classList.remove("is-hidden");
    homeAgentCard.setAttribute("aria-busy", "false");
    homeAgentRetryButton.classList.add("is-hidden");
    homeAgentContent.innerHTML = `
      <section class="home-agent-section home-agent-action-result">
        <p>${escapeHtml(successMessage)}</p>
      </section>
    `;
    if (response.status === "completed") {
      memoInput.value = "";
    }
    setParuruSpeech("idle", "直しといたよ。");
    revealPanelIfNeeded(homeAgentCard);
  } catch (error) {
    debugLog("[Paruru] Home Agent action failed", error?.message || error);
    if (confirmPanel && !confirmPanel.querySelector(".home-agent-error")) {
      confirmPanel.insertAdjacentHTML("beforeend", `<p class="home-agent-error">うまくいかんかった。もう一回だけ試して。</p>`);
    }
    if (executeButton) {
      executeButton.disabled = false;
      executeButton.textContent = getHomeAgentActionLabel(pendingHomeAgentActionCandidate);
    }
  }
}

function formatAgentActionResult(response, result, candidate) {
  if (response.status === "unknown") return "操作結果を確認できませんでした。自動では再実行せんで。もう一度操作する場合は、最初から頼んでな。";
  if (response.status === "failed") return "操作を受け付けられませんでした。自動では再実行せんで。";
  const command = String(candidate?.command || "");
  const roomLabel = String(candidate?.roomLabel || "").trim();
  const roomPrefix = roomLabel ? `${roomLabel}の` : "";
  if (command === "automation.pause") return "自動制御を一時停止しました";
  if (command === "automation.resume") return "自動制御を再開しました";
  if (command === "aircon.applySettings") return `${roomPrefix}エアコン設定の変更操作を受け付けました`;
  if (command === "aircon.power") return `${roomPrefix}エアコンの運転操作を受け付けました`;
  if (candidate?.type === "homeAgentActionConfirmation") {
    if (response.operation === "pause") return formatHomeAgentPauseSuccess(result);
    if (response.operation === "resume") return "通常運転に戻したよ。";
  }
  return "操作を受け付けました";
}

function formatHomeAgentPauseSuccess(result) {
  const pause = result.activePause || result.pause || {};
  if (pause.expiresAt) {
    return `自動制御は${pause.expiresAt}まで止めといたよ。`;
  }
  return "自動制御を一時停止したよ。";
}

function getHomeAgentSpeech(result) {
  if (String(result?.summary || "").trim()) {
    return PARURU_MESSAGES.speech.homeAgent;
  }
  return "見られる分だけ見といたよ。";
}

async function submitFollowupAnswer(target) {
  const state = getFollowupUi(target);
  const payload = buildFollowupPayload(state);

  if (!payload) {
    focusFirstFollowupInput(state);
    return;
  }

  setFollowupSubmitting(target, true);
  try {
    const result = await answerFollowup(payload);
    completeFollowupUiAfterSuccess(target, state);
    updateLocalItem(result.item);
    if (target === "detail" && result.item) {
      renderFollowupPanel("detail", result.item);
    }
    if (activeView === "inbox") {
      await loadInbox({ quiet: true });
    }
    await loadNotificationCandidates({ force: true });
    showTemporaryParuruMessage("よし、これで分かった。", "success", "success");
  } catch (error) {
    setParuruState("error", { showStatus: true });
    showMessage(PARURU_MESSAGES.action.followupError, "error");
  } finally {
    setFollowupSubmitting(target, false);
  }
}

function renderFollowupPanel(target, item) {
  const state = getFollowupUi(target);
  if (!isFollowupNeeded(item) || !item?.followupQuestion) {
    hideFollowupPanel(target);
    return;
  }

  state.panel.dataset.itemId = item.id;
  state.panel.dataset.inputType = normalizeFollowupInputType(item.followupInputType, item.followupQuestion);
  state.panel.dataset.origin = item.followupOrigin === "agentChat" ? "agentChat" : "";
  state.question.textContent = item.followupQuestion;
  state.fields.innerHTML = renderFollowupFields(state.panel.dataset.inputType);
  state.submit.classList.toggle("is-hidden", state.panel.dataset.inputType === "yesno");
  state.panel.classList.remove("is-hidden");
  revealPanelIfNeeded(state.panel);
}

function hideFollowupPanel(target) {
  const state = getFollowupUi(target);
  state.panel.classList.add("is-hidden");
  state.panel.dataset.itemId = "";
  state.panel.dataset.inputType = "";
  state.panel.dataset.origin = "";
  clearFollowupInputs(state);
}

function completeFollowupUiAfterSuccess(target, state) {
  const shouldCloseAgentCard = target === "home" && state.panel.dataset.origin === "agentChat";
  hideFollowupPanel(target);
  if (shouldCloseAgentCard) hideHomeAgentCard();
}

function setFollowupSubmitting(target, isSubmittingAnswer) {
  const state = getFollowupUi(target);
  state.submit.disabled = isSubmittingAnswer;
  state.later.disabled = isSubmittingAnswer;
  state.fields.querySelectorAll("button").forEach((button) => {
    button.disabled = isSubmittingAnswer;
  });
  state.submit.textContent = isSubmittingAnswer ? "更新中..." : "回答する";
}

function getFollowupUi(target) {
  if (target === "detail") {
    return {
      panel: detailFollowup,
      question: detailFollowupQuestion,
      fields: detailFollowupFields,
      submit: detailFollowupSubmit,
      later: detailFollowupLater,
    };
  }

  return {
    panel: homeFollowup,
    question: homeFollowupQuestion,
    fields: homeFollowupFields,
    submit: homeFollowupSubmit,
    later: homeFollowupLater,
  };
}

function renderFollowupFields(inputType) {
  if (inputType === "yesno") {
    return `
      <div class="followup-yesno">
        <button type="button" data-followup-answer="はい">はい</button>
        <button class="secondary-button" type="button" data-followup-answer="いいえ">いいえ</button>
      </div>
    `;
  }

  const fields = [];

  if (inputType === "date" || inputType === "datetime") {
    fields.push(`
      <label class="followup-field">
        <span>日付を選ぶ</span>
        <input class="followup-date-input" type="date" data-followup-date>
      </label>
    `);
  }

  if (inputType === "time" || inputType === "datetime") {
    fields.push(`
      <label class="followup-field">
        <span>時刻を選ぶ</span>
        <input class="followup-time-input" type="time" data-followup-time>
      </label>
    `);
  }

  fields.push(`
    <label class="followup-field">
      <span>${inputType === "text" ? "回答" : "または自由入力"}</span>
      <input class="followup-answer-input" type="text" placeholder="明日、来週月曜、夕方など" data-followup-answer-text>
    </label>
  `);

  return fields.join("");
}

function buildFollowupPayload(state) {
  const id = state.panel.dataset.itemId;
  const inputType = state.panel.dataset.inputType || "text";
  const answerDate = state.fields.querySelector("[data-followup-date]")?.value || "";
  const answerTime = state.fields.querySelector("[data-followup-time]")?.value || "";
  const answer = state.fields.querySelector("[data-followup-answer-text]")?.value.trim() || "";

  if (!id || (!answerDate && !answerTime && !answer)) {
    return null;
  }

  const payload = {
    id,
    answer,
    followupInputType: inputType,
  };

  if (answerDate) {
    payload.answerDate = answerDate;
  }

  if (answerTime) {
    payload.answerTime = answerTime;
  }

  return payload;
}

function handleFollowupPanelClick(event, target) {
  const button = event.target.closest("[data-followup-answer]");
  if (!button) {
    return;
  }

  const state = getFollowupUi(target);
  const id = state.panel.dataset.itemId;
  if (!id) {
    return;
  }

  submitFollowupDirectAnswer(target, button.dataset.followupAnswer);
}

async function submitFollowupDirectAnswer(target, answer) {
  const state = getFollowupUi(target);
  const id = state.panel.dataset.itemId;
  if (!id || !answer) {
    return;
  }

  setFollowupSubmitting(target, true);
  try {
    const result = await answerFollowup({
      id,
      answer,
      followupInputType: "yesno",
    });
    completeFollowupUiAfterSuccess(target, state);
    updateLocalItem(result.item);
    if (activeView === "inbox") {
      await loadInbox({ quiet: true });
    }
    await loadNotificationCandidates({ force: true });
    showTemporaryParuruMessage("よし、これで分かった。", "success", "success");
  } catch (error) {
    setParuruState("error", { showStatus: true });
    showMessage(PARURU_MESSAGES.action.followupError, "error");
  } finally {
    setFollowupSubmitting(target, false);
  }
}

function renderCalendarSyncPanel(target, item) {
  const state = getCalendarSyncUi(target);
  if (!shouldShowCalendarCandidate(item)) {
    hideCalendarSyncPanel(target);
    return;
  }

  const mode = getCalendarSyncMode(item);
  const defaults = buildCalendarDefaults(item);
  if (target === "home") {
    setParuruSpeech("calendarPrompt");
  }
  state.panel.dataset.itemId = item.id;
  state.panel.dataset.mode = mode;
  state.panel.querySelector(".calendar-sync-label").textContent = getCalendarSyncLabel(item, mode);
  state.fields.innerHTML = renderCalendarSyncFields(defaults);
  state.submit.disabled = false;
  state.later.disabled = false;
  state.submit.textContent = mode === "update" ? "カレンダーを更新" : "登録する";
  state.panel.classList.remove("is-hidden");
  revealPanelIfNeeded(state.panel);
}

function hideCalendarSyncPanel(target) {
  const state = getCalendarSyncUi(target);
  state.panel.classList.add("is-hidden");
  state.panel.dataset.itemId = "";
  state.panel.dataset.mode = "";
  state.fields.innerHTML = "";
}

function getCalendarSyncUi(target) {
  if (target === "detail") {
    return {
      panel: detailCalendarSync,
      fields: detailCalendarSyncFields,
      submit: detailCalendarSubmit,
      later: detailCalendarLater,
    };
  }

  return {
    panel: homeCalendarSync,
    fields: homeCalendarSyncFields,
    submit: homeCalendarSubmit,
    later: homeCalendarLater,
  };
}

function renderCalendarSyncFields(defaults) {
  return `
    <label class="calendar-sync-field">
      <span>タイトル</span>
      <input type="text" data-calendar-title value="${escapeHtml(defaults.calendarTitle)}">
    </label>
    <label class="calendar-sync-field">
      <span>日付</span>
      <input type="date" data-calendar-start-date value="${escapeHtml(defaults.startDate)}">
    </label>
    <label class="calendar-sync-field">
      <span>開始時刻</span>
      <input type="time" data-calendar-start-time value="${escapeHtml(defaults.startTime)}">
    </label>
    <label class="calendar-sync-field">
      <span>終了日</span>
      <input type="date" data-calendar-end-date value="${escapeHtml(defaults.endDate)}">
    </label>
    <label class="calendar-sync-field">
      <span>終了時刻</span>
      <input type="time" data-calendar-end-time value="${escapeHtml(defaults.endTime)}">
    </label>
    <label class="calendar-sync-check">
      <input type="checkbox" data-calendar-all-day ${defaults.allDay ? "checked" : ""}>
      <span>終日予定</span>
    </label>
    <label class="calendar-sync-field">
      <span>登録先</span>
      <select data-calendar-target>
        <option value="family" ${defaults.calendarTarget === "family" ? "selected" : ""}>ファミリー</option>
        <option value="personal" ${defaults.calendarTarget === "personal" ? "selected" : ""}>個人</option>
        <option value="shared" ${defaults.calendarTarget === "shared" ? "selected" : ""}>共有</option>
      </select>
    </label>
  `;
}

async function submitCalendarSync(target) {
  if (isCalendarSyncing) {
    return;
  }

  const state = getCalendarSyncUi(target);
  const payload = buildCalendarSyncPayload(state);
  if (!payload) {
    showMessage(PARURU_MESSAGES.action.calendarInputInvalid, "error");
    return;
  }

  setCalendarSubmitting(target, true);
  try {
    const mode = state.panel.dataset.mode;
    const result = mode === "update"
      ? await updateCalendar(payload)
      : await syncCalendar(payload);
    const successCheck = getCalendarSuccessCheck(result, mode);
    debugLog("[Paruru] calendar success check", successCheck);
    if (!successCheck.ok) {
      throw new Error("Calendar sync response did not confirm synced event");
    }

    updateLocalItem(result.item);
    hideCalendarSyncPanel(target);
    if (target === "detail" && result.item) {
      renderDetailCalendarStatus(result.item);
      renderCalendarSyncPanel("detail", result.item);
    }
    if (activeView === "inbox") {
      await loadInbox({ quiet: true });
    }
    await loadNotificationCandidates({ force: true });
    const successLine = mode === "update"
      ? PARURU_MESSAGES.action.calendarUpdateSuccess
      : PARURU_MESSAGES.action.calendarCreateSuccess;
    showTemporaryParuruMessage(mode === "update" ? PARURU_MESSAGES.action.calendarUpdateSuccess : PARURU_MESSAGES.speech.calendarSynced, "success", "success");
    showMessage(successLine, "success");
  } catch (error) {
    debugLog("[Paruru] calendar sync failed", error?.message || error);
    showMessage(PARURU_MESSAGES.action.calendarError, "error");
    setParuruState("error");
  } finally {
    setCalendarSubmitting(target, false);
  }
}

function buildCalendarSyncPayload(state) {
  const profile = getCurrentProfile();
  const id = state.panel.dataset.itemId;
  const calendarTitle = state.fields.querySelector("[data-calendar-title]")?.value.trim() || "";
  const startDate = state.fields.querySelector("[data-calendar-start-date]")?.value || "";
  const startTime = state.fields.querySelector("[data-calendar-start-time]")?.value || "";
  const endDate = state.fields.querySelector("[data-calendar-end-date]")?.value || startDate;
  const endTime = state.fields.querySelector("[data-calendar-end-time]")?.value || "";
  const allDay = Boolean(state.fields.querySelector("[data-calendar-all-day]")?.checked);
  const calendarTarget = state.fields.querySelector("[data-calendar-target]")?.value || profile.defaultCalendar;

  if (!id || !calendarTitle || !startDate) {
    return null;
  }

  if (!allDay && (!startTime || !endDate || !endTime)) {
    return null;
  }

  if (!allDay && compareDateTimeValues(startDate, startTime, endDate, endTime) >= 0) {
    return null;
  }

  if (allDay && compareDateOnlyValues(startDate, endDate || startDate) > 0) {
    return null;
  }

  return {
    id,
    calendarTarget,
    calendarTitle,
    startDate,
    startTime: allDay ? "" : startTime,
    endDate: endDate || startDate,
    endTime: allDay ? "" : endTime,
    allDay,
    userId: profile.userId,
    userDisplayName: profile.displayName,
    calendarSuffix: profile.calendarSuffix,
    deviceId: profile.deviceId,
  };
}

function getCalendarSuccessCheck(result, mode) {
  const item = result?.item;
  const conditions = {
    ok: false,
    responseSuccess: result?.success === true,
    hasItem: Boolean(item),
    synced: normalizeCalendarSyncStatus(item?.calendarSyncStatus) === "synced",
    hasEventId: Boolean(String(item?.calendarEventId || "").trim()),
    completed: mode !== "create" || String(item?.status || "").trim().toLowerCase() === "completed",
  };
  conditions.ok = conditions.responseSuccess &&
    conditions.hasItem &&
    conditions.synced &&
    conditions.hasEventId &&
    conditions.completed;
  return conditions;
}

function sanitizeCalendarPayloadForLog(payload) {
  return {
    id: payload?.id || "",
    calendarTarget: payload?.calendarTarget || "",
    calendarTitle: payload?.calendarTitle || "",
    startDate: payload?.startDate || "",
    startTime: payload?.startTime || "",
    endDate: payload?.endDate || "",
    endTime: payload?.endTime || "",
    allDay: Boolean(payload?.allDay),
    userId: payload?.userId || "",
    hasDeviceId: Boolean(payload?.deviceId),
  };
}

function sanitizeApiResponseForLog(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  return {
    success: result.success,
    status: result.status,
    message: result.message,
    item: result.item ? {
      id: result.item.id,
      status: result.item.status,
      type: result.item.type,
      calendarSyncStatus: result.item.calendarSyncStatus,
      hasCalendarEventId: Boolean(String(result.item.calendarEventId || "").trim()),
      calendarName: result.item.calendarName,
      calendarSyncedAt: result.item.calendarSyncedAt,
    } : null,
  };
}

function compareDateOnlyValues(leftDate, rightDate) {
  const left = parseYmd(leftDate);
  const right = parseYmd(rightDate);
  if (!left || !right) {
    return 0;
  }

  return getDateOnlyEpochDay(left) - getDateOnlyEpochDay(right);
}

function compareDateTimeValues(startDate, startTime, endDate, endTime) {
  return parseLocalDateTimeValue(startDate, startTime) - parseLocalDateTimeValue(endDate, endTime);
}

function setCalendarSubmitting(target, submitting) {
  isCalendarSyncing = submitting;
  const state = getCalendarSyncUi(target);
  state.submit.disabled = submitting;
  state.later.disabled = submitting;
  const mode = state.panel.dataset.mode;
  state.submit.textContent = submitting
    ? "送信中..."
    : mode === "update" ? "カレンダーを更新" : "登録する";
}

function shouldShowCalendarCandidate(item) {
  if (!item || normalizeType(item.type) !== "event") {
    return false;
  }

  if (!item.eventStart) {
    return false;
  }

  const status = normalizeCalendarSyncStatus(item.calendarSyncStatus);
  if (status === "update_required" && item.calendarEventId) {
    return true;
  }

  if (status === "failed" && item.calendarEventId) {
    return true;
  }

  return !item.calendarEventId && status !== "synced";
}

function getCalendarSyncMode(item) {
  const status = normalizeCalendarSyncStatus(item.calendarSyncStatus);
  return (status === "update_required" || status === "failed") && item.calendarEventId
    ? "update"
    : "create";
}

function getCalendarSyncLabel(item, mode) {
  if (mode !== "update") {
    return "カレンダーに登録しますか？";
  }

  if (normalizeCalendarSyncStatus(item.calendarSyncStatus) === "failed") {
    return "カレンダー連携でエラーが出ています";
  }

  return "カレンダーの予定と内容が変わっています";
}

function buildCalendarDefaults(item) {
  const profile = getCurrentProfile();
  const startDate = item.eventStart || "";
  const startTime = normalizeTimeInputValue(item.eventStartTime);
  const hasStartTime = Boolean(startTime);
  const allDay = !hasStartTime;
  const fallbackEnd = hasStartTime ? addMinutesToDateTime(startDate, startTime, 60) : { date: startDate, time: "" };
  const endDate = item.eventEnd || fallbackEnd.date || startDate;
  const endTime = normalizeTimeInputValue(item.eventEndTime) || fallbackEnd.time;
  return {
    calendarTitle: buildCalendarTitle(item.calendarTitle || item.title || item.memo?.slice(0, 20) || "予定", profile.calendarSuffix),
    startDate,
    startTime,
    endDate,
    endTime: allDay ? "" : endTime,
    allDay,
    calendarTarget: profile.defaultCalendar || "family",
  };
}

function buildCalendarTitle(title, suffix) {
  const baseTitle = String(title || "").trim();
  const normalizedSuffix = String(suffix || "").trim();
  if (!baseTitle || !normalizedSuffix || baseTitle.endsWith(normalizedSuffix)) {
    return baseTitle;
  }

  return `${baseTitle}${normalizedSuffix}`;
}

function hasCalendarRelevantChanges(beforeItem, afterItem) {
  if (!beforeItem?.calendarEventId) {
    return false;
  }

  const status = normalizeCalendarSyncStatus(beforeItem.calendarSyncStatus);
  if (status !== "synced" && status !== "update_required") {
    return false;
  }

  const fields = ["title", "eventStart", "eventStartTime", "eventEnd", "eventEndTime", "userId", "calendarSuffix"];
  return fields.some((field) => normalizeCalendarComparableValue(field, beforeItem[field]) !== normalizeCalendarComparableValue(field, afterItem[field])) ||
    buildCalendarTitle(beforeItem.title || beforeItem.memo || "", beforeItem.calendarSuffix || getCurrentProfile().calendarSuffix) !==
      buildCalendarTitle(afterItem.title || afterItem.memo || "", afterItem.calendarSuffix || getCurrentProfile().calendarSuffix);
}

function normalizeCalendarComparableValue(field, value) {
  if (field === "eventStartTime" || field === "eventEndTime") {
    return normalizeTimeInputValue(value);
  }

  return String(value || "").trim();
}

function normalizeTimeInputValue(value) {
  const text = normalizeAsciiDigits(String(value || "").trim())
    .replace(/[：]/g, ":")
    .replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  const isoMatch = text.match(/(?:T| )(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return normalizeHourMinute(isoMatch[1], isoMatch[2], /pm/i.test(text), /am/i.test(text));
  }

  const colonMatch = text.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (colonMatch) {
    return normalizeHourMinute(colonMatch[1], colonMatch[2], /^pm$/i.test(colonMatch[3] || ""), /^am$/i.test(colonMatch[3] || ""));
  }

  const jpMatch = text.match(/^(?:午(前|後)\s*)?(\d{1,2})\s*(?:時|じ)\s*(\d{1,2})?\s*(?:分)?/);
  if (jpMatch) {
    return normalizeHourMinute(jpMatch[2], jpMatch[3] || "00", jpMatch[1] === "後", jpMatch[1] === "前");
  }

  const digitsMatch = text.match(/^(\d{3,4})$/);
  if (digitsMatch) {
    const digits = digitsMatch[1].padStart(4, "0");
    return normalizeHourMinute(digits.slice(0, 2), digits.slice(2, 4), false, false);
  }

  return "";
}

function normalizeAsciiDigits(value) {
  return String(value || "").replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

function normalizeHourMinute(hourValue, minuteValue, isPm, isAm) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return "";
  }
  if (isPm && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  if (isAm && hour === 12) {
    hour = 0;
  }
  if (hour < 0 || hour > 23) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToDateTime(dateValue, timeValue, minutesToAdd) {
  const dateParts = parseYmd(dateValue);
  const timeMatch = String(timeValue || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!dateParts || !timeMatch) {
    return { date: dateValue || "", time: "" };
  }

  const date = new Date(dateParts.year, dateParts.month - 1, dateParts.day, Number(timeMatch[1]), Number(timeMatch[2]));
  date.setMinutes(date.getMinutes() + minutesToAdd);
  return {
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-"),
    time: [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
    ].join(":"),
  };
}

function clearFollowupInputs(state) {
  state.fields.querySelectorAll("input").forEach((input) => {
    input.value = "";
  });
}

function focusFirstFollowupInput(state) {
  state.fields.querySelector("input, button")?.focus();
}

function normalizeFollowupInputType(value, question) {
  const allowedTypes = ["date", "datetime", "time", "text", "yesno"];
  if (allowedTypes.includes(value)) {
    return value;
  }

  return inferFollowupInputType(question);
}

function inferFollowupInputType(question) {
  const text = String(question || "");

  if (/何日の何時|いつ.*何時|日付.*時刻|訪問日.*何時|いつ通知/.test(text)) {
    return "datetime";
  }

  if (/何時|時刻|何時まで|何時から/.test(text)) {
    return "time";
  }

  if (/締切|いつまで|何日|予定日|いつ/.test(text)) {
    return "date";
  }

  if (/はい|いいえ|必要|実行する|通知する|する？|必要？/.test(text)) {
    return "yesno";
  }

  return "text";
}

function isFollowupNeeded(item) {
  return item?.needsFollowup === true || item?.needsFollowup === "true" || item?.needsFollowup === "TRUE";
}

function updateLocalItem(updatedItem) {
  if (!updatedItem?.id) {
    return;
  }

  inboxItems = inboxItems.map((item) => item.id === updatedItem.id ? { ...item, ...updatedItem } : item);
}

function getCurrentProfile() {
  if (!userProfile) {
    userProfile = loadUserProfile();
  }

  const context = activeMembershipContext;
  if (!context) return userProfile;
  return Object.assign({}, userProfile, {
    userId: context.memberUserId,
    displayName: context.displayName,
    role: context.role,
    calendarSuffix: context.calendarSuffix || "",
    defaultCalendar: "family",
  });
}

function getTomorrowScheduleStartTime(profile = getCurrentProfile()) {
  return normalizeClockTime(profile?.tomorrowScheduleStartTime) || DEFAULT_TOMORROW_SCHEDULE_START_TIME;
}

function normalizeClockTime(value) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${match[1]}:${match[2]}`;
}

function loadUserProfile() {
  const stored = readStoredProfile();
  const profile = {
    selectedCalendarMemberKeys: stored.selectedCalendarMemberKeys,
    includeUnknownCalendarEvents: stored.includeUnknownCalendarEvents,
    tomorrowScheduleStartTime: stored.tomorrowScheduleStartTime,
    deviceId: stored.deviceId || createDeviceId(),
  };
  profile.selectedCalendarMemberKeys = normalizeCalendarMemberSelection(profile.selectedCalendarMemberKeys);
  profile.includeUnknownCalendarEvents = Boolean(profile.includeUnknownCalendarEvents);
  profile.tomorrowScheduleStartTime = getTomorrowScheduleStartTime(profile);
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function readStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function createDeviceId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateAgentChatSessionId() {
  const stored = String(localStorage.getItem(AGENT_CHAT_SESSION_STORAGE_KEY) || "").trim();
  if (isUuid(stored)) {
    return stored;
  }
  const sessionId = createUuid();
  localStorage.setItem(AGENT_CHAT_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function createUuid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function renderProfileForm() {
  const profile = getCurrentProfile();
  profileUserId.value = profile.userId || "";
  profileDisplayName.value = profile.displayName || "";
  if (profileRole) profileRole.value = profile.role || "";
  profileCalendarSuffix.value = profile.calendarSuffix || "";
  profileDefaultCalendar.value = "Family";
  profileDeviceId.value = profile.deviceId || "";
  if (profileTomorrowScheduleStartTime) {
    profileTomorrowScheduleStartTime.value = getTomorrowScheduleStartTime(profile);
  }
  renderCalendarMemberSelection(profile);
}

function saveUserProfileFromForm() {
  const current = getCurrentProfile();
  const profile = {
    selectedCalendarMemberKeys: readCalendarMemberSelectionFromForm(),
    includeUnknownCalendarEvents: Boolean(profileIncludeUnknownCalendarEvents?.checked),
    tomorrowScheduleStartTime: normalizeClockTime(profileTomorrowScheduleStartTime?.value) || DEFAULT_TOMORROW_SCHEDULE_START_TIME,
    deviceId: current.deviceId || createDeviceId(),
  };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function isViewAllowed_(viewName) {
  return appAuthenticationState === "active_member"
    && Array.isArray(activeMembershipContext?.allowedViews)
    && activeMembershipContext.allowedViews.includes(String(viewName || ""));
}

function normalizeAllowedView_(viewName) {
  return isViewAllowed_(viewName) ? viewName : isViewAllowed_("home") ? "home" : "";
}

function applyAllowedViews_() {
  viewNavigationItems.forEach((item) => {
    const allowed = isViewAllowed_(item.dataset.targetView);
    item.hidden = !allowed;
    item.disabled = !allowed;
    item.setAttribute("aria-hidden", String(!allowed));
  });
  views.forEach((view) => { view.hidden = !isViewAllowed_(view.dataset.view); });
}

function getHomeAgentPairingToken() {
  return String(localStorage.getItem(HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY) || "").trim();
}

function normalizeCalendarMemberSelection(value) {
  const allowed = ["father", "mother", "son1", "daughter1", "son2", "daughter2", "family"];
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const selected = source
    .map((entry) => String(entry || "").trim())
    .filter((entry) => allowed.includes(entry));
  return selected.length > 0 ? [...new Set(selected)] : [...DEFAULT_PROFILE.selectedCalendarMemberKeys];
}

function resolveCalendarMemberKeysForServer(value) {
  const aliases = {
    father: "father", mother: "mother", son1: "eldest_son", eldest_son: "eldest_son",
    daughter1: "eldest_daughter", eldest_daughter: "eldest_daughter", son2: "second_son", second_son: "second_son",
    daughter2: "youngest_daughter", youngest_daughter: "youngest_daughter", family: "family",
  };
  return [...new Set(normalizeCalendarMemberSelection(value).map((entry) => aliases[entry]).filter(Boolean))];
}

function renderCalendarMemberSelection(profile) {
  if (!profileCalendarMembers) {
    return;
  }
  const selected = normalizeCalendarMemberSelection(profile.selectedCalendarMemberKeys);
  profileCalendarMembers.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = selected.includes(input.value);
  });
  if (profileIncludeUnknownCalendarEvents) {
    profileIncludeUnknownCalendarEvents.checked = Boolean(profile.includeUnknownCalendarEvents);
  }
}

function readCalendarMemberSelectionFromForm() {
  if (!profileCalendarMembers) {
    return [...DEFAULT_PROFILE.selectedCalendarMemberKeys];
  }
  const selected = [...profileCalendarMembers.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value);
  return normalizeCalendarMemberSelection(selected);
}

function normalizeUserId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
}

function getRollingCalendarRequestPlan(nowMs, startTime) {
  const parts = getTokyoDateTimeParts(nowMs);
  const today = `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}`;
  const tomorrow = addRollingDays(today, 1);
  const threshold = normalizeClockTime(startTime) || DEFAULT_TOMORROW_SCHEDULE_START_TIME;
  const currentTime = `${padTwo(parts.hour)}:${padTwo(parts.minute)}`;
  return { today, tomorrow, includeTomorrow: currentTime >= threshold };
}

function getTokyoDateTimeParts(epochMs) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = {};
  formatter.formatToParts(new Date(epochMs)).forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return values;
}

function addRollingDays(dateValue, days) {
  const normalized = normalizeRollingDate(dateValue);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${padTwo(date.getUTCMonth() + 1)}-${padTwo(date.getUTCDate())}`;
}

function normalizeRollingDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function buildRollingDateTime(dateValue, timeValue) {
  const date = normalizeRollingDate(dateValue);
  const time = normalizeClockTime(String(timeValue || "").slice(0, 5));
  return date && time ? `${date} ${time}` : "";
}

function parseTokyoCandidateDateTime(value) {
  const text = String(value || "").trim();
  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    return Date.UTC(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4]) - 9,
      Number(localMatch[5]),
      Number(localMatch[6] || 0)
    );
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function padTwo(value) {
  return String(value).padStart(2, "0");
}

function getNextNotificationBoundaryAt(items, nowMs, startTime) {
  const plan = getRollingCalendarRequestPlan(nowMs, startTime);
  const thresholdParts = (normalizeClockTime(startTime) || DEFAULT_TOMORROW_SCHEDULE_START_TIME).split(":").map(Number);
  const boundaries = [tokyoLocalDateTimeToEpoch(addRollingDays(plan.today, 1), 0, 0)];
  const threshold = tokyoLocalDateTimeToEpoch(plan.today, thresholdParts[0], thresholdParts[1]);
  if (threshold > nowMs) boundaries.push(threshold);
  (Array.isArray(items) ? items : []).filter(isGoogleCalendarCandidate).forEach((item) => {
    if (item.allDay === true) return;
    const endMs = parseTokyoCandidateDateTime(item.endAt || buildRollingDateTime(item.eventEnd, item.eventEndTime));
    if (endMs !== null && endMs > nowMs) boundaries.push(endMs);
  });
  return Math.min(...boundaries.filter((value) => Number.isFinite(value) && value > nowMs));
}

function tokyoLocalDateTimeToEpoch(dateValue, hour, minute) {
  const match = normalizeRollingDate(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(hour) - 9, Number(minute));
}

function scheduleNotificationBoundary(items) {
  if (notificationBoundaryTimerId !== null) {
    window.clearTimeout(notificationBoundaryTimerId);
    notificationBoundaryTimerId = null;
  }
  if (!notificationBoundaryTimerEnabled) return;
  const nowMs = Date.now();
  const boundaryAt = getNextNotificationBoundaryAt(items, nowMs, getTomorrowScheduleStartTime());
  if (!Number.isFinite(boundaryAt)) return;
  notificationBoundaryTimerId = window.setTimeout(() => {
    notificationBoundaryTimerId = null;
    loadNotificationCandidates({ force: true });
  }, Math.max(1, boundaryAt - nowMs + 25));
}

function normalizeCalendarTarget(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["family", "personal", "shared"].includes(normalized) ? normalized : "family";
}

function inferCategory(memo, selectedCategory) {
  if (selectedCategory !== "未分類") {
    return "";
  }

  const normalizedMemo = memo.toLowerCase();
  const matchedRule = Object.entries(categoryRules).find(([, keywords]) =>
    keywords.some((keyword) => normalizedMemo.includes(keyword.toLowerCase()))
  );

  return matchedRule ? matchedRule[0] : "";
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.未分類;
}

function formatCreatedAt(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function formatDateTimeLabel(dateValue, timeValue = "") {
  const safeDate = normalizeDateInputValue(dateValue);
  const safeTime = normalizeTimeLabel(timeValue);
  const dateParts = parseYmd(safeDate);
  if (!dateParts) {
    return safeTime;
  }

  const today = getTodayTokyoParts();
  const includeYear = dateParts.year !== today.year;
  const dateLabel = includeYear
    ? `${dateParts.year}年${dateParts.month}月${dateParts.day}日`
    : `${dateParts.month}月${dateParts.day}日`;

  return [dateLabel, safeTime].filter(Boolean).join(" ");
}

function formatDateJa(dateValue) {
  const safeDate = normalizeDateInputValue(dateValue);
  const dateParts = parseYmd(safeDate);
  if (!dateParts) {
    return "";
  }

  return `${dateParts.month}/${dateParts.day}`;
}

function formatTimeJa(timeValue) {
  return normalizeTimeLabel(timeValue);
}

function formatItemDateTime(item) {
  const type = normalizeType(item.type);
  if (type === "event") {
    const start = formatDateTimeLabel(item.eventStart, item.eventStartTime);
    if (!start) {
      return "";
    }

    const endDate = normalizeDateInputValue(item.eventEnd);
    if (!endDate) {
      return start;
    }

    const endTime = normalizeTimeLabel(item.eventEndTime);
    const sameDay = endDate && endDate === normalizeDateInputValue(item.eventStart);
    const end = sameDay ? endTime : formatDateTimeLabel(endDate, endTime);
    return end ? `${start}〜${end}` : start;
  }

  if (type === "task") {
    return formatDateTimeLabel(item.dueDate, item.dueTime);
  }

  if (type === "reminder") {
    return formatDateTimeLabel(getReminderDateValue(item), getReminderTimeValue(item));
  }

  return "";
}

function getDueStatusLabel(item) {
  const type = normalizeType(item.type);
  if (type !== "task" || !item.dueDate) {
    return null;
  }

  const due = parseYmd(item.dueDate);
  if (!due) {
    return null;
  }

  const today = getTodayTokyoParts();
  const diffDays = getDateOnlyEpochDay(due) - getDateOnlyEpochDay(today);

  if (diffDays < 0) {
    return { key: "overdue", label: "期限切れ" };
  }

  if (diffDays === 0) {
    return { key: "today", label: "今日" };
  }

  if (diffDays === 1) {
    return { key: "tomorrow", label: "明日" };
  }

  return null;
}

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function normalizeTimeLabel(value) {
  return normalizeTimeInputValue(value);
}

function normalizeDateInputValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match || Number(match[1]) <= 1900) {
    return "";
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getReminderDateValue(item) {
  return normalizeDateInputValue(item.reminderDate || item.remindAt);
}

function getReminderTimeValue(item) {
  return normalizeTimeLabel(item.reminderTime || item.remindAt);
}

function buildReminderAtValue(dateValue, timeValue) {
  const date = normalizeDateInputValue(dateValue);
  const time = normalizeTimeLabel(timeValue);
  if (!date) {
    return "";
  }

  return time ? `${date} ${time}:00` : date;
}

function normalizeEditableStatus(status) {
  const normalized = String(status || "inbox").trim().toLowerCase();
  if (["done", "completed", "complete"].includes(normalized)) {
    return "Done";
  }
  if (["cancelled", "canceled", "deleted"].includes(normalized)) {
    return "cancelled";
  }
  return "inbox";
}

function parseLocalDateTimeValue(dateValue, timeValue = "") {
  const dateParts = parseYmd(dateValue);
  if (!dateParts) {
    return Number.MAX_SAFE_INTEGER;
  }

  const timeMatch = String(timeValue || "").match(/^(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  return Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
}

function parseCreatedAtValue(value) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseSortableDateValue(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (localMatch) {
    return new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
      Number(localMatch[6] || 0)
    ).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function getTodayTokyoParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function getDateOnlyEpochDay(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function epochDayToYmd(epochDay) {
  const date = new Date(epochDay * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function shouldShowInToday(item, targetParts) {
  if (!isInboxItem(item)) {
    return false;
  }

  const today = getDateOnlyEpochDay(targetParts);
  const todayYmd = epochDayToYmd(today);
  if (normalizeDateInputValue(item.eventStart) === todayYmd) {
    return true;
  }

  const dueParts = parseYmd(normalizeDateInputValue(item.dueDate));
  if (dueParts) {
    const diffDays = getDateOnlyEpochDay(dueParts) - today;
    if (diffDays <= 0 || (isShoppingItem(item) && diffDays <= 7)) {
      return true;
    }
  }

  if (getReminderDateValue(item) === todayYmd) {
    return true;
  }

  return isFollowupNeeded(item);
}

function isShoppingItem(item) {
  return ["shopping", "買い物", "purchase", "buy"].includes(String(item?.type || "").trim().toLowerCase());
}

function getCandidateTimeSortValue(candidate) {
  const time = normalizeTimeLabel(candidate.eventStartTime || candidate.dueTime || getReminderTimeValue(candidate));
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return 9999;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadDummyItems() {
  return JSON.parse(localStorage.getItem(DUMMY_STORAGE_KEY) || "[]");
}

function saveDummyItems(items) {
  localStorage.setItem(DUMMY_STORAGE_KEY, JSON.stringify(items));
}

function dummyHomeAgent(payload) {
  const messageText = String(payload.message || "");
  return Promise.resolve({
    success: true,
    result: {
      summary: messageText.includes("給食")
        ? "今日の給食は確認できる分だけ見といたよ。"
        : "今日は予定と持ち物、ざっと見といたよ。",
      schedule: [],
      school: messageText.includes("給食") ? "あり" : "",
      lunch: messageText.includes("給食") ? "サンプル給食" : "",
      weather: messageText.includes("傘") ? { condition: "雨", temperature: "28℃", precipitation: "60%" } : "",
      suggestedItems: messageText.includes("傘") ? ["傘"] : [],
      warnings: [],
      actionCandidates: [],
    },
  });
}

function dummyCreate(payload) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  const type = payload.memo.includes("授業参観") || payload.memo.includes("歯医者") ? "event" : "";
  const eventStart = payload.memo.includes("授業参観") ? "2026-07-20" : "";
  const eventStartTime = payload.memo.includes("13時半") ? "13:30" : "";
  const item = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: payload.memo.slice(0, 20),
    memo: payload.memo,
    category: payload.category || "未分類",
    type,
    status: payload.action === "createWithAI" ? "inbox" : "Inbox",
    priority: payload.priority || "Normal",
    source: payload.action === "createWithAI" ? "ai" : "PWA",
    tags: payload.tags || "[]",
    needsFollowup: false,
    followupQuestion: "",
    aiSummary: "",
    aiComment: "",
    confidence: "",
    eventStart,
    eventStartTime,
    userId: payload.userId || "",
    userDisplayName: payload.userDisplayName || "",
    calendarSuffix: payload.calendarSuffix || "",
    deviceId: payload.deviceId || "",
    visibility: payload.visibility || "private",
    calendarSyncStatus: type === "event" ? "pending" : "not_required",
    calendarEventId: "",
  };
  saveDummyItems([item, ...loadDummyItems()]);
  if (payload.action === "createWithAI") {
    return Promise.resolve({ success: true, item });
  }
  return Promise.resolve({ success: true, data: { id }, message: "saved" });
}

function dummyAnswerFollowup(payload) {
  let updatedItem = null;
  const items = loadDummyItems().map((item) => {
    if (item.id !== payload.id) {
      return item;
    }

    updatedItem = {
      ...item,
      dueDate: payload.answerDate || item.dueDate || payload.answer || "",
      dueTime: payload.answerTime || item.dueTime || "",
      needsFollowup: false,
      followupQuestion: "",
      followupInputType: "",
      updatedAt: new Date().toISOString(),
    };
    return updatedItem;
  });
  saveDummyItems(items);

  if (!updatedItem) {
    return Promise.resolve({ success: false, message: "not found" });
  }

  return Promise.resolve({ success: true, item: updatedItem, message: "followup answered" });
}

function dummyNotificationCandidates(userId) {
  const target = getTodayTokyoParts();
  const targetDay = getDateOnlyEpochDay(target);
  const items = loadDummyItems()
    .filter((item) => !userId || item.userId === userId)
    .filter(isDummyNotificationSource)
    .map((item, index) => buildDummyNotificationCandidate(item, index, targetDay))
    .filter((item) => item.reasons.length > 0)
    .sort(sortDummyNotificationCandidates)
    .slice(0, 10)
    .map(({ sortIndex, ...item }) => item);

  return Promise.resolve({
    success: true,
    targetDate: `${target.year}-${String(target.month).padStart(2, "0")}-${String(target.day).padStart(2, "0")}`,
    count: items.length,
    items,
  });
}

function isDummyNotificationSource(item) {
  return shouldShowInToday(item, getTodayTokyoParts());
}

function buildDummyNotificationCandidate(item, index, targetDay) {
  const title = item.title || item.memo?.slice(0, 20) || "無題";
  const reasons = getDummyNotificationReasons(item, targetDay);
  return {
    id: item.id,
    title,
    type: item.type || "",
    category: item.category || "",
    priority: normalizePriority(item.priority),
    dueDate: normalizeDateInputValue(item.dueDate),
    dueTime: normalizeTimeLabel(item.dueTime),
    eventStart: normalizeDateInputValue(item.eventStart),
    eventStartTime: normalizeTimeLabel(item.eventStartTime),
    eventEnd: normalizeDateInputValue(item.eventEnd),
    eventEndTime: normalizeTimeLabel(item.eventEndTime),
    remindAt: item.remindAt || "",
    needsFollowup: isFollowupNeeded(item),
    reasons,
    notificationLevel: getDummyNotificationLevel(reasons),
    message: buildDummyNotificationMessage(title, reasons),
    userId: item.userId || "",
    userDisplayName: item.userDisplayName || "",
    createdAt: item.createdAt || "",
    sortIndex: index,
  };
}

function getDummyNotificationReasons(item, targetDay) {
  const reasons = [];
  const targetDate = epochDayToYmd(targetDay);
  const type = normalizeType(item.type);
  if (type === "event" && normalizeDateInputValue(item.eventStart) === targetDate) {
    reasons.push(normalizeTimeLabel(item.eventStartTime) ? "event_today_timed" : "event_today");
  }

  const due = parseYmd(item.dueDate);
  if (due) {
    const diff = getDateOnlyEpochDay(due) - targetDay;
    if (diff < 0) {
      reasons.push("overdue");
    } else if (diff === 0) {
      reasons.push(isShoppingItem(item) ? "due_today" : (normalizeTimeLabel(item.dueTime) ? "due_today_timed" : "due_today"));
    } else if (isShoppingItem(item) && diff === 1) {
      reasons.push("due_tomorrow");
    } else if (isShoppingItem(item) && diff <= 7) {
      reasons.push("due_within_7_days");
    }
  }

  if (getReminderDateValue(item) === targetDate) {
    reasons.push("reminder_today");
  }

  if (isFollowupNeeded(item)) {
    reasons.push("followup_required");
  }

  const priority = normalizePriority(item.priority);
  if (priority === "Urgent") {
    reasons.push("urgent");
  } else if (priority === "High") {
    reasons.push("high_priority");
  }

  return reasons;
}

function sortDummyNotificationCandidates(a, b) {
  const reasonOrder = ["overdue", "event_today_timed", "calendar_event_today_timed", "due_today_timed", "due_today", "reminder_today", "event_today", "calendar_event_today", "urgent", "followup_required", "due_tomorrow", "due_within_7_days", "high_priority"];
  const rankA = Math.min(...a.reasons.map((reason) => reasonOrder.indexOf(reason)).filter((rank) => rank >= 0));
  const rankB = Math.min(...b.reasons.map((reason) => reasonOrder.indexOf(reason)).filter((rank) => rank >= 0));
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const timeA = getCandidateTimeSortValue(a);
  const timeB = getCandidateTimeSortValue(b);
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  const createdA = parseSortableDateValue(a.createdAt) || 0;
  const createdB = parseSortableDateValue(b.createdAt) || 0;
  if (createdA !== createdB) {
    return createdB - createdA;
  }

  return a.sortIndex - b.sortIndex;
}

function getDummyNotificationLevel(reasons) {
  if (reasons.includes("overdue") || reasons.includes("urgent")) {
    return "critical";
  }

  if (reasons.includes("due_today") || reasons.includes("followup_required")) {
    return "high";
  }

  return "normal";
}

function buildDummyNotificationMessage(title, reasons) {
  let message = "";
  if (reasons.includes("overdue")) {
    message = PARURU_MESSAGES.notificationMessage.overdue(title);
  } else if (reasons.includes("event_today_timed") || reasons.includes("event_today") || reasons.includes("reminder_today")) {
    message = title;
  } else if (reasons.includes("due_today") || reasons.includes("due_today_timed")) {
    message = PARURU_MESSAGES.notificationMessage.due_today(title);
  } else if (reasons.includes("urgent")) {
    message = PARURU_MESSAGES.notificationMessage.urgent(title);
  } else if (reasons.includes("followup_required")) {
    message = PARURU_MESSAGES.notificationMessage.followup_required(title);
  } else if (reasons.includes("due_tomorrow")) {
    message = PARURU_MESSAGES.notificationMessage.due_tomorrow(title);
  } else if (reasons.includes("due_within_7_days")) {
    message = PARURU_MESSAGES.notificationMessage.due_within_7_days(title);
  } else if (reasons.includes("high_priority")) {
    message = PARURU_MESSAGES.notificationMessage.high_priority(title);
  } else {
    message = PARURU_MESSAGES.notificationMessage.fallback(title);
  }
  return formatParuruLine_(message);
}

function dummySyncCalendar(payload) {
  let updatedItem = null;
  const items = loadDummyItems().map((item) => {
    if (item.id !== payload.id) {
      return item;
    }

    if (item.calendarEventId && item.calendarSyncStatus === "synced") {
      updatedItem = item;
      return item;
    }

    updatedItem = {
      ...item,
      calendarTitle: buildCalendarTitle(payload.calendarTitle, getCurrentProfile().calendarSuffix),
      calendarSyncStatus: "synced",
      calendarEventId: `dummy-calendar-${item.id}`,
      calendarName: "ファミリー",
      calendarSyncedAt: new Date().toISOString(),
      calendarStart: [payload.startDate, payload.startTime].filter(Boolean).join(" "),
      calendarEnd: [payload.endDate, payload.endTime].filter(Boolean).join(" "),
      calendarAllDay: payload.allDay,
      calendarLastError: "",
      status: normalizeType(item.type) === "event" ? "completed" : item.status,
      updatedAt: new Date().toISOString(),
    };
    return updatedItem;
  });
  saveDummyItems(items);

  if (!updatedItem) {
    return Promise.resolve({ success: false, message: "not found" });
  }

  return Promise.resolve({ success: true, item: updatedItem, message: "calendar synced" });
}

function dummyUpdateCalendar(payload) {
  let updatedItem = null;
  const items = loadDummyItems().map((item) => {
    if (item.id !== payload.id) {
      return item;
    }

    if (!item.calendarEventId) {
      updatedItem = item;
      return item;
    }

    updatedItem = {
      ...item,
      calendarTitle: buildCalendarTitle(payload.calendarTitle, getCurrentProfile().calendarSuffix),
      calendarSyncStatus: "synced",
      calendarSyncedAt: new Date().toISOString(),
      calendarStart: [payload.startDate, payload.startTime].filter(Boolean).join(" "),
      calendarEnd: [payload.endDate, payload.endTime].filter(Boolean).join(" "),
      calendarAllDay: payload.allDay,
      calendarLastError: "",
      updatedAt: new Date().toISOString(),
    };
    return updatedItem;
  });
  saveDummyItems(items);

  if (!updatedItem) {
    return Promise.resolve({ success: false, message: "not found" });
  }

  return Promise.resolve({ success: true, item: updatedItem, message: "calendar updated" });
}

function dummyUpdate(id, updates) {
  const items = loadDummyItems().map((item) => {
    if (item.id !== id) {
      return item;
    }

    const updatedItem = validateLocalItem({ ...item, ...updates, updatedAt: new Date().toISOString() });
    if (hasCalendarRelevantChanges(item, updatedItem)) {
      updatedItem.calendarSyncStatus = "update_required";
      updatedItem.calendarTitle = buildCalendarTitle(updatedItem.title || updatedItem.memo || "", getCurrentProfile().calendarSuffix);
      updatedItem.calendarLastError = "";
    }
    return updatedItem;
  });
  saveDummyItems(items);
  return Promise.resolve({ success: true, data: { id }, message: "updated" });
}

function validateLocalItem(item) {
  const validated = {
    ...item,
    dueDate: normalizeDateInputValue(item.dueDate),
    dueTime: normalizeTimeLabel(item.dueTime),
    eventStart: normalizeDateInputValue(item.eventStart),
    eventStartTime: normalizeTimeLabel(item.eventStartTime),
    eventEnd: normalizeDateInputValue(item.eventEnd),
    eventEndTime: normalizeTimeLabel(item.eventEndTime),
  };
  const type = normalizeType(validated.type);

  if (type === "task" && !validated.dueDate) {
    validated.needsFollowup = true;
    validated.followupQuestion = validated.followupQuestion || "いつまでにやる？";
    validated.followupInputType = "date";
  } else if (type === "event" && validated.eventStart) {
    validated.needsFollowup = false;
    validated.followupQuestion = "";
    validated.followupInputType = "";
  } else if (type === "event" && !validated.eventStart) {
    validated.needsFollowup = true;
    validated.followupQuestion = validated.followupQuestion || "いつの予定？";
    validated.followupInputType = "date";
  } else if (type === "reminder" && !getReminderDateValue(validated)) {
    validated.needsFollowup = true;
    validated.followupQuestion = validated.followupQuestion || "いつ通知する？";
    validated.followupInputType = "datetime";
  }

  return validated;
}

function dummyDelete(id) {
  saveDummyItems(loadDummyItems().filter((item) => item.id !== id));
  return Promise.resolve({ success: true, data: { id }, message: "deleted" });
}
