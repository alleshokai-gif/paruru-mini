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
};

const form = document.querySelector("#inboxForm");
const memoInput = document.querySelector("#memo");
const categoryInput = document.querySelector("#category");
const paruruImage = document.querySelector("#paruruImage");
const paruruLine = document.querySelector(".paruru-line");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const splash = document.querySelector("#splash");

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
  } catch (error) {
    setParuruState("error", { showStatus: true });
  } finally {
    setSending(false);
  }
});

async function saveMemo(payload) {
  if (!GAS_WEB_APP_URL) {
    return dummySave(payload);
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || "Save failed");
  }

  return result;
}

function dummySave(payload) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  const data = {
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

  console.info("Paruru dummy save", data);
  return Promise.resolve({
    success: true,
    data: { id },
    message: "saved",
  });
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
