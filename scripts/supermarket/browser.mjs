// Default-off platform check. Fixed offline data only; no source/API/GCS access.
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function probeBrowser() {
  if(process.getuid?.()===0)throw new Error('BROWSER_ROOT_FORBIDDEN');
  const dir=await mkdtemp(join(tmpdir(),'paluru-browser-'));
  let browser;
  try {
    const {chromium}=await import('/opt/paluru-browser/node_modules/playwright-core/index.mjs');
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,timeout:20000,
      env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'ja_JP.UTF-8',XDG_CONFIG_HOME:join(dir,'config'),XDG_CACHE_HOME:join(dir,'cache')},
      args:['--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
    let blockedRequests=0;
    await context.route('**/*',async route=>{blockedRequests++;await route.abort('blockedbyclient');});
    const page=await context.newPage();
    await page.goto('data:text/html,<h1>PALURU offline browser probe</h1>',{timeout:10000});
    if(await page.locator('h1').textContent()!=='PALURU offline browser probe')throw new Error('BROWSER_PROBE_CONTENT');
    let browserProcesses=0;
    const forbidden=['--no-sandbox','--disable-setuid-sandbox','--disable-seccomp-filter-sandbox','--disable-gpu-sandbox'];
    for(const pid of await readdir('/proc')) {
      if(!/^\d+$/.test(pid))continue;
      let args;
      try{args=(await readFile('/proc/'+pid+'/cmdline','utf8')).split('\0');}catch{continue;}
      if(!/\/(?:chrome|chromium)$/.test(args[0]||''))continue;
      browserProcesses++;
      if(args.some(arg=>forbidden.includes(arg)))throw new Error('BROWSER_UNSAFE_ARGUMENT');
    }
    if(!browserProcesses)throw new Error('BROWSER_ARGUMENTS_UNVERIFIED');
    return {mode:'browser_probe',sandbox_enabled:true,uid:process.getuid(),observed_browser_processes:browserProcesses,
      sandbox_disabling_args:[],offline_data:true,blocked_page_requests:blockedRequests,
      source_requests:0,gcs_operations:0,claims_created:0};
  }catch(error) {
    if(/^BROWSER_[A-Z_]+$/.test(error.message))throw error;
    throw new Error(/sandbox|namespace|Operation not permitted/i.test(error.message)?'BROWSER_SANDBOX_UNAVAILABLE':'BROWSER_PROBE_FAILED');
  }finally {
    if(browser)await browser.close();
    await rm(dir,{recursive:true,force:true});
  }
}
