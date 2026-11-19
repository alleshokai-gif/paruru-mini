// Bounded template OCR of the publicly linked Kanto front image only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);
const options = {timeout:5000,maxBuffer:64*1024,windowsHide:true};
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

const cards = [
  {title:'若鶏むね肉',spec:'1枚入・2枚入', label:[788,143,147,39], unit:[803,201,50,23],
    condition:[882,226,77,13], net:[959,221,20,19], tax:[1006,225,16,12],
    labelOk:s => match(s,/(?:若|鶏).{0,6}(?:むね|おね)[肉内]/) && match(s,/1枚入[・･]2枚入/)},
  {title:'銀鮭切身',spec:'チリ産原料', label:[25,381,247,43], unit:[36,426,56,19],
    condition:[100,451,82,14], net:[182,446,34,18], tax:[233,448,19,16],
    labelOk:s => match(s,/銀鮭/) && match(s,/切身/) && match(s,/チリ産/)},
  {title:'ラムもも肉',spec:'ニュージーランド産 ステーキカット', label:[535,325,191,56], unit:[545,383,55,23],
    condition:[611,410,81,14], net:[691,404,37,21], tax:[745,409,19,13],
    labelOk:s => match(s,/ラムもも[肉内]/) && match(s,/ニュージーランド産/) && match(s,/ステーキカット/)},
];

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

export async function extractOkFront(bytes, edition) {
  const dir = await mkdtemp(join(tmpdir(),'paluru-supermarket-'));
  try {
    const input = join(dir,'front.jpg');
    const region = join(dir,'box.png');
    await writeFile(input,bytes,{mode:0o600});
    const im = {MAGICK_MEMORY_LIMIT:'96MiB',MAGICK_MAP_LIMIT:'192MiB',MAGICK_DISK_LIMIT:'192MiB',
      MAGICK_AREA_LIMIT:'20MP',MAGICK_THREAD_LIMIT:'1',...process.env};
    const sizes = (await exec('identify',['-ping','-format','%w %h',input],{...options,env:im})).stdout.trim().match(/^(\d+) (\d+)$/);
    if (!sizes || +sizes[1]*+sizes[2] > 20_000_000 || Math.abs(+sizes[1]/+sizes[2] - 5264/3693) > 0.005 ||
      +sizes[1] < 3000 || +sizes[2] < 2000) throw new Error('OCR_LAYOUT');
    const x = +sizes[1]/1316, y = +sizes[2]/923.25;
    const toCrop = ([l,t,w,h]) => `${Math.round(w*x)}x${Math.round(h*y)}+${Math.round(l*x)}+${Math.round(t*y)}`;
    const crop = async (box, variants = [['jpn+eng',7,null]]) => {
      await exec('convert',[input,'-crop',toCrop(box),'+repage','-colorspace','Gray','-threshold','58%',
        '-bordercolor','white','-border','12',region],{...options,env:im});
      const replies = [];
      for (const [lang,psm,alphabet] of variants) {
        const tess = [region,'stdout','-l',lang,'--psm',String(psm)];
        if (alphabet) tess.push('-c','tessedit_char_whitelist=' + alphabet);
        replies.push((await exec('tesseract',tess,{...options,env:{...process.env,OMP_THREAD_LIMIT:'1'}})).stdout);
      }
      return replies;
    };
    const [a] = await crop([449,78,34,18],[['jpn',7,null]]);
    const [b] = await crop([462,96,34,17],[['jpn',7,null]]);
    const dates = datesFromOcr(edition,a,b);
    if (!dates) throw new Error('OCR_DATE_UNVERIFIED');
    const offers = [];
    const digit = '0123456789';
    for (const card of cards) {
      const [label] = await crop(card.label,[['jpn+eng',6,null]]);
      const [unit] = await crop(card.unit);
      const [condition] = await crop(card.condition,[['jpn',7,null]]);
      const [net,again] = await crop(card.net,[['jpn',7,digit],['jpn',13,digit]]);
      const [tax] = await crop(card.tax,[['jpn+eng',13,null]]);
      const offer = validateCard(card,{label,unit,condition,net,again,tax});
      if (process.env.PALURU_OCR_DEBUG === '1') process.stderr.write(JSON.stringify({card:card.title,label,unit,condition,net,again,tax,accepted:!!offer})+'\n');
      if (offer) offers.push(offer);
    }
    if (!offers.length) throw new Error('OCR_NO_VALID_OFFERS');
    return {...dates,offers};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
