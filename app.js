const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxSyWgosHRhERKpBrzoMLpdG5_2xe0mtThCkQDtucHyCODj6xbK00Nb9nSVk8Fqdmd5Eg/exec";

const APP_VERSION = "1.0.0";
const ASSET_VERSION = "v20260711-15";
const BUILD_VERSION = ASSET_VERSION;
const DEBUG = false;
const DEFAULT_PRIORITY = "Normal";
const CHARACTER_BASE_PATH = "assets/character";
const assetUrl = (path) => `${path}?v=${ASSET_VERSION}`;
const PROFILE_STORAGE_KEY = "paruru-mini-profile";
const NOTIFICATION_CACHE_MS = 5000;
const NOTIFICATION_DISPLAY_LIMIT = 5;
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
];
const HOME_AGENT_MEMO_PRIORITY_PATTERNS = [
  /買う|購入|もらう|提出|送る|予約|登録|入れといて|入れて|メモ/,
  /^\s*\d{1,2}月\d{1,2}日/,
  /授業参観|面談|会議|歯医者|病院/,
];
const DEFAULT_PROFILE = {
  userId: "father",
  displayName: "父",
  calendarSuffix: "（父）",
  defaultCalendar: "family",
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
    hasNotifications: "兄弟、今日は気にしとくことあるよ。",
    noNotifications: "今日は急ぎなし。珍しいね、兄弟。",
    error: "うまくいかんかった。もう一回だけ。",
    notificationOne: "兄弟、ひとつ気にしといて。",
    notificationMany: (count) => `今日は${count}つあるよ。見といてな。`,
    homeAgent: "家の中、見てきたよ。",
  },
  state: {
    loading: "……ちょっと待って、兄弟。",
    normal: "……メモしとく？",
    sending: "ちょっと待って。今まとめよる。",
    success: "はいはい、預かったよ。",
    empty: "兄弟、何も書いてないよ。僕でも無理。",
    error: "うまくいかんかった。もう一回だけ試してみて。",
    inboxEmpty: "今日はまだ何も預かってないよ。珍しいね、兄弟。",
    done: "直しといたよ。えらいえらい。",
    deleteConfirm: "ほんまに消す？ 後で泣いても知らんよ。",
    deleted: "消しといたよ。",
  },
  notification: {
    loadingLine: "ちょっと見てくる。",
    loadingBody: "読み込み中...",
    empty: "今日は急ぎなし。珍しいね、兄弟。",
    loadedLine: "また忘れてそうなの、拾っといたよ。",
    error: "うまく読めんかった。もう一回だけ試してみて。",
    fallback: "兄弟、これ確認しといて。",
    more: (count) => `ほか${count}件`,
  },
  action: {
    profileSaved: "保存しといたよ、兄弟。",
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
    due_today: (title) => `兄弟、${title}は今日まで。僕は覚えとったよ。`,
    urgent: (title) => `至急やで。${title}、先に見といて。`,
    followup_required: (title) => `${title}、まだ確認が残っとるよ。答えとく？`,
    due_tomorrow: (title) => `${title}は明日まで。今日のうちにやっとく？`,
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
};

const form = document.querySelector("#inboxForm");
const memoInput = document.querySelector("#memo");
const categoryInput = document.querySelector("#category");
const priorityInputs = document.querySelectorAll('input[name="priority"]');
const paruruImage = document.querySelector("#paruruImage");
const paruruLine = document.querySelector("#paruruSpeech") || document.querySelector(".paruru-line");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const splash = document.querySelector("#splash");
const buildVersion = document.querySelector("#buildVersion");
const views = document.querySelectorAll(".app-view");
const navItems = document.querySelectorAll(".nav-item");
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
const profileCalendarSuffix = document.querySelector("#profileCalendarSuffix");
const profileDefaultCalendar = document.querySelector("#profileDefaultCalendar");
const profileDeviceId = document.querySelector("#profileDeviceId");
const todayParuru = document.querySelector("#todayParuru");
const todayParuruLine = document.querySelector("#todayParuruLine");
const todayParuruList = document.querySelector("#todayParuruList");
const todayParuruAllButton = document.querySelector("#todayParuruAllButton");
const refreshNotificationsButton = document.querySelector("#refreshNotificationsButton");
const homeAgentCard = document.querySelector("#homeAgentCard");
const homeAgentContent = document.querySelector("#homeAgentContent");
const homeAgentRetryButton = document.querySelector("#homeAgentRetryButton");
const homeAgentCloseButton = document.querySelector("#homeAgentCloseButton");

