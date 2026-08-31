'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');

assert(html.includes('id="familyInboxForm"'));
assert(html.includes('accept="image/jpeg,image/png,application/pdf"'));
assert(!/<input[^>]+id="familyInboxFile"[^>]+multiple/i.test(html), 'Family Inbox must accept one file only');
assert(html.includes('id="familyInboxSubjectMember"'));
assert(html.includes('value="youngest_daughter"'));
assert(html.includes('id="familyInboxNote" maxlength="500"'));
assert(app.includes('buildMemoCredentialPayload("familyInbox.submit")'));
assert(app.includes('buildMemoCredentialPayload("familyInbox.getStatus")'));
assert(app.includes('clientRequestId: familyInboxPendingClientRequestId'));
assert(app.includes('familyInboxPendingClientRequestId = ""'));
assert(app.includes('const FAMILY_INBOX_MAX_FILE_BYTES = 5 * 1024 * 1024'));
assert(app.includes('reader.readAsDataURL(file)'));
assert(!app.includes('FAMILY_INBOX_SERVICE_TOKEN'));
assert(!app.includes('FAMILY_INBOX_WEBAPP_URL'));
assert(!html.includes('FAMILY_INBOX_SERVICE_TOKEN'));
assert(css.includes('.family-inbox-form input') && css.includes('min-height: 48px') && css.includes('font-size: 16px'));
assert(build.includes('v20260831-nurse-okan-health-profile-v1'));
console.log('PASS Family Inbox one-file PWA input, member selector, Mini-only submit, mobile sizing, and build marker');
