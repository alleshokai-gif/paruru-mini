// Legacy field validators; fixed SKU/crop extraction has been retired.
const compact = s => s.normalize('NFKC').replace(/\s/g,'');
const iso = t => new Date(t).toISOString().slice(0,10);
const match = (text, rule) => rule.test(compact(text));
const yyyyMm = /^https:\/\/ok-corporation\.jp\/archives\/\d{3}\/(20\d{2})(\d{2})\/[a-f0-9]+\.jpg$/;

export function datesFromOcr(edition, fromText, untilText) {
  const base = edition.image.match(yyyyMm);
  const short = (s) => compact(s).match(/^(\d{1,2})\/(\d{1,2})$/)?.slice(1).map(Number);
  const a = short(fromText), b = short(untilText);
  if (!base || !a || !b || +base[2] !== a[0] || edition.month !== a[0] || edition.startDay !== a[1]) return null;
  const year = +base[1];
  const t0 = Date.UTC(year,a[0]-1,a[1]);
  const t1 = Date.UTC(year + Number(b[0] < a[0]),b[0]-1,b[1]);
  const exact = (s,m,d) => s.slice(5) === [m,d].map(x => String(x).padStart(2,'0')).join('-');
  if (t1 < t0 || t1-t0 > 14*86400000 || !exact(iso(t0),...a) || !exact(iso(t1),...b)) return null;
  return {from:iso(t0),until:iso(t1)};
}

export function validateCard(card, o) {
  const net = compact(o.net ?? ''), confirmation = compact(o.again ?? '');
  const tax = compact(o.tax ?? '').split(/[.,]/)[0];
  if (!card.labelOk(o.label) || !match(o.unit, /100(?:g|9|中|e4t)/i) || !match(o.condition,/非会員[・･:：]?カード払(?:価格)?/)) return null;
  if (!/^[1-9]\d{1,3}$/.test(net) || net !== confirmation) return null;
  const cents = +net * 108;
  if (!/^\d{2,5}$/.test(tax) || +tax !== Math.floor(cents / 100)) return null;
  return {title:card.title,spec:card.spec,unit:'100g',net_yen:+net,tax_included_sen:cents,
    conditions:'非会員・カード払',kind:'weekly_information'};
}
