const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxSyWgosHRhERKpBrzoMLpdG5_2xe0mtThCkQDtucHyCODj6xbK00Nb9nSVk8Fqdmd5Eg/exec";

const form = document.querySelector("#inboxForm");
const memoInput = document.querySelector("#memo");
const categoryInput = document.querySelector("#category");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // PWA registration failure should not block memo submission.
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const memo = memoInput.value.trim();
  if (!memo) {
    showMessage("……空っぽじゃ覚えようがないんだけど。", "error");
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
  showMessage("", "");

  try {
    await saveMemo(payload);
    form.reset();
    categoryInput.value = "未分類";
    showMessage("はいはい。僕が覚えとく。", "success");
  } catch (error) {
    showMessage("送れなかった。あとでもう一回やって。", "error");
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

function showMessage(text, type) {
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
}
