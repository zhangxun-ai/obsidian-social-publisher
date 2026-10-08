import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PublisherUI } from '../src/ui';
import { parsePublication } from '../src/core';
import { DEFAULT_SETTINGS, type PublisherHost } from '../src/host';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

for(const change of ['body','same-path-image']){
  test(`shared UI invalidates confirmation in batch screen after ${change} changes`,async()=>{
    const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});
    const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
    Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
    const pub=parsePublication('发布/P001/小红书.md','公开正文',{ip_kind:'publication',id:'id',发布标题:'合成标题',正文来源:'whole',图片:['图片/封面.png'],账号:'合成账号',原创声明:'不声明'},0);
    let version='confirmed';let preparations=0;
    const host:PublisherHost={settings:{...DEFAULT_SETTINGS,configured:true,roots:['发布']},
      accountState:()=>({binding:null,detection:null,connected:false,paired:false}),requestAccountDetection:async()=>{},bindAccount:async()=>{},unbindAccount:async()=>{},
      list:async()=>[structuredClone(pub)],save:async p=>p,create:async()=>pub,
      inspect:async()=>({publication:structuredClone(pub),text:pub.body,fingerprint:version,issues:[]}),
      prepare:async()=>{preparations++;},records:()=>[],cancel:async()=>{},acknowledge:()=>{},mediaUrl:()=>'',searchImages:()=>[],openNote:()=>{},saveSettings:async()=>{},connect:async()=>{},disconnect:async()=>{},connection:()=>({running:false,port:27123,paired:false,token:''}),subscribe:()=>()=>{},notify:()=>{}};
    const root=dom.window.document.getElementById('app');const ui=new PublisherUI(root,host);
    const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    const findButton=(label:string)=>[...root.querySelectorAll('button')].find((b:any)=>b.textContent===label) as HTMLButtonElement;
    try{
      await ui.mount();findButton('完整预览').click();await tick();findButton('确认此版本').click();await tick();findButton('返回作品').click();
      root.querySelector('tbody input[type="checkbox"]').click();findButton('创建填写任务 · 1 篇').click();
      assert.match(root.textContent,/已核对版本/);assert.equal(findButton('创建 1 篇填写任务').disabled,false);
      version='changed';if(change==='body')pub.body='外部修改后的正文';
      await ui.reload();
      assert.doesNotMatch(root.textContent,/已核对版本/);assert.match(root.textContent,/待预览/);assert.equal(findButton('创建 1 篇填写任务').disabled,true);findButton('创建 1 篇填写任务').click();assert.equal(preparations,0);
    }finally{ui.destroy();dom.window.close();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
  });
}

