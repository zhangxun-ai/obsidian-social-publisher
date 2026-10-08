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
      list:async()=>[structuredClone(pub)],save:async p=>p,create:async()=>pub,
      inspect:async()=>({publication:structuredClone(pub),text:pub.body,fingerprint:version,issues:[]}),
      prepare:async()=>{preparations++;},records:()=>[],cancel:async()=>{},acknowledge:()=>{},mediaUrl:()=>'',searchImages:()=>[],openNote:()=>{},saveSettings:async()=>{},connect:async()=>{},disconnect:async()=>{},connection:()=>({running:false,port:27123,paired:false,token:''}),subscribe:()=>()=>{},notify:()=>{}};
    const root=dom.window.document.getElementById('app');const ui=new PublisherUI(root,host);
    const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    const findButton=(label:string)=>[...root.querySelectorAll('button')].find((b:any)=>b.textContent===label) as HTMLButtonElement;
    try{
      await ui.mount();findButton('完整预览').click();await tick();findButton('确认此版本').click();await tick();findButton('返回作品').click();
      root.querySelector('tbody input[type="checkbox"]').click();findButton('准备所选 1 篇').click();
      assert.match(root.textContent,/已核对版本/);assert.equal(findButton('确认并准备 1 篇').disabled,false);
      version='changed';if(change==='body')pub.body='外部修改后的正文';
      await ui.reload();
      assert.doesNotMatch(root.textContent,/已核对版本/);assert.match(root.textContent,/待预览/);assert.equal(findButton('确认并准备 1 篇').disabled,true);findButton('确认并准备 1 篇').click();assert.equal(preparations,0);
    }finally{ui.destroy();dom.window.close();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
  });
}
