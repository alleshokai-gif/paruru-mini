#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const net = require("node:net");

const repoRoot = path.resolve(__dirname, "..");
const outputRelativePath = path.join("test", "fixtures", "home-menu-review.html");
const outputPath = path.join(repoRoot, outputRelativePath);

function readSource(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  return fs.readFileSync(sourcePath, "utf8");
}

function extractBetween(source, startMarker, endMarker, sourceName) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${sourceName}: start marker not found`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${sourceName}: end marker not found`);
  return source.slice(start, end).trimEnd();
}

function extractOne(source, pattern, sourceName) {
  const match = source.match(pattern);
  if (!match) throw new Error(`${sourceName}: expected markup not found`);
  return match[0];
}

function generateFixture({ report = true } = {}) {
  const indexHtml = readSource("index.html");
  const styleCss = readSource("style.css");
  const navigationConfig = readSource("features/navigation/config.js");
  const buildJs = readSource("build.js");

  // Read current CSS/navigation sources as a fail-closed check; the fixture
  // loads both directly from the repository instead of maintaining copies.
  if (!styleCss.trim()) throw new Error("style.css is empty");
  if (!navigationConfig.includes("PALURU_NAVIGATION_CONFIG")) {
    throw new Error("navigation config does not expose PALURU_NAVIGATION_CONFIG");
  }

  const buildMatch = buildJs.match(/globalThis\.BUILD_ID\s*=\s*["']([^"']+)["']/);
  if (!buildMatch) throw new Error("BUILD_ID not found in build.js");
  const buildId = buildMatch[1];
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  const sourceHeadMarkup = extractBetween(indexHtml, "<head>", "</head>", "index.html");
  const headContents = sourceHeadMarkup
    .replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n    <meta name="robots" content="noindex,nofollow">\n    <base href="../../">');
  const head = `<head>\n${headContents}\n  </head>`;
  if (!head.includes('<base href="../../">') || !head.includes("./style.css")) {
    throw new Error("Could not safely prepare the source document head");
  }

  const topbar = extractBetween(indexHtml, '<header class="app-topbar"', "</header>", "index.html") + "</header>";
  const homeStart = indexHtml.indexOf('<section id="homeView"');
  const homeEnd = indexHtml.indexOf('      <section id="inboxView"', homeStart);
  if (homeStart < 0 || homeEnd < 0) throw new Error("index.html: Home section boundary not found");
  const home = indexHtml.slice(homeStart, homeEnd).trimEnd();
  const bottomNav = extractBetween(indexHtml, '<nav class="bottom-nav"', "</nav>", "index.html") + "</nav>";
  const drawer = extractBetween(indexHtml, '<button id="drawerOverlay"', "</aside>", "index.html") + "</aside>";
  const buildScript = extractOne(indexHtml, /<script src="\.\/build\.js[^>]*><\/script>/, "index.html");
  const navigationScript = extractOne(indexHtml, /<script src="\.\/features\/navigation\/config\.js[^>]*><\/script>/, "index.html");

  const fixture = `<!doctype html>
<html lang="ja">
  ${head}
  <body class="is-authenticated">
    ${topbar}
    <main class="app-shell">
      ${home}
      <p id="message" class="message" role="status" aria-live="polite"></p>
    </main>
    ${bottomNav}
    ${drawer}
    ${buildScript}
    ${navigationScript}
    <script>
      (() => {
        // Fixture-only mock: authenticated state and display-only sample data.
        const todayLine = document.getElementById("todayParuruLine");
        const todayList = document.getElementById("todayParuruList");
        const speech = document.getElementById("paruruSpeech");
        todayLine.textContent = "今日見ることを、ここにまとめたよ。";
        speech.textContent = "ひと息ついてからで大丈夫やで。";
        const group = document.createElement("div");
        group.className = "today-paruru-group";
        const heading = document.createElement("p");
        heading.className = "today-paruru-group-title";
        heading.textContent = "表示確認用";
        const item = document.createElement("div");
        item.className = "today-paruru-item";
        const message = document.createElement("span");
        message.className = "today-paruru-message";
        message.textContent = "Human Review用のサンプル表示です（保存されません）";
        item.append(message);
        group.append(heading, item);
        todayList.replaceChildren(group);

        const toggle = document.getElementById("menuToggleButton");
        const drawer = document.getElementById("appDrawer");
        const overlay = document.getElementById("drawerOverlay");
        const close = document.getElementById("drawerCloseButton");
        function setOpen(open) {
          drawer.classList.toggle("is-open", open);
          drawer.setAttribute("aria-hidden", String(!open));
          drawer.inert = !open;
          toggle.setAttribute("aria-expanded", String(open));
          overlay.hidden = !open;
          document.body.classList.toggle("drawer-open", open);
          document.documentElement.classList.toggle("drawer-open", open);
          (open ? close : toggle).focus();
        }
        toggle.addEventListener("click", () => setOpen(true));
        close.addEventListener("click", () => setOpen(false));
        overlay.addEventListener("click", () => setOpen(false));
        document.addEventListener("keydown", event => {
          if (event.key === "Escape" && drawer.classList.contains("is-open")) setOpen(false);
        });
        document.addEventListener("click", event => {
          if (event.target.closest('[data-open-home-memo="true"]')) {
            setOpen(false);
            document.getElementById("homeMemoQuick").scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      })();
    </script>
  </body>
</html>
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, fixture, "utf8");

  const output = fs.readFileSync(outputPath, "utf8");
  if (!output.includes(buildId)) throw new Error("Generated fixture Build ID does not match build.js");
  if (output.includes("app.js") || /\bfetch\s*\(/.test(output)) {
    throw new Error("Generated fixture unexpectedly includes app runtime/network code");
  }

  const result = { sourceHead, buildId, outputPath, outputRelativePath };
  if (report) {
    process.stdout.write(`source HEAD: ${sourceHead}\nBUILD_ID: ${buildId}\noutput path: ${outputPath}\n`);
  }
  return result;
}

function startPreviewServer(port = 4173) {
  const python = process.platform === "win32" ? "python" : "python3";
  const choosePort = candidate => {
    const probe = net.createServer();
    probe.once("error", error => {
      if (error.code === "EADDRINUSE" && candidate < 65535) return choosePort(candidate + 1);
      process.stderr.write(`Could not reserve local preview port (${error.code || "listen error"}).\n`);
      process.exitCode = 1;
    });
    probe.listen(candidate, "127.0.0.1", () => {
      probe.close(() => {
        const server = spawn(python, ["-m", "http.server", String(candidate), "--bind", "127.0.0.1"], {
          cwd: repoRoot,
          stdio: "inherit",
          windowsHide: true,
        });
        server.on("error", error => {
          process.stderr.write(`Could not start local preview server (${error.code || "spawn error"}).\n`);
          process.exitCode = 1;
        });
        server.on("spawn", () => {
          process.stdout.write(`preview URL: http://127.0.0.1:${candidate}/${outputRelativePath.replaceAll(path.sep, "/")}\n`);
        });
      });
    });
  };
  choosePort(port);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== "--serve" && !arg.startsWith("--port="));
  if (unknown.length) {
    process.stderr.write(`Unknown option: ${unknown[0]}\nUsage: node scripts/build-home-menu-review-fixture.js [--serve] [--port=4173]\n`);
    process.exitCode = 2;
  } else {
    try {
      generateFixture();
      if (args.includes("--serve")) {
        const portOption = args.find(arg => arg.startsWith("--port="));
        const port = portOption ? Number(portOption.slice("--port=".length)) : 4173;
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535");
        startPreviewServer(port);
      }
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = { generateFixture };
