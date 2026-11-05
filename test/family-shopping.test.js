'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root,'features/shopping/page.js'),'utf8');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
test('shopping screen and authenticated API are wired without a new login', () => {
  assert.match(html,/id="shoppingView".*data-view="shopping"/);
  assert.match(app,/shoppingApi: callAuthenticatedShopping_/);
  assert.match(app,/getAuthEnvelope\(false\)/);
  assert.match(app,/v2\/family\/shopping/);
  assert.match(app,/cache: "no-store"/);
  assert.match(source,/kaz-os:locked', clear/);
  assert.doesNotMatch(source,/innerHTML|localStorage|sessionStorage/);
});
test('invalid or foreign response never becomes an empty list', () => {
  const context = vm.createContext({});
  vm.runInContext(source,context);
  const valid = context.PALURUShopping.validItems;
  assert.equal(valid({items:[]}).length,0);
  assert.throws(()=>valid({items:[{item_id:'bad'}]}),/INVALID_RESPONSE/);
  assert.throws(()=>valid({error:{code:'FORBIDDEN'}}),/INVALID_RESPONSE/);
});
test('only active Home members can open shopping', () => {
  const c = vm.createContext({appAuthenticationState:'active_member',activeMembershipContext:{role:'guardian',allowedViews:['home']}});
  vm.runInContext(app.slice(app.indexOf('function isViewAllowed_('),app.indexOf('\nfunction getViewNavigationItems_')),c);
  for(const role of ['admin','guardian','self_record']){
    c.activeMembershipContext.role=role;assert.equal(c.isViewAllowed_('shopping'),true);
  }
  c.activeMembershipContext.role='viewer';assert.equal(c.isViewAllowed_('shopping'),false);
  c.activeMembershipContext.role='admin';c.appAuthenticationState='signed_out';assert.equal(c.isViewAllowed_('shopping'),false);
});
