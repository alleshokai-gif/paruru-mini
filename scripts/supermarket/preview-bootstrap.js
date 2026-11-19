'use strict';
(() => {
  const items = [
    {item_id:'1'.repeat(32),name:'納豆',quantity:1,unit:'組',memo:'',status:'pending',revision:1,due_date:null,updated_at:'2026-11-19T07:00:00.000Z'},
    {item_id:'2'.repeat(32),name:'牛乳',quantity:1,unit:'本',memo:'',status:'pending',revision:1,due_date:null,updated_at:'2026-11-19T07:00:00.000Z'},
  ];
  document.dispatchEvent(new CustomEvent('paruru:authenticated',{detail:{shoppingApi: async ({action}) => {
    if (action !== 'list') throw new Error('ローカル試作は読取専用です。');
    const r = await fetch('/snapshot',{cache:'no-store',redirect:'error'});
    if (!r.ok) throw new Error('PREVIEW_UNAVAILABLE');
    return {items,supermarketPoc:await r.json()};
  }}}));
  document.getElementById('previewLock').addEventListener('click', () => document.dispatchEvent(new Event('kaz-os:locked')));
  document.dispatchEvent(new CustomEvent('shopping:opened',{detail:{waitUntil:p => void p}}));
})();
