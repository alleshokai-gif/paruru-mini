// Private, offline whole-page evidence. No SKU list, promotion or network client.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const implementationSha=hash(await readFile(new URL(import.meta.url)));
export function tiles(width,height,size=1600,overlap=320) {
  if(![width,height,size,overlap].every(Number.isInteger)||width<1||height<1||size<2||overlap<0||overlap>=size)throw Error('TILE_DIMENSIONS');
  const starts=n=>{const out=[0];while(out.at(-1)+size<n)out.push(Math.min(out.at(-1)+size-overlap,n-size));return out;};
  return starts(height).flatMap(y=>starts(width).map(x=>({x,y,w:Math.min(size,width),h:Math.min(size,height)})));
}
export function parseTsv(tsv,pass,origin={x:0,y:0}) {
  const rows=tsv.trimEnd().split(/\r?\n/).slice(1),out=[];
  for(const row of rows){const a=row.split('\t');if(a.length<12||a[0]!=='5'||!a.slice(11).join('\t').trim())continue;
    const n=a.slice(6,11).map(Number);if(n.some(v=>!Number.isFinite(v))||n[2]<=0||n[3]<=0)continue;
    const scale=origin.render_scale??1;
    out.push({pass,line:a.slice(1,6).slice(0,4).join(':'),x:Math.round(n[0]/scale)+origin.x,y:Math.round(n[1]/scale)+origin.y,w:Math.max(1,Math.round(n[2]/scale)),h:Math.max(1,Math.round(n[3]/scale)),confidence:n[4],text:a.slice(11).join('\t')});
  }return out;
}
const norm=s=>s.normalize('NFKC').replace(/\s/g,'');
export function textBlocks(words){
  const blocks=new Map();for(const w of words){const id=w.pass+':'+w.line.split(':').slice(0,2).join(':');if(!blocks.has(id))blocks.set(id,[]);blocks.get(id).push(w);}
  return [...blocks.entries()].map(([id,items])=>{
    const lines=new Map();for(const w of items){if(!lines.has(w.line))lines.set(w.line,[]);lines.get(w.line).push(w);}
    const text=[...lines.values()].sort((a,b)=>a[0].y-b[0].y).map(line=>line.sort((a,b)=>a.x-b.x).map(w=>w.text).join('')).join('\n');
    const x=Math.min(...items.map(w=>w.x)),y=Math.min(...items.map(w=>w.y));
    const heights=items.map(w=>w.h).sort((a,b)=>a-b);
    return {id,pass:items[0].pass,text,bbox:{x,y,w:Math.max(...items.map(w=>w.x+w.w))-x,h:Math.max(...items.map(w=>w.y+w.h))-y},median_glyph_height:heights[Math.floor(heights.length/2)],minimum_ocr:Math.min(...items.map(w=>w.confidence))};
  });
}
const middle=t=>[t.x+t.w/2,t.y+t.h/2];
const near=(a,b)=>{const [x,y]=middle(a),[u,v]=middle(b);
  const intersection=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return intersection/Math.min(a.w*a.h,b.w*b.h)>=.55&&Math.abs(x-u)<=Math.max(a.w,b.w)*.6&&Math.abs(y-v)<=Math.max(a.h,b.h)*.35;};