let lastHomeAgentMessage = "";

setParuruState("loading");

if ("serviceWorker" in navigator) {
  let refreshingForNewServiceWorker = false;

  debugLog("[Paruru] build version", { appVersion: APP_VERSION, buildVersion: BUILD_VERSION });

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

window.addEventListener("load", () => {
  userProfile = loadUserProfile();
  renderProfileForm();
  setParuruState("normal");
  if (buildVersion) {
    buildVersion.textContent = `PALURU Mini ${APP_VERSION} / Build ${BUILD_VERSION}`;
  }
  splash?.classList.add("is-hidden");
  loadNotificationCandidates({ force: true });
});

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
  categoryExplicitlySelected = categoryInput.value !== "未分類";
});

priorityInputs.forEach((input) => {
  input.addEventListener("click", () => {
    priorityExplicitlySelected = true;
  });
  input.addEventListener("change", () => {
    priorityExplicitlySelected = true;
  });
});

memoInput.addEventListener("input", () => {
  if (activeView !== "home" || isSubmitting) {
    return;
  }

  setParuruSpeech(memoInput.value.trim() ? "typing" : "idle");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  const memo = memoInput.value.trim();
  if (!memo) {
    setParuruState("empty", { showStatus: true });
    memoInput.focus();
    return;
  }

  if (isLikelyHomeAgentQuery(memo)) {
    await submitHomeAgentQuery(memo);
    return;
  }

  const payload = buildCreateWithAIPayload(memo);

  setSending(true);
  setParuruState("sending");
  showMessage(PARURU_STATES.sending.line, "");

  try {
    const result = await saveMemo(payload);
    form.reset();
    categoryInput.value = "未分類";
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
});

navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.targetView));
});

refreshInboxButton.addEventListener("click", loadInbox);

inboxList.addEventListener("click", (event) => {
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

  await updateInboxItem(id, {
    title: editTitle.value.trim() || memo.slice(0, 20),
    memo,
    category: editCategory.value,
    priority: editPriority.value,
  });

  detailDialog.close();
  await loadInbox({ quiet: true });
  setParuruState("success", { showStatus: true });
});

