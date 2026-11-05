(function(root) {
  'use strict';
  function validItems(result) {
    if (!Array.isArray(result?.items) || result.items.length > 1000 ||
      result.items.some(r => !r || !/^[a-f0-9]{32}$/.test(r.item_id) || typeof r.name !== 'string' ||
        !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999 ||
        typeof r.unit !== 'string' || typeof r.memo !== 'string' ||
        !['pending', 'purchased', 'cancelled'].includes(r.status) ||
        !Number.isInteger(r.revision) || r.revision < 1 ||
        !(r.due_date === null || /^\d{4}-\d{2}-\d{2}$/.test(r.due_date)) ||
        !Number.isFinite(Date.parse(r.updated_at)))) throw new Error('SHOPPING_INVALID_RESPONSE');
    return result.items;
  }
  root.PALURUShopping = Object.freeze({validItems});
  if (!root.document) return;
  const doc = root.document;
  const view = doc.getElementById('shoppingView');
  if (!view) return;
  const add = doc.getElementById('shoppingAdd');
  const status = doc.getElementById('shoppingStatus');
  const pending = doc.getElementById('shoppingPending');
  const history = doc.getElementById('shoppingHistory');
  const historyCount = doc.getElementById('shoppingHistoryCount');
  const reload = doc.getElementById('shoppingReload');
  const labels = {add: '追加したで。', quantity: '数量を変更したで。', purchase: '購入済みにしたで。', cancel: '取り消したで。'};
  const errors = {
    FORBIDDEN: 'この買い物リストを開く権限がありません。',
    SHOPPING_STALE: 'LINEか別の端末で更新されました。再読み込みしてから編集してください。',
    SHOPPING_INVALID: '商品名・数量・必要日を確認してください。',
    SHOPPING_WRITE_UNKNOWN: '更新結果を確認できませんでした。再読み込みして確かめてください。',
    SHOPPING_BUSY: '更新が重なりました。再読み込みしてから編集してください。',
    SHOPPING_CAPACITY: '保存上限に達しました。既存の商品・履歴は保持されています。'
  };
  let call = null, epoch = 0, busy = false, current = false;
  const el = (tag, text) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, fn) => {
    const b = el('button', label); b.type = 'button'; b.addEventListener('click', fn); return b;
  };
  function editable() {
    for (const input of view.querySelectorAll('input, button')) input.disabled = busy || (!current && input !== reload);
  }
  function row(item) {
    const block = el('article'); block.className = 'shopping-row';
    block.append(el('h3', item.name + ' ' + item.quantity + item.unit));
    if (item.due_date) block.append(el('p', '必要日：' + item.due_date));
    if (item.memo) block.append(el('p', item.memo));
    const ids = {item_id: item.item_id, revision: item.revision};
    const actions = el('div'); actions.className = 'shopping-actions';
    actions.append(button('購入済み', () => run({action: 'purchase', ...ids})),
      button('取消', () => run({action: 'cancel', ...ids})));
    const form = el('form'); form.className = 'shopping-fields';
    const q = el('input'); q.type = 'number'; q.min = '1'; q.max = '999'; q.step = '1'; q.required = true;
    q.value = item.quantity; q.inputMode = 'numeric';
    const unit = el('input'); unit.value = item.unit; unit.maxLength = 12;
    const qLabel = el('label', '数量'); qLabel.append(q);
    const unitLabel = el('label', '単位'); unitLabel.append(unit);
    const save = el('button', '数量を変更'); save.type = 'submit'; save.className = 'shopping-quantity-save';
    form.append(qLabel, unitLabel, save);
    form.addEventListener('submit', e => { e.preventDefault(); void run({action: 'quantity', ...ids, quantity: Number(q.value), unit: unit.value}); });
    block.append(actions, form);
    return block;
  }
  function render(items) {
    const open = items.filter(r => r.status === 'pending');
    const bought = items.filter(r => r.status === 'purchased').sort((a,b) => Date.parse(b.updated_at)-Date.parse(a.updated_at));
    pending.replaceChildren(...(open.length ? open.map(row) : [el('p', '未購入の商品はありません。')]));
    const list = el('ul');
    for (const item of bought) {
      const day = new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo'}).format(new Date(item.updated_at));
      list.append(el('li', item.name + ' ' + item.quantity + item.unit + '（' + day + '）'));
    }
    history.replaceChildren(bought.length ? list : el('p', '購入履歴はありません。'));
    historyCount.textContent = bought.length + '件';
  }
  async function run(operation) {
    if (busy || !call || (operation.action !== 'list' && !current)) return false;
    const at = epoch;
    busy = true; editable();
    status.textContent = operation.action === 'list' ? '読み込み中…' : '保存中…';
    try {
      const result = await call(operation, operation.action === 'list' ? undefined : root.crypto.randomUUID());
      if (at !== epoch) return false;
      render(validItems(result));
      current = true;
      status.textContent = result.duplicates ? '同じ商品は登録済みです。数量は変更していません。'
        : labels[operation.action] || '最新のリストです。';
      return true;
    } catch (error) {
      if (at !== epoch) return false;
      current = false;
      status.textContent = errors[error?.code || error?.message] || '結果を確認できませんでした。再読み込みしてください。';
      return false;
    } finally {
      if (at === epoch) { busy = false; editable(); }
    }
  }
  function clear() {
    epoch++; call = null; busy = false; current = false;
    pending.replaceChildren(); history.replaceChildren(); historyCount.textContent = ''; status.textContent = '';
    add.reset(); editable();
  }
  add.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(add);
    if (await run({action:'add', items:[{name: f.get('name'), quantity: Number(f.get('quantity')),
      unit: f.get('unit'), due_date: f.get('due_date') || null, memo: f.get('memo')}]})) add.reset();
  });
  reload.addEventListener('click', () => run({action:'list'}));
  doc.addEventListener('paruru:authenticated', e => { clear(); call = e.detail.shoppingApi || null; });
  doc.addEventListener('kaz-os:locked', clear);
  doc.addEventListener('shopping:opened', e => e.detail.waitUntil(run({action:'list'})));
  doc.addEventListener('visibilitychange', () => {
    if (!doc.hidden && view.classList.contains('is-active')) void run({action:'list'});
  });
  editable();
})(globalThis);
