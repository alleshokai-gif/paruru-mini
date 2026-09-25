"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { generateFixture } = require("../scripts/build-home-menu-review-fixture");

const root = path.resolve(__dirname, "..");

function homeMarkup(source, endMarker) {
  const startMarker = '<section id="homeView"';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, "Home section start exists");
  assert.notEqual(end, -1, "Home section end exists");
  return source.slice(start, end).trim();
}

test("Human Review fixture is generated from current Home DOM and current Build ID", () => {
  const result = generateFixture({ report: false });
  const fixture = fs.readFileSync(result.outputPath, "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const buildJs = fs.readFileSync(path.join(root, "build.js"), "utf8");
  const buildId = buildJs.match(/globalThis\.BUILD_ID\s*=\s*["']([^"']+)["']/)?.[1];

  assert.ok(buildId, "build.js declares a Build ID");
  assert.equal(result.buildId, buildId);
  assert.ok(fixture.includes(buildId), "fixture references the current Build ID");
  assert.equal(
    homeMarkup(fixture.replace(/\r\n/g, "\n"), '      <p id="message"'),
    homeMarkup(indexHtml.replace(/\r\n/g, "\n"), '      <section id="inboxView"'),
    "fixture Home markup stays sourced from current index.html",
  );
  assert.match(fixture, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(fixture, /<body class="is-authenticated">/);
  assert.doesNotMatch(fixture, /<script[^>]+app\.js|\bfetch\s*\(/);
});
