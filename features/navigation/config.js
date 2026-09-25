(function registerParuruNavigation(global) {
  "use strict";

  const infectionWatchUrl = new URL("https://kawasaki-infection-watch.pages.dev/");
  infectionWatchUrl.search = new URLSearchParams({
    disease: "influenza",
    ward: "宮前区",
    district: "宮前区:向丘地区",
  }).toString();

  const items = Object.freeze([
    { id: "home", label: "ホーム", icon: "⌂", view: "home", menu: true, section: "" },
    { id: "today", label: "今日の予定", note: "今日の予定・お知らせ", icon: "📅", view: "home", anchor: "todayParuru", capability: "home.read", home: true, menu: true, section: "毎日のこと" },
    { id: "inbox", label: "Inbox", note: "保存した項目", icon: "📥", view: "inbox", menu: true, section: "毎日のこと" },
    { id: "infection", label: "感染症ウォッチ", note: "川崎市の感染症情報", icon: "🦠", href: infectionWatchUrl.toString(), external: true, home: true, menu: true, section: "地域の情報" },
    { id: "bus", label: "バス", note: "バスの情報", icon: "🚌", view: "bus", home: true, menu: true, section: "地域の情報" },
    { id: "nurse", label: "ナースおかん", note: "健康記録", icon: "🌿", view: "nurse-okan", menu: true, section: "暮らし" },
    { id: "popio", label: "ぽぴお", note: "ペットの健康", icon: "🐶", view: "popio-health", home: true, menu: true, section: "暮らし" },
    { id: "kaz-today", label: "今日の仕事", note: "仕事の予定・やること", icon: "📅", view: "kaz-os", page: "today", menu: true, section: "やること・確認" },
    { id: "kaz-work", label: "やること", note: "全体のタスク一覧", icon: "✓", view: "kaz-os", page: "work", menu: true, section: "やること・確認" },
    { id: "kaz-projects", label: "プロジェクト", note: "進行中の取り組み", icon: "▦", view: "kaz-os", page: "projects", menu: true, section: "やること・確認" },
    { id: "kaz-questions", label: "確認・質問", note: "質問・確認事項", icon: "💬", view: "kaz-os", page: "inbox", menu: true, section: "やること・確認" },
    { id: "memo", label: "ぱるるメモ", note: "思いついたことを残す", icon: "📝", view: "home", capability: "memo.self.create", openMemo: true, menu: true, section: "その他" },
    { id: "settings", label: "設定", icon: "⚙️", view: "settings", menu: true, section: "その他" },
  ]);

  function makeButton(item, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.navigationId = item.id;
    button.dataset.targetView = item.view;
    if (item.capability) button.dataset.requiredCapability = item.capability;
    if (item.anchor) button.dataset.homeAnchor = item.anchor;
    if (item.openMemo) {
      button.dataset.openHomeMemo = "true";
      button.setAttribute("aria-controls", "homeMemoDetails");
    }
    if (item.page) {
      button.dataset.kazPage = item.page;
      button.dataset.kazPageLaunch = "true";
      button.setAttribute("aria-label", `${item.label}を開く`);
    }
    const icon = document.createElement("span");
    icon.className = "navigation-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.className = "navigation-item-label";
    label.textContent = item.label;
    button.append(icon, label);
    if (item.note && className === "home-feature-item") {
      const note = document.createElement("span");
      note.className = "navigation-item-note";
      note.textContent = item.note;
      button.append(note);
    }
    return button;
  }

  function renderMenu() {
    const launcher = document.getElementById("homeFeatureLauncher");
    const menu = document.getElementById("drawerFeatureMenu");
    if (!launcher || !menu) return;

    items.filter(item => item.home).forEach(item => {
      if (item.external) {
        const link = document.createElement("a");
        link.className = "home-feature-item is-external";
        link.dataset.navigationId = item.id;
        link.dataset.visibilityView = "home";
        link.href = item.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${item.label}。外部サイトを開く`);
        const icon = document.createElement("span");
        icon.className = "navigation-item-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = item.icon;
        const label = document.createElement("span");
        label.className = "navigation-item-label";
        label.textContent = item.label;
        const note = document.createElement("span");
        note.className = "navigation-item-note";
        note.textContent = item.note;
        link.append(icon, label, note);
        launcher.append(link);
      } else {
        const button = makeButton(item, "home-feature-item");
        button.addEventListener("click", () => {
          document.dispatchEvent(new CustomEvent("paruru:view-request", {
            detail: { viewName: item.view, anchorId: item.anchor || "", openMemo: Boolean(item.openMemo), navigationId: item.id },
          }));
        });
        launcher.append(button);
      }
    });

    let currentSection = null;
    let sectionNav = null;
    items.filter(item => item.menu).forEach(item => {
      if (item.section !== currentSection) {
        currentSection = item.section;
        if (currentSection) {
          const heading = document.createElement("h2");
          heading.className = "drawer-menu-section-title";
          heading.textContent = currentSection;
          menu.append(heading);
        }
        sectionNav = document.createElement("div");
        sectionNav.className = "drawer-menu-section";
        menu.append(sectionNav);
      }
      if (item.external) {
        const link = document.createElement("a");
        link.className = "drawer-menu-item is-external";
        link.dataset.navigationId = item.id;
        link.dataset.visibilityView = "home";
        link.href = item.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${item.label}。外部サイトを開く`);
        const icon = document.createElement("span");
        icon.className = "navigation-item-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = item.icon;
        const label = document.createElement("span");
        label.className = "navigation-item-label";
        label.textContent = item.label;
        link.append(icon, label);
        sectionNav.append(link);
      } else {
        sectionNav.append(makeButton(item, "drawer-menu-item"));
      }
    });
  }

  global.PALURU_NAVIGATION_CONFIG = items;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderMenu, { once: true });
  else renderMenu();
})(globalThis);
