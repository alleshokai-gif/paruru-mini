const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxSyWgosHRhERKpBrzoMLpdG5_2xe0mtThCkQDtucHyCODj6xbK00Nb9nSVk8Fqdmd5Eg/exec";

const CHARACTER_BASE_PATH = "assets/character";
const PARURU_STATES = {
  loading: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_sleepy.png`,
    line: "……",
  },
  normal: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`,
    line: "……メモしとく？",
  },
  sending: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`,
    line: "ちょっと待って。",
  },
  success: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_smile.png`,
    line: "はいはい、僕が覚えとく。",
    messageType: "success",
  },
  empty: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`,
    line: "えぇ……何も書いてないけど？",
    messageType: "error",
  },
  error: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`,
    line: "送れなかった。あとでもう一回やって。",
    messageType: "error",
  },
  inboxEmpty: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_sleepy.png`,
    line: "今日はまだ何も預かってないよ。",
  },
  done: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_smile.png`,
    line: "えらいえらい。",
    messageType: "success",
  },
  deleteConfirm: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_angry.png`,
    line: "ほんまに消す？",
    messageType: "error",
  },
  deleted: {
    image: `${CHARACTER_BASE_PATH}/expressions/paruru_bust_normal.png`,
    line: "消しといたよ。",
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

const DUMMY_STORAGE_KEY = "paruru-mini-inbox";

let inboxItems = [];
let selectedItemId = "";
let activeView = "home";

const form = document.querySelector("#inboxForm");
const memoInput = document.querySelector("#memo");
const categoryInput = document.querySelector("#category");
const paruruImage = document.querySelector("#paruruImage");
const paruruLine = document.querySelector(".paruru-line");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const splash = document.querySelector("#splash");
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

setParuruState("loading");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // PWA registration failure should not block memo submission.
    });
  });
}

window.addEventListener("load", () => {
  setParuruState("normal");
  splash?.classList.add("is-hidden");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const memo = memoInput.value.trim();
  if (!memo) {
    setParuruState("empty", { showStatus: true });
    memoInput.focus();
    return;
  }

  const payload = {
    memo,
    category: categoryInput.value,
    priority: new FormData(form).get("priority") || "Normal",
    tags: "",
  };

  setSending(true);
  setParuruState("sending");
  showMessage("", "");

  try {
    await saveMemo(payload);
    form.reset();
    categoryInput.value = "未分類";
    setParuruState("success", { showStatus: true });
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
  setParuruState("deleted", { showStatus: true });
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

async function fetchInboxItems() {
  if (!GAS_WEB_APP_URL) {
    return loadDummyItems().filter((item) => item.status !== "Done");
  }

  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("action", "list");
  const response = await fetch(url.toString());
  const result = await parseApiResponse(response);
  return (result.data || []).filter((item) => item.status !== "Done");
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

async function parseApiResponse(response) {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const result = await response.json();
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

function renderInboxList(items) {
  if (items.length === 0) {
    inboxList.innerHTML = `<div class="empty-state">今日はまだ何も預かってないよ。</div>`;
    return;
  }

  inboxList.innerHTML = items.map((item) => `
    <article class="inbox-card" data-id="${escapeHtml(item.id)}">
      <div class="card-main">
        <h2>${escapeHtml(item.title || item.memo?.slice(0, 20) || "無題")}</h2>
        <time>${formatDate(item.createdAt)}</time>
      </div>
      <div class="card-meta">
        <span class="category-chip" style="--category-color: ${getCategoryColor(item.category)}">${escapeHtml(item.category || "未分類")}</span>
        <span class="priority-chip priority-${escapeHtml(item.priority || "Normal")}">${escapeHtml(item.priority || "Normal")}</span>
      </div>
    </article>
  `).join("");
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
  detailDialog.showModal();
}

function setSending(isSending) {
  submitButton.disabled = isSending;
  submitButton.textContent = isSending ? "預け中..." : "ぱるるに預ける";
}

function setParuruState(stateName, options = {}) {
  const state = PARURU_STATES[stateName] || PARURU_STATES.normal;
  paruruImage.src = state.image;
  paruruLine.textContent = state.line;

  if (options.showStatus) {
    showMessage(state.line, state.messageType || "");
  }
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.未分類;
}

function formatDate(value) {
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
  }).format(date);
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

function dummyCreate(payload) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  const item = {
    id,
    createdAt: new Date().toISOString(),
    title: payload.memo.slice(0, 20),
    memo: payload.memo,
    category: payload.category,
    status: "Inbox",
    priority: payload.priority || "Normal",
    source: "PWA",
    tags: payload.tags || "",
    aiComment: "",
  };
  saveDummyItems([item, ...loadDummyItems()]);
  return Promise.resolve({ success: true, data: { id }, message: "saved" });
}

function dummyUpdate(id, updates) {
  const items = loadDummyItems().map((item) => item.id === id ? { ...item, ...updates } : item);
  saveDummyItems(items);
  return Promise.resolve({ success: true, data: { id }, message: "updated" });
}

function dummyDelete(id) {
  saveDummyItems(loadDummyItems().filter((item) => item.id !== id));
  return Promise.resolve({ success: true, data: { id }, message: "deleted" });
}
