// A fail-closed template for the current officially published Mizonokuchi edition.
// The price is read, never supplied by a fixture. A different edition needs a new
// independently verified template; the collector reports needs_review meanwhile.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
const compact=s=>s.normalize('NFKC').replace(/\s/g,'');
export const IY_SOURCE='https://promo.hatobase.jp/flyers/00521/1298/50089';
export const IY_IMAGE='https://content.hatobase.jp/flyer_details/2400/main_image_18e5731c-ccac-4724-885c-35a0bfa801ad.IY1118c_A_500-1.jpg.progressive.jpeg';

export function identifyIyEdition(html,date) {
  if (!date.startsWith('2026-11-') ||
      !html.includes('<title>イトーヨーカドー 溝ノ口店</title>') ||
      !html.includes('content="'+IY_SOURCE+'"') ||
      !/11\/18\(水\)[〜～~]11\/22\(日\)/.test(html) ||
      !html.includes('href="'+IY_IMAGE+'"')) throw new Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  // Normal SSR flyer route only. Do not crawl the separate nofollow /images page.
  const robots=html.match(/<meta\b[^>]*name="robots"[^>]*content="([^"]*)"/i)?.[1]||'';
  if (/nofollow|none/i.test(robots)) throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
  return {source:IY_SOURCE,image:IY_IMAGE,from:'2026-11-18',until:'2026-11-20'};
}

export function validateIySalmon(bits) {
  const label=compact(bits.label||''), unit=compact(bits.unit||''), half=compact(bits.half||'');
  // 魚 is the observed OCR substitution for 鮭 in this visually checked card.
  // It is accepted only with the other independent product and specification anchors.
  if (!/塩銀[鮭魚]/.test(label)||!label.includes('養殖')||!label.includes('甘口')||
      !half.includes('半身')||unit!=='1パック') return null;
  const days=compact(bits.days||'');
  if (!/18.*19.*20/.test(days)) return null;
  const number=s=>compact(s||'').replace(/,/g,'');
  const net=number(bits.net),again=number(bits.again);
  if (!/^[1-9]\d{1,4}$/.test(net)||net!==again) return null;
  const tax=compact(bits.tax||'').replace(/,/g,'').match(/^(\d{2,6})[)）]?$/)?.[1];
  if (!tax||+tax*100!==+net*108) return null;
  return {title:'塩銀鮭',spec:'養殖・甘口・半身',unit:'1パック',net_yen:+net,
    tax_included_sen:+tax*100,conditions:'11/18〜20限定。取扱除外店に溝ノ口店の記載なし',kind:'special'};
}

export async function extractIyFront(bytes,edition) {
  if (edition.source!==IY_SOURCE||edition.image!==IY_IMAGE) throw new Error('OCR_SOURCE_MISSING');
  // The original was independently checked for store exclusions and item dates.
  // Bind those reviewed conditions to its exact bytes, including silent edits
  // at the same URL. This template does not grant trust to a future edition.
  if(createHash('sha256').update(bytes).digest('hex')!==
      '9997e290ce2a1578ac0e1f0216b85ae456a5046ed3eb2e53ca68a7fd69f54fb9') throw new Error('OCR_EDITION_UNVERIFIED');
  const directory=await mkdtemp(join(tmpdir(),'paluru-iy-'));
  try {
    const input=join(directory,'front.jpg'),region=join(directory,'region.png');
    await writeFile(input,bytes,{mode:0o600});
    const env={...process.env,MAGICK_MEMORY_LIMIT:'64MiB',MAGICK_MAP_LIMIT:'128MiB',
      MAGICK_DISK_LIMIT:'768MiB',MAGICK_THREAD_LIMIT:'1',OMP_THREAD_LIMIT:'1'};
    const options={env,timeout:12000,maxBuffer:65536,windowsHide:true};
    const size=(await exec('identify',['-ping','-format','%w %h',input],options)).stdout.trim();
    if (size!=='7510 5374') throw new Error('OCR_LAYOUT');
    const crop=async (box,{negative=false,psm=6,language='jpn_best',digits=false}={})=>{
      const [x,y,w,h]=box;
      const args=[input,'-crop',`${w}x${h}+${x}+${y}`,'+repage','-grayscale','Rec601Luma'];
      if (negative) args.push('-negate','-threshold','59%');
      args.push('-bordercolor','white','-border','20',region);
      await exec('convert',args,options);
      const tess=[region,'stdout','-l',language,'--psm',String(psm)];
      if(digits)tess.push('-c','tessedit_char_whitelist=0123456789,');
      return (await exec('tesseract',tess,options)).stdout;
    };
    const label=await crop([1270,2463,310,257]);
    const days=await crop([1270,2380,378,83]);
    const half=await crop([1580,2639,160,81]);
    const unit=await crop([1300,2993,180,84],{negative:true,psm:7});
    const net=await crop([1330,2740,615,225],{language:'eng',psm:6,digits:true});
    const again=await crop([1330,2740,615,225],{language:'eng',psm:7,digits:true});
    const tax=await crop([1580,2966,350,112],{language:'eng'});
    if (process.env.PALURU_OCR_DEBUG==='1') process.stderr.write(JSON.stringify({label,days,half,unit,net,again,tax})+'\n');
    const offer=validateIySalmon({label,days,half,unit,net,again,tax});
    if (!offer) throw new Error('OCR_NO_VALID_OFFERS');
    return {from:edition.from,until:edition.until,offers:[offer]};
  } finally {await rm(directory,{recursive:true,force:true});}
}
