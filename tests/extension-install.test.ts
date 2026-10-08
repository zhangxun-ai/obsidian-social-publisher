import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const script=readFileSync(new URL('../docs/browser-extension.js',import.meta.url),'utf8');
for(const page of ['index.html','browser-extension.html']){
const html=readFileSync(new URL(`../docs/${page}`,import.meta.url),'utf8');
for(const [name,release,visible,message] of [
  ['unsubmitted',{status:'not_submitted',itemId:null},false,'商店安装尚未开放'],
  ['pending review',{status:'in_review',itemId:'a'.repeat(32)},false,'正在等待商店审核'],
  ['verified published',{status:'published',itemId:'a'.repeat(32)},true,'商店安装已开放'],
  ['invalid item',{status:'published',itemId:'https://evil.example'},false,'暂时无法确认'],
  ['network failure',null,false,'暂时无法确认']
] as const){
  test(`${page} exposes only a verified store link: ${name}`,async()=>{
    const dom=new JSDOM(html,{runScripts:'outside-only',url:`https://zhangxun-ai.github.io/obsidian-social-publisher/${page}`});
    try{
      dom.window.fetch=async()=>({ok:!!release,json:async()=>release});dom.window.eval(script);
      await new Promise(resolve=>setTimeout(resolve,0));
      const document=dom.window.document;
      assert.equal(document.getElementById('store-actions').hidden,!visible);
      assert.match(document.getElementById('release-status').textContent,new RegExp(message));
      assert.equal(document.getElementById('add-browser').getAttribute('href'),visible?`https://chromewebstore.google.com/detail/${'a'.repeat(32)}`:null);
    }finally{dom.window.close();}
  });
}
}
test('store draft requests only the fixed platform and local connection permissions',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['scripting','storage']);
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*','https://creator.xiaohongshu.com/*']);
  const release=JSON.parse(readFileSync(new URL('../docs/browser-extension-release.json',import.meta.url),'utf8'));
  assert.ok(['not_submitted','in_review','published'].includes(release.status));
  if(release.itemId!==null)assert.match(release.itemId,/^[a-p]{32}$/);
  if(release.status==='published')assert.match(release.itemId,/^[a-p]{32}$/);
});