doneButton.addEventListener("click", async () => {
  const id = editId.value;
  await updateInboxItem(id, { status: "Done" });
  detailDialog.close();
  await loadInbox({ quiet: true });
  await loadNotificationCandidates({ force: true });
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
  openNotificationDetail(item.dataset.notificationId);
});
todayParuruAllButton.addEventListener("click", () => switchView("inbox"));
homeAgentRetryButton.addEventListener("click", () => {
  if (lastHomeAgentMessage) {
    submitHomeAgentQuery(lastHomeAgentMessage);
  }
});
homeAgentCloseButton.addEventListener("click", hideHomeAgentCard);
homeAgentCard.addEventListener("click", (event) => {
  const signageButton = event.target.closest("[data-home-agent-signage]");
  if (signageButton) {
    renderSignageConfirmation(signageButton.dataset.homeAgentSignage || "");
    return;
  }

  if (event.target.closest("[data-home-agent-confirm-close]")) {
    hideSignageConfirmation();
  }
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  userProfile = saveUserProfileFromForm();
  renderProfileForm();
  showMessage(PARURU_MESSAGES.action.profileSaved, "success");
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`)?.close();
  });
});

async function switchView(viewName) {
  activeView = viewName;
  views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.targetView === viewName));
  showMessage("", "");

  if (viewName === "inbox") {
    await loadInbox();
    return;
  }

  if (viewName === "home") {
    await loadNotificationCandidates();
  }

  if (viewName === "settings") {
    renderProfileForm();
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
  }
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

function buildHomeAgentPayload(messageText) {
  const profile = getCurrentProfile();
  return {
    action: "homeAgent",
    message: messageText,
    userId: profile.userId,
    userDisplayName: profile.displayName,
    calendarSuffix: profile.calendarSuffix,
    deviceId: profile.deviceId,
    conversationId: "",
  };
}

async function submitHomeAgentQuery(messageText) {
  const payload = buildHomeAgentPayload(messageText);
  lastHomeAgentMessage = messageText;
  setSending(true, PARURU_MESSAGES.action.homeAgentLoading);
  setParuruSpeech("idle", "ちょっと家の中、見てくる。");
  renderHomeAgentLoading();

  try {
    const response = await callHomeAgent(payload);
    const result = normalizeHomeAgentResult(response);
    memoInput.value = "";
    renderHomeAgentResult(result);
    setParuruSpeech("idle", getHomeAgentSpeech(result));
    resetParuruSpeechSoon();
    revealPanelIfNeeded(homeAgentCard);
  } catch (error) {
    renderHomeAgentError();
    setParuruState("error");
    showMessage(PARURU_MESSAGES.action.homeAgentError, "error");
    revealPanelIfNeeded(homeAgentCard);
  } finally {
    setSending(false);
  }
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

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("action", "list");
  const response = await fetch(url.toString());
  const result = await parseApiResponse(response);
  return sortInboxItemsNewestFirst((result.data || []).filter(isInboxItem));
}

async function loadNotificationCandidates(options = {}) {
  const now = Date.now();
  if (!options.force && notificationCandidatesState.inFlight) {
    return notificationCandidatesState.inFlight;
  }

  if (!options.force && now - notificationCandidatesState.lastFetchedAt < NOTIFICATION_CACHE_MS) {
    renderNotificationCandidates(notificationCandidatesState.items, notificationCandidatesState.totalCount);
    return notificationCandidatesState.items;
  }

  renderNotificationLoading();
  notificationCandidatesState.inFlight = fetchNotificationCandidates()
    .then((result) => {
      const items = result.items || [];
      notificationCandidatesState = {
        lastFetchedAt: Date.now(),
        inFlight: null,
        items,
        totalCount: result.count || items.length,
      };
      renderNotificationCandidates(items, notificationCandidatesState.totalCount);
      return items;
    })
    .catch((error) => {
      debugLog("[Paruru] notification candidates failed", error?.message || error);
      notificationCandidatesState.inFlight = null;
      renderNotificationError();
      return [];
    });

  return notificationCandidatesState.inFlight;
}

async function fetchNotificationCandidates() {
  const profile = getCurrentProfile();
  if (!GAS_WEB_APP_URL) {
    return dummyNotificationCandidates(profile.userId);
  }

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("action", "notificationCandidates");
  url.searchParams.set("limit", "10");
  if (profile.userId) {
    url.searchParams.set("userId", profile.userId);
  }

  const response = await fetch(url.toString(), { cache: "no-store" });
  return parseApiResponse(response);
}

async function updateInboxItem(id, updates) {
  if (!GAS_WEB_APP_URL) {
    return dummyUpdate(id, updates);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ action: "update", id, ...updates }),
  });

  return parseApiResponse(response);
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
    body: JSON.stringify({ action: "answerFollowup", ...payload }),
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
    body: JSON.stringify({ action: "syncCalendar", ...payload }),
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
    body: JSON.stringify({ action: "updateCalendar", ...payload }),
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
    body: JSON.stringify({ action: "delete", id }),
  });

  return parseApiResponse(response);
}

async function parseApiResponse(response, options = {}) {
  const debugLabel = options.debugLabel || "";
  if (debugLabel) {
    debugLog(`[Paruru] ${debugLabel} HTTP status`, response.status);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const result = await response.json();
  if (debugLabel) {
    debugLog(`[Paruru] ${debugLabel} parsed response`, sanitizeApiResponseForLog(result));
  }

  if (!result.success) {
    throw new Error(result.message || "API failed");
  }

  return result;
}

function renderInboxLoading() {
  inboxList.innerHTML = `<div class="empty-state">読み込み中...</div>`;
}

function renderInboxError() {
  inboxList.innerHTML = `<div class="empty-state">Inboxを読めなかった。</div>`;
}

function renderNotificationLoading() {
  setNotificationViewState("loading");
  todayParuru.classList.remove("is-hidden");
  todayParuruLine.textContent = PARURU_MESSAGES.notification.loadingLine;
  todayParuruLine.classList.remove("is-hidden");
  todayParuruList.innerHTML = `<p class="today-paruru-empty">${escapeHtml(PARURU_MESSAGES.notification.loadingBody)}</p>`;
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
      <p>${escapeHtml(PARURU_MESSAGES.notification.error)}</p>
      <button class="secondary-button" type="button" data-notification-refresh>もう一回</button>
    </div>
  `;
  todayParuruAllButton.classList.add("is-hidden");
}

function renderNotificationCandidates(items, totalCount) {
  const visibleItems = items.slice(0, NOTIFICATION_DISPLAY_LIMIT);
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
  todayParuruLine.textContent = PARURU_MESSAGES.notification.loadedLine;
  todayParuruLine.classList.remove("is-hidden");
  todayParuruList.innerHTML = visibleItems.map(renderNotificationItem).join("") + renderNotificationMore(totalCount, visibleItems.length);
  todayParuruAllButton.classList.remove("is-hidden");
}

function setNotificationViewState(stateName) {
  todayParuru.dataset.state = stateName;
}

function buildNotificationSummarySpeech(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (safeCount <= 1) {
    return PARURU_MESSAGES.speech.notificationOne;
  }
  return PARURU_MESSAGES.speech.notificationMany(safeCount);
}

function renderNotificationItem(item) {
  const level = normalizeNotificationLevel(item.notificationLevel);
  const labels = (item.reasons || []).slice(0, 2).map(renderNotificationReasonLabel).join("");
  return `
    <button class="today-paruru-item today-paruru-${escapeHtml(level)}" type="button" data-notification-id="${escapeHtml(item.id)}">
      <span class="today-paruru-badges">
        ${renderNotificationLevelBadge(level)}
        ${labels}
      </span>
      <span class="today-paruru-message">${escapeHtml(item.message || item.title || PARURU_MESSAGES.notification.fallback)}</span>
    </button>
  `;
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
    due_today: "今日締切",
    due_tomorrow: "明日締切",
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
    const dueText = formatDateTimeLabel(item.dueDate, item.dueTime);
    const status = statusLabel ? `<span class="date-status date-status-${escapeHtml(statusLabel.key)}">${escapeHtml(statusLabel.label)}</span>` : "";
    return `<p class="card-schedule">${status}<span>締切: ${escapeHtml(dueText)}</span></p>`;
  }

  if (type === "event" && item.eventStart) {
    const startText = formatDateTimeLabel(item.eventStart, item.eventStartTime);
    const endText = item.eventEnd ? ` - ${formatDateTimeLabel(item.eventEnd, item.eventEndTime)}` : "";
    return `<p class="card-schedule"><span>予定: ${escapeHtml(startText + endText)}</span></p>`;
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
  return String(item.status || "Inbox").toLowerCase() === "inbox";
}

function normalizeType(type) {
  const normalized = String(type || "note").trim().toLowerCase();
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
  renderDetailCalendarStatus(item);
  renderFollowupPanel("detail", item);
  renderCalendarSyncPanel("detail", item);
  detailDialog.showModal();
}

function setSending(isSending, label = "ぱるるが整理中…") {
  isSubmitting = isSending;
  submitButton.disabled = isSending;
  submitButton.textContent = isSending ? label : "ぱるるに預ける";
}

function setParuruState(stateName, options = {}) {
  const state = PARURU_STATES[stateName] || PARURU_STATES.normal;
  paruruImage.src = state.image;
  setParuruSpeech(state.speech, state.line);

  if (options.showStatus) {
    showMessage(state.line, state.messageType || "");
  }
}

function setParuruSpeech(stateName = "idle", customLine = "") {
  const line = customLine || PARURU_MESSAGES.speech[stateName] || PARURU_MESSAGES.speech.idle;
  paruruLine.textContent = line;
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
  showMessage(line, type || "");
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

function normalizeHomeAgentResult(response) {
  const result = response?.result || response?.data || response?.item || {};
  return {
    ...result,
    actionCandidates: result.actionCandidates || response?.actionCandidates || [],
    warnings: result.warnings || response?.warnings || [],
    signageMessage: result.signageMessage || response?.signageMessage || "",
  };
}

function renderHomeAgentLoading() {
  homeAgentCard.classList.remove("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "true");
  homeAgentRetryButton.classList.add("is-hidden");
  homeAgentContent.innerHTML = `<p class="home-agent-empty">家の中を確認中...</p>`;
}

function renderHomeAgentError() {
  homeAgentCard.classList.remove("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "false");
  homeAgentRetryButton.classList.remove("is-hidden");
  homeAgentContent.innerHTML = `<p class="home-agent-error">${escapeHtml(PARURU_MESSAGES.action.homeAgentError)}</p>`;
}

function hideHomeAgentCard() {
  homeAgentCard.classList.add("is-hidden");
  homeAgentCard.setAttribute("aria-busy", "false");
  homeAgentContent.innerHTML = "";
  homeAgentRetryButton.classList.add("is-hidden");
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
    renderHomeAgentListSection("持ち物", result.suggestedItems),
    renderHomeAgentWarnings(result.warnings),
    renderHomeAgentActions(result),
  ].filter(Boolean);

  homeAgentContent.innerHTML = sections.length > 0
    ? sections.join("")
    : `<p class="home-agent-empty">見られる情報はなかったよ。</p>`;
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

function renderHomeAgentWarnings(warnings) {
  const items = normalizeHomeAgentList(warnings);
  if (items.length === 0) {
    return "";
  }

  return `<p class="home-agent-warning">一部データを取得できませんでした。</p>`;
}

function renderHomeAgentActions(result) {
  const candidate = findSignageActionCandidate(result.actionCandidates);
  if (!candidate) {
    return "";
  }

  const messageText = getSignageMessage(result, candidate);
  return `
    <div class="home-agent-actions">
      <button type="button" data-home-agent-signage="${escapeHtml(messageText)}">サイネージで知らせる</button>
    </div>
  `;
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

function findSignageActionCandidate(candidates) {
  if (!Array.isArray(candidates)) {
    return null;
  }
  return candidates.find((candidate) => {
    if (typeof candidate === "string") {
      return candidate === "createSignageAlert";
    }
    return candidate?.type === "createSignageAlert"
      || candidate?.action === "createSignageAlert"
      || candidate?.skill === "createSignageAlert";
  }) || null;
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

function hideSignageConfirmation() {
  homeAgentContent.querySelector("[data-home-agent-confirm]")?.remove();
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
    clearFollowupInputs(state);
    hideFollowupPanel(target);
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
  clearFollowupInputs(state);
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
    clearFollowupInputs(state);
    hideFollowupPanel(target);
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
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return "";
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
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

  return userProfile;
}

function loadUserProfile() {
  const stored = readStoredProfile();
  const profile = {
    ...DEFAULT_PROFILE,
    ...stored,
    deviceId: stored.deviceId || createDeviceId(),
  };
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

function renderProfileForm() {
  const profile = getCurrentProfile();
  profileUserId.value = profile.userId || DEFAULT_PROFILE.userId;
  profileDisplayName.value = profile.displayName || DEFAULT_PROFILE.displayName;
  profileCalendarSuffix.value = profile.calendarSuffix || "";
  profileDefaultCalendar.value = profile.defaultCalendar || DEFAULT_PROFILE.defaultCalendar;
  profileDeviceId.value = profile.deviceId || "";
}

function saveUserProfileFromForm() {
  const current = getCurrentProfile();
  const profile = {
    userId: normalizeUserId(profileUserId.value) || DEFAULT_PROFILE.userId,
    displayName: profileDisplayName.value.trim() || DEFAULT_PROFILE.displayName,
    calendarSuffix: profileCalendarSuffix.value.trim(),
    defaultCalendar: normalizeCalendarTarget(profileDefaultCalendar.value),
    deviceId: current.deviceId || createDeviceId(),
  };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function normalizeUserId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
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
  const dateParts = parseYmd(dateValue);
  if (!dateParts) {
    return [dateValue, timeValue].filter(Boolean).join(" ");
  }

  const today = getTodayTokyoParts();
  const includeYear = dateParts.year !== today.year;
  const dateLabel = includeYear
    ? `${dateParts.year}年${dateParts.month}月${dateParts.day}日`
    : `${dateParts.month}月${dateParts.day}日`;

  return [dateLabel, normalizeTimeLabel(timeValue)].filter(Boolean).join(" ");
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
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return String(value || "");
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
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
  const type = normalizeType(item.type);
  if (!isInboxItem(item) || type === "event" || type === "shopping") {
    return false;
  }

  return type === "task" ||
    type === "reminder" ||
    isFollowupNeeded(item) ||
    normalizePriority(item.priority) === "High" ||
    normalizePriority(item.priority) === "Urgent";
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
    dueDate: item.dueDate || "",
    dueTime: item.dueTime || "",
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
  const due = parseYmd(item.dueDate);
  if (due) {
    const diff = getDateOnlyEpochDay(due) - targetDay;
    if (diff < 0) {
      reasons.push("overdue");
    } else if (diff === 0) {
      reasons.push("due_today");
    } else if (diff === 1) {
      reasons.push("due_tomorrow");
    }
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
  const reasonOrder = ["overdue", "due_today", "urgent", "followup_required", "due_tomorrow", "high_priority"];
  const rankA = Math.min(...a.reasons.map((reason) => reasonOrder.indexOf(reason)).filter((rank) => rank >= 0));
  const rankB = Math.min(...b.reasons.map((reason) => reasonOrder.indexOf(reason)).filter((rank) => rank >= 0));
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const dueA = parseYmd(a.dueDate) ? getDateOnlyEpochDay(parseYmd(a.dueDate)) : Number.MAX_SAFE_INTEGER;
  const dueB = parseYmd(b.dueDate) ? getDateOnlyEpochDay(parseYmd(b.dueDate)) : Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) {
    return dueA - dueB;
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
  if (reasons.includes("overdue")) {
    return PARURU_MESSAGES.notificationMessage.overdue(title);
  }
  if (reasons.includes("due_today")) {
    return PARURU_MESSAGES.notificationMessage.due_today(title);
  }
  if (reasons.includes("urgent")) {
    return PARURU_MESSAGES.notificationMessage.urgent(title);
  }
  if (reasons.includes("followup_required")) {
    return PARURU_MESSAGES.notificationMessage.followup_required(title);
  }
  if (reasons.includes("due_tomorrow")) {
    return PARURU_MESSAGES.notificationMessage.due_tomorrow(title);
  }
  if (reasons.includes("high_priority")) {
    return PARURU_MESSAGES.notificationMessage.high_priority(title);
  }
  return PARURU_MESSAGES.notificationMessage.fallback(title);
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

    const updatedItem = { ...item, ...updates };
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

function dummyDelete(id) {
  saveDummyItems(loadDummyItems().filter((item) => item.id !== id));
  return Promise.resolve({ success: true, data: { id }, message: "deleted" });
}
