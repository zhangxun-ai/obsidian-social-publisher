/** Optional real MV3 smoke test using the existing Playwright CLI skill/runtime.
 * All content, platform responses and the Obsidian runtime are synthetic.
 * Does not use a personal browser profile, vault, platform session or publishing endpoint.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.PUBLISHER_PLAYWRIGHT_CLI || resolve(homedir(), '.codex/skills/playwright/scripts/playwright_cli.sh');
const executablePath = process.env.PUBLISHER_CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error('Set PUBLISHER_CHROMIUM_EXECUTABLE to an already installed Chromium executable.');
const staging = await mkdtemp(resolve(tmpdir(), 'publisher-mv3-smoke-'));
const session = `publisher-smoke-${process.pid}`;
const accountId = '0123456789abcdef01234567';
const endpoint = 'https://creator.xiaohongshu.com/api/galaxy/user/info';
const officialUrl = 'https://creator.xiaohongshu.com/publish/publish';
const extensionPath = resolve(root, 'extension');
const configPath = resolve(staging, 'config.json');
await writeFile(configPath, JSON.stringify({browser:{browserName:'chromium',launchOptions:{headless:true,channel:'chromium',executablePath,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]},contextOptions:{viewport:{width:1000,height:800}}}}));
const runtimePath = resolve(staging, 'runtime.cjs');
await build({stdin:{contents:"export {PublisherService} from './src/service'; export {createMockEnvironment} from './tests/obsidian-mock';",resolveDir:root,sourcefile:'synthetic-mv3-entry.ts'},bundle:true,platform:'node',format:'cjs',target:'node22',outfile:runtimePath,alias:{obsidian:resolve(root,'tests/obsidian-mock.ts')},logLevel:'silent'});
const {PublisherService,createMockEnvironment} = createRequire(import.meta.url)(runtimePath);
const env = createMockEnvironment();
env.vault.seedFolder('发布');
const note = '发布/合成作品/小红书.md';
const image = '发布/合成作品/图片/封面.png';
env.vault.seedText(note, `---\nip_kind: publication\nid: synthetic-mv3\n发布标题: 合成MV3标题\n正文来源: whole\n账号: 合成测试账号\n平台账号ID: ${accountId}\n原创声明: 不声明\n图片: ["[[${image}]]"]\n---\n第一行\n\n特殊 & 文本 #候选\n`);
const bytes = Buffer.from([137,80,78,71,13,10,26,10,1,0,1,2]);
env.vault.seedBytes(image, bytes);
const service = new PublisherService(env.app, env.pluginApi, env.notice);
await service.saveSettings({configured:true,roots:['发布'],defaultAccount:'',port:27123});
await service.bridge.start(0);
const secret = service.bridge.token;
const port = service.bridge.port;
const results = {};

async function command(args) {
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(cli, [`-s=${session}`, ...args], {cwd:root,stdio:['ignore','pipe','pipe']});
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveOutput(stdout) : reject(new Error((stdout+'\n'+stderr).split(secret).join('[redacted-test-pairing]'))));
  });
  if (output.includes('### Error')) throw new Error(output.split(secret).join('[redacted-test-pairing]'));
  const match = /### Result\n([^\n]+)/.exec(output);
  return match ? JSON.parse(match[1]) : null;
}
const run = code => command(['run-code', code]);
const waitFor = async condition => {
  for(let n=0;n<100;n++) { if(condition()) return; await new Promise(resolveWait=>setTimeout(resolveWait,100)); }
  throw new Error('Synthetic service state did not reach expected stage.');
};
try {
  await command(['open','about:blank','--config',configPath,'--profile',resolve(staging,'profile')]);
  const backgroundSource = await readFile(resolve(extensionPath,'background.js'),'utf8');
  const syntheticHtml = '<!doctype html><meta charset="utf-8"><title>合成小红书后台</title><style>.ProseMirror{min-height:80px;min-width:400px;border:1px solid gray}</style><input type="file" accept="image/*" multiple><input placeholder="填写标题"><div class="tiptap ProseMirror" contenteditable="true"></div><button id="publish">发布</button><button id="draft">存草稿</button><script>window.publishClicks=0;document.getElementById("publish").onclick=()=>window.publishClicks++;document.getElementById("draft").onclick=()=>window.publishClicks++;</script>';
  results.workspace = await run(`async(page)=>{
    const context=page.context();
    await context.route(${JSON.stringify(endpoint)},route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,code:0,data:{userId:${JSON.stringify(accountId)},userName:'合成测试账号',privateField:'never-forward'}})}));
    await context.route(${JSON.stringify(officialUrl)},route=>route.fulfill({status:200,contentType:'text/html',body:${JSON.stringify(syntheticHtml)}}));
    await page.goto(${JSON.stringify(officialUrl)});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const opened=await worker.evaluate(async source=>{
      let handler;const original=chrome.action.onClicked.addListener;
      chrome.action.onClicked.addListener=callback=>{handler=callback;};
      try{eval(source);}finally{chrome.action.onClicked.addListener=original;}
      handler();await new Promise(r=>setTimeout(r,250));handler();await new Promise(r=>setTimeout(r,250));
      const contexts=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[chrome.runtime.getURL('popup.html')]});
      return {count:contexts.length,url:chrome.runtime.getURL('popup.html')};
    },${JSON.stringify(backgroundSource)});
    if(opened.count!==1)throw new Error('Extension action did not reuse one workspace');
    const workspace=context.pages().find(p=>p.url()===opened.url)||await context.waitForEvent('page');
    await workspace.waitForLoadState();await workspace.locator('body').ariaSnapshot();
    await workspace.locator('#connection-options summary').click();
    await workspace.locator('#port').fill(${JSON.stringify(String(port))});
    await workspace.locator('#token').fill(${JSON.stringify(secret)});
    await workspace.locator('#connect').click();
    await workspace.locator('#connection-state').filter({hasText:'已连接 Obsidian'}).waitFor();
    return {singlePersistentTab:opened.count===1,officialTabs:await workspace.locator('#official-tabs option').count(),paired:true};
  }`);
  console.log("MV3 workspace reuse and genuine extension pairing passed.");
  assert.equal(service.accountState().paired,true);
  results.realExtensionOrigin = service.bridge.pairedExtensionId !== null;
  await run(`async(page)=>{const workspace=page.context().pages().find(p=>p.url().endsWith('/popup.html'));await workspace.locator('#account-status').filter({hasText:'已识别'}).waitFor({timeout:10000});return {recognized:true};}`);
  await waitFor(()=>service.accountState().detection?.status==='recognized');
  assert.equal(service.accountState().binding,null);
  if(process.env.PUBLISHER_CAPTURE_STORE_ASSETS==='1'){
    await mkdir(resolve(root,'docs/store-assets'),{recursive:true});
    await run(`async(page)=>{const workspace=page.context().pages().find(p=>p.url().endsWith('/popup.html'));await workspace.setViewportSize({width:1280,height:800});await workspace.screenshot({path:'docs/store-assets/workspace-1280x800.png',mask:[workspace.locator('#token')],maskColor:'#e4e4eb'});return {syntheticStoreScreenshot:true};}`);
  }
  console.log("Isolated-world official API mock and nonce report passed.");
  await service.bindAccount(service.accountState().detection.requestId);
  assert.equal(service.accountState().binding.accountId,accountId);
  const preview=await service.inspect(note);
  assert.deepEqual(preview.issues.filter(issue=>issue.severity==='error'),[]);
  await service.prepare([{path:note,fingerprint:preview.fingerprint}]);
  const taskId=service.records()[0].id;
  results.fill = await run(`async(page)=>{
    const context=page.context();const workspace=context.pages().find(p=>p.url().endsWith('/popup.html'));
    await workspace.locator('#refresh-jobs').click();await workspace.locator('#jobs option[value=${JSON.stringify(taskId)}]').waitFor({state:'attached'});
    await workspace.locator('body').ariaSnapshot();await workspace.locator('#jobs').selectOption(${JSON.stringify(taskId)});
    await workspace.locator('#account-check').check();await workspace.locator('#empty-check').check();await workspace.locator('#fill').click();
    await workspace.waitForFunction(()=>!document.getElementById('connect').disabled,{}, {timeout:30000});
    const fillStatus=await workspace.locator('#status').textContent();
    const official=context.pages().find(p=>p.url()===${JSON.stringify(officialUrl)});
    const filled=await official.evaluate(()=>({title:document.querySelector('input[placeholder]').value,paragraphs:[...document.querySelectorAll('.ProseMirror p')].map(p=>p.textContent),images:[...document.querySelector('input[type=file]').files].map(f=>({name:f.name,size:f.size})),publishClicks:window.publishClicks}));
    return {...filled,fillStatus};
  }`);
  console.log(JSON.stringify({fillStatus:results.fill.fillStatus,recordStatus:service.records()[0]?.status}));
  await waitFor(()=>service.records()[0].status==='结果待核实');
  assert.equal(results.fill.title,'合成MV3标题');
  assert.deepEqual(results.fill.paragraphs,['第一行','','特殊 & 文本 #候选']);
  assert.deepEqual(results.fill.images,[{name:'封面.png',size:bytes.length}]);
  assert.equal(results.fill.publishClicks,0);
  results.boundOnlyAfterConfirmation = true;
  results.reportStatus = service.records()[0].status;
  results.recordAccountIdMatches = service.records()[0].accountId===accountId;
  results.claimAndMediaTransferred = true;
  await mkdir(resolve(root,'output/playwright'),{recursive:true});
  await writeFile(resolve(root,'output/playwright/account-mv3-smoke.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await command(['close']).catch(()=>{});
  await service.dispose();
  console.log(`Synthetic disposable browser profile retained at ${staging}`);
}
