'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const switchStart = appSource.indexOf('async function switchView(viewName)');
const switchEnd = appSource.indexOf('async function loadInbox', switchStart);
assert(switchStart >= 0 && switchEnd > switchStart, 'switchView source not found');
const switchSource = appSource.slice(switchStart, switchEnd);

assert(switchSource.includes('resolvedView !== "kaz-os"'), 'Kaz OS exit guard missing');
assert(switchSource.includes('/^#kaz-os(?:\\\\/|$)/'), 'Kaz OS hash matcher missing');
assert(switchSource.includes('history?.replaceState?.'), 'Kaz OS hash is not cleared with replaceState');
assert(switchSource.includes('location?.pathname') && switchSource.includes('location?.search'), 'path/query preservation missing');
assert(!switchSource.includes('location.hash = ""'), 'hash clearing must not trigger hashchange');

const buildMatch = buildSource.match(/BUILD_ID = "([^"]+)"/);
assert(buildMatch, 'BUILD_ID missing');
const buildId = buildMatch[1];
assert(indexSource.includes(`./build.js?v=${buildId}`), 'index build.js cache key mismatch');
assert(indexSource.includes(`./app.js?v=${buildId}`), 'index app.js cache key mismatch');
assert(swSource.includes(`importScripts("./build.js?v=${buildId}")`), 'service worker build cache key mismatch');

console.log('PASS Kaz OS hash is cleared when leaving Kaz OS without hashchange redirect');
