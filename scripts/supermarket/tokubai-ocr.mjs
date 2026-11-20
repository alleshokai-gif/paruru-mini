// Two independently inspected, public print editions. No private/API endpoint.
// Original bytes stay temporary; only facts, provenance and hashes persist.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile),compact=s=>s.normalize('NFKC').replace(/\s/g,'');
export const TOKUBAI_EDITIONS=Object.freeze({
  maruetsu:Object.freeze({
    source:'https://tokubai.co.jp/3541/leaflets/108663201/print',store:'マルエツ 川崎坂戸店',
    image:'https://image.tokubai.co.jp/images/bargain_office_leaflets/o=true/9855746.jpg?1794794992',
    hash:'089c73f17125db62d55a4d5664d2e9151b538c9ff152d27a67180ac7741078ce',
    dimensions:'4000 2836',origin:[1355,1720],parser:'maruetsu-3541-20261120-pork-v1',
  }),
  life:Object.freeze({
    source:'https://tokubai.co.jp/224224/leaflets/108692763/print',store:'ライフ 溝口店',
    image:'https://image.tokubai.co.jp/images/bargain_office_leaflets/o=true/9859979.jpg?1794816523',
    hash:'12d826afd74e1a7117577b37a0b09a2c3e8c04de4b8ad4cf614340e839a11644',
    dimensions:'4000 2812',origin:[2019,1267],parser:'life-224224-20261120-pork-v1',
  }),
});
export const TOKUBAI_ROBOTS=['https://tokubai.co.jp/robots.txt','https://image.tokubai.co.jp/robots.txt'];
export function verifyTokubaiRobots(text) {
  // The real PALURU UA is distinct from the three explicitly denied agents.
  // Changed rules fail closed. Do not impersonate an allowed client.
  const policy=text.replace(/\r/g,'').split('\n').map(s=>s.split('#')[0].trim()).filter(Boolean).join('\n');
  if(policy!==['User-agent: ClaudeBot','Disallow: /','User-agent: anthropic-ai','Disallow: /',
    'User-agent: Claude-Web','Disallow: /','User-agent: *','Disallow: /2026/random_product',
    'User-agent: bingbot','Crawl-delay: 1'].join('\n'))throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
}
export function identifyTokubaiEdition(id,html,date) {
  const c=TOKUBAI_EDITIONS[id];
  const title=html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1]||'';
  const images=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]).filter(s=>/class="printable_leaflet_image"/.test(s));
  const robots=[...html.matchAll(/<meta\b[^>]*name="robots"[^>]*>/gi)].map(m=>m[0]);
  if(!c||date!=='2026-11-20'||!title.includes(c.store)||images.length!==1||
    images[0].match(/src="([^"]+)"/)?.[1]!==c.image||robots.some(s=>/nofollow|none/i.test(s))) {
    throw new Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  }
  return {source:c.source,image:c.image,from:date,until:date};
}
export function validateTokubaiOffer(id,b) {
  const s=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,compact(v||'')]));
  if(s.day!=='20'||s.dayAgain!==s.day||s.net!=='169'||s.again!==s.net)return null;
  if(!s.unit.includes('各100g当り'))return null;
  if(id==='maruetsu'&&s.label.includes('豚肉')&&s.cut.includes('かたまり')&&s.origin.includes('国産')&&
    s.tax==='183'&&s.taxAgain===s.tax) {
    return {title:'豚肉かたまり',spec:'国産・肩ロース／バラ',unit:'100g',net_yen:169,tax_included_sen:18300,
      conditions:'11/20（金）限り。各100g当り。掲載税込183円・取扱や在庫は店頭確認',kind:'special'};
  }
  if(id==='life'&&s.label.includes('豚')&&s.label.includes('こま')&&s.label.includes('切れ')&&
    s.origin.includes('北海道産')&&s.tax==='182'&&s.taxAgain===s.tax) {
    return {title:'あまに豚こま切れ',spec:'北海道産',unit:'100g',net_yen:169,tax_included_sen:18200,
      conditions:'11/20（金）限り。各100g当り。掲載税込182円・取扱や在庫は店頭確認',kind:'special'};
  }
  return null;
}
export async function extractTokubaiFront(id,bytes,edition) {
  const c=TOKUBAI_EDITIONS[id];
  if(!c||edition.source!==c.source||edition.image!==c.image)throw new Error('OCR_SOURCE_MISSING');
  if(createHash('sha256').update(bytes).digest('hex')!==c.hash)throw new Error('OCR_EDITION_UNVERIFIED');
  const dir=await mkdtemp(join(tmpdir(),'paluru-print-'));
  try {
    const input=join(dir,'front.jpg'),region=join(dir,'crop.png');await writeFile(input,bytes,{mode:0o600});
    const options={timeout:12000,maxBuffer:65536,windowsHide:true,env:{...process.env,
      MAGICK_THREAD_LIMIT:'1',MAGICK_MEMORY_LIMIT:'64MiB',MAGICK_MAP_LIMIT:'128MiB',MAGICK_DISK_LIMIT:'192MiB',OMP_THREAD_LIMIT:'1'}};
    if((await exec('identify',['-ping','-format','%w %h',input],options)).stdout.trim()!==c.dimensions)throw new Error('OCR_LAYOUT');
    const crop=async(box,{language='jpn_best',psm=7,negative=false,resize=3,threshold=null,digits=null,red=false,border=24}={})=>{
      const [x,y,right,bottom]=box;
      const args=[input,'-crop',`${right-x}x${bottom-y}+${c.origin[0]+x}+${c.origin[1]+y}`,'+repage'];
      if(red)args.push('-fx','r>0.5098&&g<0.5098&&b<0.5098&&r>g*1.5&&r>b*1.5?0:1');
      args.push('-grayscale','Rec601Luma','-depth','8');
      if(negative)args.push('-negate');
      if(resize!==1)args.push('-filter','Catrom','-resize',String(resize*100)+'%');
      if(threshold!==null)args.push('-threshold',String(threshold/255*100)+'%');
      args.push('-bordercolor','white','-border',String(border),region);await exec('convert',args,options);
      const a=[region,'stdout','-l',language,'--psm',String(psm)];if(digits)a.push('-c','tessedit_char_whitelist='+digits);
      return (await exec('tesseract',a,options)).stdout;
    };
    const num=(box,psm,extra={})=>crop(box,{language:'eng',digits:'0123456789',psm,...extra});
    const b={};
    if(id==='maruetsu') {
      b.label=await crop([29,276,82,302],{threshold:180,psm:6,border:30});
      b.cut=await crop([23,302,144,333]);
      b.origin=await crop([27,249,68,274],{negative:true,resize:4});
      b.unit=await crop([24,354,124,379],{negative:true});
      b.day=await num([56,29,139,100],6,{negative:true});b.dayAgain=await num([56,29,139,100],13,{negative:true});
      b.net=await num([202,287,320,351],6,{red:true});b.again=await num([202,287,320,351],13,{red:true});
      b.tax=await num([294,354,331,376],6);b.taxAgain=await num([294,354,331,376],13);
    } else {
      b.label=await crop([17,387,251,414]);b.origin=await crop([17,367,166,391]);
      b.unit=await crop([19,475,140,499],{resize:1});
      b.day=await num([78,110,134,157],6);b.dayAgain=await num([78,110,134,157],13);
      b.net=await num([255,424,345,473],6,{resize:4});b.again=await num([255,424,345,473],13,{resize:4});
      b.tax=await num([298,475,350,499],6,{resize:4});b.taxAgain=await num([298,475,350,499],7,{resize:4});
    }
    if(process.env.PALURU_OCR_DEBUG==='1')process.stderr.write(JSON.stringify({store:id,...b})+'\n');
    const offer=validateTokubaiOffer(id,b);if(!offer)throw new Error('OCR_NO_VALID_OFFERS');
    return {from:edition.from,until:edition.until,offers:[offer]};
  }finally{await rm(dir,{recursive:true,force:true});}
}