test('account UI requires explicit confirmation and does not infer login from a legacy name or opening login', async()=>{
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
  const pub=parsePublication('发布/旧稿.md','公开正文',{账号:'原账号备注'},0);
  let state:import('../src/host').AccountState={binding:null,detection:null,connected:true,paired:true};
  let loginCalls=0,updateCalls=0;const confirmed:string[]=[];
  const host:PublisherHost={settings:{...DEFAULT_SETTINGS,configured:true,defaultAccount:'原账号备注'},
    accountState:()=>state,requestAccountDetection:async()=>{state.detection={requestId:'nonce',status:'waiting',checkedAt:Date.now()};},
    bindAccount:async(id)=>{confirmed.push(id);state.binding=state.detection!.account!;},unbindAccount:async()=>{state.binding=null;},
    list:async()=>[pub],save:async p=>p,create:async()=>pub,inspect:async()=>({publication:pub,text:pub.body,fingerprint:'v',issues:[]}),prepare:async()=>{},records:()=>[],cancel:async()=>{},acknowledge:()=>{},mediaUrl:()=>'',searchImages:()=>[],openNote:()=>{},saveSettings:async()=>{},connect:async()=>{},disconnect:async()=>{},connection:()=>({running:true,port:27123,paired:true,token:'test-only'}),subscribe:()=>()=>{},notify:()=>{}};
  const root=dom.window.document.getElementById('app');const ui=new PublisherUI(root,host,{version:'0.1.2',openLogin:()=>{loginCalls++;},checkForUpdates:async()=>{updateCalls++;}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const btn=(label:string)=>[...root.querySelectorAll('button')].find((b:any)=>b.textContent===label) as HTMLButtonElement;
  try {
    await ui.mount();btn('平台与账号').click();assert.match(root.textContent,/尚未绑定账号/);
    btn('打开小红书登录页').click();assert.equal(loginCalls,1);assert.equal(state.binding,null);
    assert.doesNotMatch(root.textContent,/原账号备注/);
    btn('检测登录状态').click();await tick();assert.match(root.textContent,/正在检测账号/);assert.deepEqual(confirmed,[]);
    state.detection={requestId:'fresh-nonce',status:'recognized',checkedAt:Date.now(),account:{platform:'xiaohongshu',accountId:'account-001',nickname:'合成账号',checkedAt:Date.now()}};
    await ui.reload();assert.match(root.textContent,/合成账号 · account-001/);assert.equal(state.binding,null);
    btn('确认并绑定此账号').click();await tick();assert.deepEqual(confirmed,['fresh-nonce']);assert.match(root.textContent,/已核对账号/);
    state.detection={...state.detection!,requestId:'replacement-nonce',account:{...state.binding!,accountId:'account-002',nickname:'另一个合成账号'}};
    await ui.reload();assert.match(root.textContent,/检测到另一个账号/);assert.equal(state.binding!.accountId,'account-001');
    btn('确认更换绑定账号').click();await tick();assert.deepEqual(confirmed,['fresh-nonce','replacement-nonce']);assert.equal(state.binding!.accountId,'account-002');
    state.detection={...state.detection!,requestId:'expired-nonce',checkedAt:Date.now()-120_001,account:{...state.binding!,accountId:'account-003'}};
    await ui.reload();assert.match(root.textContent,/检测结果已过期/);assert.equal(btn('确认更换绑定账号'),undefined);assert.equal(btn('确认并绑定此账号'),undefined);
    assert.deepEqual(confirmed,['fresh-nonce','replacement-nonce']);assert.equal(state.binding!.accountId,'account-002');
    btn('检查更新').click();await tick();assert.equal(updateCalls,1);assert.match(root.textContent,/无需卸载重装/);
  } finally {ui.destroy();dom.window.close();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
});

test('account setup copies one raw connection code, starts the connection once and keeps technical details collapsed', async()=>{
  const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const copied:string[]=[];
  const connectionCode='A'.repeat(43);
  Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async(text:string)=>{copied.push(text);}}},configurable:true});
  let running=false,paired=false,connectCalls=0,loginCalls=0,detectionCalls=0;
  let onChange=()=>{};
  const host:PublisherHost={settings:{...DEFAULT_SETTINGS,configured:true},
    accountState:()=>({binding:null,detection:null,connected:running,paired}),requestAccountDetection:async()=>{detectionCalls++;},bindAccount:async()=>{},unbindAccount:async()=>{},
    list:async()=>[],save:async p=>p,create:async()=>{throw new Error('unused');},inspect:async()=>{throw new Error('unused');},prepare:async()=>{},records:()=>[],cancel:async()=>{},acknowledge:()=>{},mediaUrl:()=>'',searchImages:()=>[],openNote:()=>{},saveSettings:async()=>{},
    connect:async()=>{connectCalls++;await Promise.resolve();running=true;},disconnect:async()=>{},connection:()=>({running,paired,port:27123,token:running?connectionCode:''}),subscribe:fn=>{onChange=fn;return()=>{};},notify:()=>{}};
  const root=dom.window.document.getElementById('app');const ui=new PublisherUI(root,host,{version:'test',vaultName:'独立合成测试库',openLogin:()=>{loginCalls++;},checkForUpdates:async()=>{}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const btn=(label:string)=>[...root.querySelectorAll('button')].find((b:any)=>b.textContent===label) as HTMLButtonElement;
  try{
    await ui.mount();btn('平台与账号').click();
    assert.match(root.textContent,/当前知识库：独立合成测试库/);
    assert.match(root.textContent,/复制连接码，粘贴到浏览器扩展即可连接/);
    assert.equal(root.querySelector('.sp-account-connection'),null);
    assert.equal(root.querySelector('.sp-account-help').open,false);
    assert.equal(btn('检测登录状态'),undefined);
    assert.equal(btn('打开小红书登录页'),undefined);
    btn('复制连接码').click();await tick();
    assert.equal(connectCalls,1);assert.equal(loginCalls,0);assert.equal(detectionCalls,0);
    assert.deepEqual(copied,[connectionCode]);assert.equal(copied[0].length,43);
    assert.match(root.textContent,/等待浏览器连接/);
    const code=root.querySelector('[aria-label="连接码"]');
    assert.equal(code.value,connectionCode);assert.equal(code.type,'password');assert.equal(code.readOnly,true);
    assert.equal(root.querySelector('.sp-account-connection').open,false);
    assert.equal(btn('检测登录状态'),undefined);
    btn('复制连接码').click();await tick();
    assert.equal(connectCalls,1);assert.deepEqual(copied,[connectionCode,connectionCode]);
    assert.equal(root.querySelector('.sp-account-connection').open,false);
    paired=true;onChange();await new Promise(resolve=>setTimeout(resolve,220));
    assert.equal(btn('检测登录状态').disabled,false);assert.equal(root.querySelector('.sp-account-connection').open,false);
    assert.match(root.textContent,/尚未绑定账号/);
    btn('检测登录状态').click();await tick();assert.equal(detectionCalls,1);
    assert.equal(loginCalls,0);assert.equal(host.accountState().binding,null);
  }finally{ui.destroy();dom.window.close();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else Reflect.deleteProperty(globalThis,'navigator');}
});