// Numeric anchors are candidates, never silently treated as confirmed prices.
export function regionsFromWords(words,width,height) {
  const blocks=textBlocks(words);
  const groups=new Map();
  for(const t of words){const k=t.pass+':'+t.line;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t);}
  const anchors=[];
  for(const row of groups.values()){
    row.sort((a,b)=>a.x-b.x);
    // Join adjacent numeric fragments, but never an entire cross-column line.
    for(let i=0;i<row.length;i++){
      let t={...row[i],text:norm(row[i].text)};
      if(!/\d/.test(t.text))continue;
      while(i+1<row.length&&/^[\d,.円%％]+$/.test(t.text)&&/^[\d,.円%％]+$/.test(norm(row[i+1].text))&&row[i+1].x-(t.x+t.w)<Math.max(8,t.h*.4)){
        const q=row[++i];t.text+=norm(q.text);t.w=q.x+q.w-t.x;t.h=Math.max(t.h,q.h);t.confidence=Math.min(t.confidence,q.confidence);
      }
      const values=[...t.text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m=>m[0]);
      if(!values.length)continue;
      const context=row.filter(q=>Math.abs(q.x-t.x)<400).map(q=>q.text).join(' ');
      const kind=/\d\s*[%％]|割引|割引き/.test(t.text+context)?'discount_candidate':/[月日]|\d[/:]\d/.test(t.text)?'date_or_quantity_candidate':/円|税込|本体|税抜/.test(context)?'price_candidate':'numeric_candidate';
      anchors.push({...t,values,kind});
    }
  }
  const regions=[];
  for(const a of anchors){let r=regions.find(r=>near(r.anchor,a)&&!r.observations.some(o=>o.pass===a.pass));
    if(!r){r={anchor:a,observations:[]};regions.push(r);}r.observations.push(a);
  }
  return regions.map((r,index)=>{
    const a=r.anchor,cx=a.x+a.w/2,cy=a.y+a.h/2;
    // This is a search window, not a claim that the whole window is one SKU.
    const box={x:Math.max(0,Math.floor(cx-width*.2)),y:Math.max(0,Math.floor(cy-height*.1)),w:0,h:0};
    box.w=Math.min(width,Math.ceil(cx+width*.04))-box.x;box.h=Math.min(height,Math.ceil(cy+height*.04))-box.y;
    const context=words.filter(t=>t.x>=box.x&&t.x<box.x+box.w&&t.y>=box.y&&t.y<box.y+box.h);
    // Keep each read separate so neighbouring columns and date scopes are auditable.
    const reads=[...new Set(context.map(t=>t.pass))].map(pass=>({pass,text:context.filter(t=>t.pass===pass).sort((a,b)=>a.y-b.y||a.x-b.x).map(t=>t.text).join(' ')}));
    const text=reads.find(r=>r.pass==='full-psm11')?.text||reads[0]?.text||'';
    const names=blocks.filter(b=>b.bbox.x>=box.x&&b.bbox.x<box.x+box.w&&b.bbox.y>=box.y&&b.bbox.y<a.y&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(b.text)&&!/(?:税込|税抜|本体価格|会員現金払)/.test(norm(b.text)))
      .sort((b,c)=>Math.abs(a.y-b.bbox.y)-Math.abs(a.y-c.bbox.y)).slice(0,12);
    const contextualLines=new Map();
    for(const t of context){const k=t.pass+':'+t.line;if(!contextualLines.has(k))contextualLines.set(k,[]);contextualLines.get(k).push(t);}
    const labels=[...contextualLines.values()].map(line=>({pass:line[0].pass,text:line.sort((a,b)=>a.x-b.x).map(t=>t.text).join(' '),
      bbox:{x:Math.min(...line.map(t=>t.x)),y:Math.min(...line.map(t=>t.y)),w:Math.max(...line.map(t=>t.x+t.w))-Math.min(...line.map(t=>t.x)),h:Math.max(...line.map(t=>t.y+t.h))-Math.min(...line.map(t=>t.y))}}));
    const values=[...new Set(r.observations.map(o=>o.values.join('|')))];
    const agreement=Math.max(...values.map(value=>new Set(r.observations.filter(o=>o.values.join('|')===value).map(o=>o.pass)).size));
    return {id:index+1,bbox:box,anchor:{x:a.x,y:a.y,w:a.w,h:a.h},kind:a.kind,status:'needs_review',
      product_name:null,spec:null,unit:null,net_yen:null,tax_included_yen:null,member_condition:null,valid_from:null,valid_until:null,
      proposals:{name_candidates:names,label_lines:labels.filter(l=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(l.text)),numeric_strings:[...new Set(r.observations.flatMap(o=>o.values))],unit_text:text.match(/\d+(?:\.\d+)?\s*(?:kg|g|ml|mL|L|本|個|袋|パック|枚)/g)||[],
        tax_text:text.match(/(?:税込|本体|税抜)[^\s]{0,12}/g)||[],member_text:text.match(/[^\s]*(?:会員|カード|ポイント)[^\s]*/g)||[],date_text:text.match(/\d+\s*[月日][^\s]{0,12}/g)||[]},
      confidence:{minimum_ocr:Math.min(...r.observations.map(o=>o.confidence)),observed_passes:new Set(r.observations.map(o=>o.pass)).size,agreeing_passes:agreement,semantic_verified:false},
      review_reasons:['PRODUCT_BOUNDARY_UNVERIFIED','LABEL_PRICE_ASSOCIATION_UNVERIFIED','ITEM_DATE_SCOPE_UNVERIFIED','TAX_UNIT_MEMBER_SCOPE_UNVERIFIED',...(values.length>1?['NUMERIC_READ_DISAGREEMENT']:[])],reads,observations:r.observations};
  });
}
export async function extractPage(input,{run=exec,prior=null}={}) {
  const started=Date.now();
  const work=await mkdtemp(join(tmpdir(),'paluru-whole-'));
  const options={timeout:90000,maxBuffer:12*1024*1024,windowsHide:true,env:{PATH:process.env.PATH,LANG:'C.UTF-8',OMP_THREAD_LIMIT:'1',MAGICK_THREAD_LIMIT:'1',MAGICK_MEMORY_LIMIT:'256MiB',MAGICK_MAP_LIMIT:'256MiB',MAGICK_DISK_LIMIT:'512MiB'}};
  try{
    const dim=(await run('identify',['-ping','-format','%w %h',input],options)).stdout.trim().split(' ').map(Number);
    const [width,height]=dim;if(!dim.every(Number.isInteger)||width<1||height<1||width*height>24000000)throw Error('IMAGE_DIMENSIONS');
    const plan=[{id:'full-psm11',x:0,y:0,w:width,h:height,psm:11,language:'jpn',render_scale:Math.min(1,4000/Math.max(width,height))},...tiles(width,height).map((t,i)=>({...t,id:'tile-'+i+'-best-psm11',psm:11,language:'jpn_best',render_scale:1}))];
    if(prior&&(prior.width!==width||prior.height!==height||!['jpn','jpn_full+jpn_best_tiles'].includes(prior.language)))throw Error('PRIOR_OCR_SCOPE');
    const words=prior?[...prior.words]:[],passes=prior?[...prior.passes]:[],failed=[];
    for(const p of plan){const file=join(work,'pass.png');
      if(passes.some(q=>q.id===p.id&&q.x===p.x&&q.y===p.y&&q.w===p.w&&q.h===p.h))continue;
      let operation='convert';
      try{
      const args=[input];if(p.w!==width||p.h!==height)args.push('-crop',`${p.w}x${p.h}+${p.x}+${p.y}`,'+repage');
      if(p.render_scale!==1)args.push('-resize',String(p.render_scale*100)+'%');
      await run('convert',[...args,'-grayscale','Rec601Luma','-depth','8',file],options);
      operation='tesseract';const passStarted=Date.now(),tsv=(await run('tesseract',[file,'stdout','-l',p.language,'--psm',String(p.psm),'tsv'],options)).stdout;
      const parsed=parseTsv(tsv,p.id,p);words.push(...parsed);passes.push({...p,implementation_sha256:implementationSha,word_count:parsed.length,tsv_sha256:hash(tsv),elapsed_ms:Date.now()-passStarted});
      process.stderr.write(JSON.stringify({stage:'ocr_pass',pass:p.id,word_count:parsed.length,elapsed_ms:Date.now()-passStarted})+'\n');
      }catch(e){failed.push({...p,operation,exit_code:typeof e.code==='number'?e.code:null,signal:e.signal??null,reason:e.killed||e.code==='ETIMEDOUT'?'OCR_TIMEOUT':'OCR_PASS_FAILED'});}
    }
    const regions=regionsFromWords(words,width,height);
    return {width,height,status:failed.length?'page_partial':'processed',pixel_coverage:rectangleCoverage(passes,width,height),language:'jpn_full+jpn_best_tiles',passes,failed_passes:failed,previous_failed_passes:prior?.failed_passes??[],words,text_blocks:textBlocks(words),regions,elapsed_ms:Date.now()-started};
  }finally{await rm(work,{recursive:true,force:true});}
}
export function rectangleCoverage(rectangles,width,height){
  const xs=[...new Set([0,width,...rectangles.flatMap(r=>[r.x,r.x+r.w])])].sort((a,b)=>a-b);let area=0;
  for(let i=0;i<xs.length-1;i++){
    const ys=rectangles.filter(r=>r.x<=xs[i]&&r.x+r.w>=xs[i+1]).map(r=>[r.y,r.y+r.h]).sort((a,b)=>a[0]-b[0]);let covered=0,start=0,end=0;
    for(const [a,b] of ys){if(a>end){covered+=end-start;start=a;}end=Math.max(end,b);}covered+=end-start;area+=(xs[i+1]-xs[i])*covered;
  }return area/(width*height);
}
export async function buildCorpus(manifestFile,outdir,{extract=extractPage}={}) {
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(!Array.isArray(manifest.issues)||!manifest.issues.length||manifest.issues.length>8)throw Error('ISSUE_LIMIT');
  if(new Set(manifest.issues.map(i=>i.id)).size!==manifest.issues.length)throw Error('ISSUE_ID_DUPLICATE');
  for(const issue of manifest.issues){if(!/^[a-z0-9-]{1,100}$/.test(issue.id)||!Array.isArray(issue.pages)||!issue.pages.length||issue.pages.length>24||issue.pages.some(p=>!Number.isInteger(p.ordinal)||p.ordinal<1)||new Set(issue.pages.map(p=>p.ordinal)).size!==issue.pages.length)throw Error('PAGE_MANIFEST_INVALID');}
  // Each local experiment is immutable; do not overwrite a previous audit run.
  await mkdir(outdir,{recursive:false});const db=new DatabaseSync(join(outdir,'whole-flyer.sqlite'));
  db.exec('CREATE TABLE corpus_pages (issue_id TEXT,page INTEGER,image_sha256 TEXT,source TEXT,evidence BLOB,PRIMARY KEY(issue_id,page));');
  const summary={schema:1,extractor:'whole-flyer-v1',implementation_sha256:implementationSha,input_sha256:hash(await readFile(manifestFile)),store:manifest.store,completeness_scope:manifest.completeness_scope,
    physical_pages:manifest.physical_pages??null,originals_redistributed:false,model_calls:0,network_requests:0,issues:[],true_product_region_denominator:null,unextracted_product_regions:null,recall:null};
  try{for(const issue of manifest.issues){const report={id:issue.id,publisher_window:{from:issue.from,until:issue.until},expected_listed_pages:issue.observed_listed_pages,acquired_pages:0,processed_pages:0,partially_processed_pages:0,confirmed_products:0,needs_review_numeric_regions:0,pages:[]};
    for(const page of issue.pages){const input=resolve(dirname(manifestFile),page.file),rel=relative(dirname(manifestFile),input);if(rel.startsWith('..')||isAbsolute(rel))throw Error('INPUT_PATH_SCOPE');
      const bytes=await readFile(input);if(hash(bytes)!==page.sha256)throw Error('IMAGE_HASH_MISMATCH');report.acquired_pages++;
      let result;try{result=await extract(input);if(result.status==='page_partial')report.partially_processed_pages++;else report.processed_pages++;report.needs_review_numeric_regions+=result.regions.length;}
      catch(e){result={status:'page_failed',reason:e.killed||e.code==='ETIMEDOUT'?'OCR_TIMEOUT':'OCR_PAGE_FAILED',regions:[],unextracted_product_regions:null};}
      const evidence={issue:issue.id,page:page.ordinal,physical_page:page.physical_page??null,logical_face:page.logical_face??null,physical_bbox:page.physical_bbox??null,source:page.source,image_sha256:page.sha256,...result};
      const compressed=gzipSync(JSON.stringify(evidence));
      db.prepare('INSERT INTO corpus_pages VALUES (?,?,?,?,?)').run(issue.id,page.ordinal,page.sha256,page.source,compressed);
      await writeFile(join(outdir,issue.id+'-p'+page.ordinal+'.json.gz'),compressed,{mode:0o600,flag:'wx'});
      report.pages.push({ordinal:page.ordinal,image_sha256:page.sha256,status:result.status||'processed',width:result.width,height:result.height,passes:result.passes?.length,pixel_coverage:result.pixel_coverage,detected_numeric_regions:result.regions.length,reason:result.reason});
      process.stderr.write(JSON.stringify({issue:issue.id,page:page.ordinal,...report.pages.at(-1)})+'\n');
    }report.listed_page_coverage_complete=report.expected_listed_pages===report.acquired_pages&&report.acquired_pages===report.processed_pages;
    summary.issues.push(report);}
  }finally{db.close();}
  await writeFile(join(outdir,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});return summary;
}
// Revisit grouping without another source GET or another OCR call. Preserve the
// original pass evidence and original extractor fingerprint alongside this run.
export async function reindexCorpus(source,outdir) {
  const parent=JSON.parse(await readFile(join(source,'summary.json'),'utf8'));
  await mkdir(outdir,{recursive:false});const db=new DatabaseSync(join(outdir,'whole-flyer.sqlite'));
  db.exec('CREATE TABLE corpus_pages (issue_id TEXT,page INTEGER,image_sha256 TEXT,source TEXT,evidence BLOB,PRIMARY KEY(issue_id,page));');
  const summary={...parent,implementation_sha256:implementationSha,ocr_implementation_sha256:parent.ocr_implementation_sha256??parent.implementation_sha256,reindexed_without_ocr:true,issues:[]};
  try{for(const issue of parent.issues){const report={...issue,confirmed_products:0,needs_review_numeric_regions:0,pages:[]};delete report.confirmed;delete report.needs_review;
    for(const page of issue.pages){
      if(!/^[a-z0-9-]+$/.test(issue.id)||!Number.isInteger(page.ordinal))throw Error('CORPUS_ID_SCOPE');
      const name=issue.id+'-p'+page.ordinal+'.json.gz',original=await readFile(join(source,name)),evidence=JSON.parse(gunzipSync(original));
      if(evidence.issue!==issue.id||evidence.page!==page.ordinal||evidence.image_sha256!==page.image_sha256)throw Error('CORPUS_PROVENANCE_MISMATCH');
      if(evidence.words){evidence.text_blocks=textBlocks(evidence.words);evidence.regions=regionsFromWords(evidence.words,evidence.width,evidence.height);}
      evidence.parent_evidence_sha256=hash(original);const compressed=gzipSync(JSON.stringify(evidence));
      db.prepare('INSERT INTO corpus_pages VALUES (?,?,?,?,?)').run(issue.id,page.ordinal,page.image_sha256,evidence.source,compressed);
      await writeFile(join(outdir,name),compressed,{mode:0o600});
      report.needs_review_numeric_regions+=evidence.regions.length;report.pages.push({...page,detected_numeric_regions:evidence.regions.length,evidence_sha256:hash(compressed)});
    }report.listed_page_coverage_complete=report.expected_listed_pages===report.acquired_pages&&report.acquired_pages===report.processed_pages;summary.issues.push(report);}
  }finally{db.close();}
  await writeFile(join(outdir,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});return summary;
}
export async function resumeCorpus(manifestFile,source,outdir,{extract=extractPage}={}){
  const parentBytes=await readFile(join(source,'summary.json')),parent=JSON.parse(parentBytes),manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes);
  if(hash(manifestBytes)!==parent.input_sha256)throw Error('RESUME_MANIFEST_CHANGED');
  const lookup=new Map();for(const issue of manifest.issues)for(const page of issue.pages){
    if(!/^[a-z0-9-]{1,100}$/.test(issue.id)||!Number.isInteger(page.ordinal))throw Error('CORPUS_ID_SCOPE');
    const bytes=await readFile(join(source,issue.id+'-p'+page.ordinal+'.json.gz')),prior=JSON.parse(gunzipSync(bytes));
    if(prior.issue!==issue.id||prior.page!==page.ordinal||prior.image_sha256!==page.sha256)throw Error('CORPUS_PROVENANCE_MISMATCH');
    prior.passes=prior.passes?.map(p=>({...p,implementation_sha256:p.implementation_sha256??parent.ocr_implementation_sha256??parent.implementation_sha256}));
    lookup.set(resolve(dirname(manifestFile),page.file),{prior,hash:hash(bytes)});
  }
  const summary=await buildCorpus(manifestFile,outdir,{extract:async input=>{
    const saved=lookup.get(input);if(!saved)throw Error('RESUME_PAGE_MISSING');
    const reusable=['page_partial','processed'].includes(saved.prior.status)&&Array.isArray(saved.prior.passes)&&Array.isArray(saved.prior.words);
    const result=await extract(input,{prior:reusable?saved.prior:null});return {...result,parent_evidence_sha256:saved.hash};
  }});
  summary.parent_run_summary_sha256=hash(parentBytes);summary.ocr_pass_provenance='per-pass implementation_sha256; old successful passes reused without OCR';
  await writeFile(join(outdir,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length===6&&process.argv[2]==='--resume')await resumeCorpus(resolve(process.argv[3]),resolve(process.argv[4]),resolve(process.argv[5]));
  else if(process.argv.length===5&&process.argv[2]==='--reindex')await reindexCorpus(resolve(process.argv[3]),resolve(process.argv[4]));
  else if(process.argv.length===4)await buildCorpus(resolve(process.argv[2]),resolve(process.argv[3]));
  else throw Error('USAGE_LOCAL_MANIFEST_OUTPUT');
}
