// Current Masugata flyer only. Reviewed date/store conditions are bound to bytes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile),compact=s=>s.normalize('NFKC').replace(/\s/g,'');
export const YAOKO_SOURCE='https://yap-pd.yaoko-net.com/app/flyer/1221/';
export const YAOKO_STORE='https://www.yaoko-net.com/store/store07/221.html';
export const YAOKO_IMAGE='https://yap-pd.yaoko-net.com/assets/flyer/1210/flyer_C_0_1794796304.jpg';
export const YAOKO_HASH='30e07b4219d7672e964b57f8738ce33f2aa16dbabf037dd1945dd04327b16f0c';
export function identifyYaokoEdition(html,date) {
  if(date!=='2026-11-20'||!html.includes('川崎枡形店')||!html.includes(YAOKO_SOURCE)) {
    throw new Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  }
  return {source:YAOKO_SOURCE,image:YAOKO_IMAGE,from:date,until:date};
}
export function validateYaokoChicken(b) {
  const label=compact(b.label||''),unit=compact(b.unit||'');
  if(!label.includes('チキン')||!label.includes('ステーキ用')||!/^100g当(?:り|たり)$/.test(unit)) return null;
  const day=compact(b.day||''),dayAgain=compact(b.dayAgain||'');
  if(day!=='20'||dayAgain!==day)return null;
  const net=compact(b.net||''),again=compact(b.again||'');
  if(!/^[1-9]\d{1,4}$/.test(net)||net!==again)return null;
  const cents=s=>{
    const m=compact(s||'').match(/^(\d{1,6})\.(\d{2})$/);
    return m?+m[1]*100 + +m[2]:null;
  };
  const tax=cents(b.tax),taxAgain=cents(b.taxAgain);
  if(tax===null||tax!==taxAgain||tax!==+net*108)return null;
  return {title:'チキンステーキ用',spec:'精肉コーナー（産地は未確定）',unit:'100g',net_yen:+net,
    tax_included_sen:tax,conditions:'11/20（金）限り。掲載価格・在庫や産地は店頭確認',kind:'special'};
}
export async function extractYaokoFront(bytes,edition) {
  if(edition.source!==YAOKO_SOURCE||edition.image!==YAOKO_IMAGE)throw new Error('OCR_SOURCE_MISSING');
  if(createHash('sha256').update(bytes).digest('hex')!==YAOKO_HASH)throw new Error('OCR_EDITION_UNVERIFIED');
  const dir=await mkdtemp(join(tmpdir(),'paluru-yaoko-'));
  try {
    const input=join(dir,'front.jpg'),region=join(dir,'crop.png');await writeFile(input,bytes,{mode:0o600});
    const options={timeout:12000,maxBuffer:65536,windowsHide:true,env:{...process.env,
      MAGICK_THREAD_LIMIT:'1',MAGICK_MEMORY_LIMIT:'64MiB',MAGICK_MAP_LIMIT:'128MiB',MAGICK_DISK_LIMIT:'192MiB',OMP_THREAD_LIMIT:'1'}};
    if((await exec('identify',['-ping','-format','%w %h',input],options)).stdout.trim()!=='3898 2792')throw new Error('OCR_LAYOUT');
    const crop=async(box,{language='jpn_best',psm=6,negative=false,resize=false,digits=null}={})=>{
      const [x,y,w,h]=box;
      const args=[input,'-crop',`${w}x${h}+${x}+${y}`,'+repage','-grayscale','Rec601Luma'];
      if(negative)args.push('-negate','-threshold','47%');
      if(resize)args.push('-resize','300%');
      args.push('-bordercolor','white','-border',resize?'24':'20',region);await exec('convert',args,options);
      const a=[region,'stdout','-l',language,'--psm',String(psm)];if(digits)a.push('-c','tessedit_char_whitelist='+digits);
      return (await exec('tesseract',a,options)).stdout;
    };
    const b={label:await crop([942,1523,142,77]),unit:await crop([943,1596,111,26])};
    b.day=await crop([588,1425,140,99],{language:'eng',negative:true,digits:'0123456789',psm:6});
    b.dayAgain=await crop([588,1425,140,99],{language:'eng',negative:true,digits:'0123456789',psm:13});
    b.net=await crop([1089,1533,87,64],{language:'eng',digits:'0123456789',psm:6});
    b.again=await crop([1089,1533,87,64],{language:'eng',digits:'0123456789',psm:13});
    b.tax=await crop([1104,1597,74,22],{language:'eng',digits:'0123456789.',psm:7,resize:true});
    b.taxAgain=await crop([1104,1597,74,22],{language:'eng',digits:'0123456789.',psm:13,resize:true});
    if(process.env.PALURU_OCR_DEBUG==='1')process.stderr.write(JSON.stringify(b)+'\n');
    const offer=validateYaokoChicken(b);if(!offer)throw new Error('OCR_NO_VALID_OFFERS');
    return {from:edition.from,until:edition.until,offers:[offer]};
  } finally {await rm(dir,{recursive:true,force:true});}
}
