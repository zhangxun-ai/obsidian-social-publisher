import { PublisherUI } from './ui';
import { parsePublication, fingerprint, hashBytes, toPlatformText, validatePublication } from './core';
import { readFrontmatter, writePublication } from './storage';
import { DEFAULT_SETTINGS, type PublisherHost, type Preview, type RunRecord, type PlatformAccount, type AccountDetection } from './host';
import type { Publication } from './types';

const root='发布';
const names=['把重复工作交给 AI 的三个步骤','我的 Obsidian 素材整理方法','标题不用从头写','一周内容复盘','先写一个能用的版本','给灵感留一个入口'];
const bodies=[
  '每次发内容，最费时间的往往不是写作，而是重复整理。\n\n先列出你每周重复三次以上的步骤，再选一个交给 AI。\n\n1. 拆出重复步骤\n2. 写清输入和输出\n3. 留下人的判断',
  '素材不用到处找。\n\n给每篇作品一个文件夹，把对外文案和本次配图放在一起。研究过程保留在选题笔记，通过链接关联。\n\n下次修改时，你会知道哪一份才是准备发布的版本。',
  '先写清楚读者的问题，再决定标题。\n\n一个有用的标题，让人知道点开后能解决什么。',
  '复盘先看真实反馈。没有证据时，把问题留下来，继续验证。',
  '第一版先解决一个具体问题。\n\n跑通之后，再处理那些确实妨碍使用的细节。',
  '灵感来的时候，先记下触发它的具体场景。\n\n有了场景，再去判断它是不是一个值得展开的选题。'
];
function initial():Publication[]{
  return names.map((title,index)=>{
    const path=`${root}/P00${index+1}-${title}/小红书.md`;
    const images=index===3?['fixtures/不存在.png']:[`fixtures/cover-${index+1}.png`, ...(index<2?['fixtures/step-1.png','fixtures/step-2.png']:[])];
    const fm={ip_kind:'publication',id:`demo-${index+1}`,发布标题:title,正文来源:'whole',图片:images,账号:'演示账号',原创声明:'不声明',状态:index<3?'待发布':'草稿',小红书话题:index<3?['AI工作流','效率工具']:[]};
    const base=parsePublication(path,'',fm,Date.now()-index*86400000);base.body=bodies[index];base.raw='';
    const raw=writePublication('',base);const pub=parsePublication(path,raw,readFrontmatter(raw),base.mtime);
    pub.candidates=['fixtures/step-1.png','fixtures/step-2.png'];if(index===3)pub.issues.push({code:'missing_image',severity:'error',message:'找不到图片：不存在.png'});return pub;
  });
}
class DemoHost implements PublisherHost{
  demo=true;settings={...DEFAULT_SETTINGS,configured:true,roots:[root],defaultAccount:'演示账号'};
  private items=initial();private history:RunRecord[]=[];private listeners=new Set<()=>void>();
  async list(){return structuredClone(this.items);}
  async save(pub:Publication){const raw=writePublication(this.items.find(p=>p.path===pub.path)?.raw||'',{...pub,id:pub.id||crypto.randomUUID()});const saved=parsePublication(pub.path,raw,readFrontmatter(raw),Date.now());saved.candidates=['fixtures/step-1.png','fixtures/step-2.png'];this.items=this.items.filter(p=>p.path!==pub.path);this.items.unshift(saved);this.emit();return structuredClone(saved);}
  async create(title:string){if(!title.trim())throw new Error('请填写作品主题。');const pub=parsePublication(`${root}/P${Date.now()}-${title}/小红书.md`,'',{},Date.now());pub.title=title;pub.bodySource='whole';pub.originality='不声明';pub.account='演示账号';return this.save(pub);}
  async inspect(path:string):Promise<Preview>{const pub=this.items.find(p=>p.path===path);if(!pub)throw new Error('示例作品不存在。');const converted=toPlatformText(pub.body);const issues=[...pub.issues,...validatePublication(pub),...converted.issues];const imageVersions=[];for(const path of pub.images){try{const response=await fetch(`/${path}`);if(!response.ok)throw new Error();imageVersions.push({path,hash:await hashBytes(await response.arrayBuffer())});}catch{imageVersions.push({path,hash:'unreadable'});issues.push({code:'missing_image',severity:'error' as const,message:`找不到图片：${path}`});}}
    const text=[converted.text,pub.topics.map(t=>`#${t}`).join(' ')].filter(Boolean).join('\n\n');return{publication:structuredClone(pub),text,issues,fingerprint:await fingerprint(pub,imageVersions)};}
  async prepare(entries:Array<{path:string;fingerprint:string}>){if(!entries.length)throw new Error('请选择作品。');for(const e of entries){const p=await this.inspect(e.path);if(p.fingerprint!==e.fingerprint)throw new Error('版本已变化，请重新预览。');if(p.issues.some(i=>i.severity==='error'))throw new Error('存在阻断问题。');this.history.unshift({id:crypto.randomUUID(),path:e.path,title:p.publication.title,account:p.publication.account,imageCount:p.publication.images.length,fingerprint:p.fingerprint,createdAt:Date.now(),updatedAt:Date.now(),status:'已准备',detail:'合成示例：本地准备交互演示，未连接浏览器或平台。'});}this.emit();}
  private binding: PlatformAccount | null = null;
  private detection: AccountDetection | null = null;
  accountState(){return {binding:this.binding,detection:this.detection,connected:false,paired:false};}
  async requestAccountDetection(){throw new Error('合成预览不会连接或识别真实账号。请在 Obsidian 中使用。');}
  async bindAccount(){throw new Error('合成预览不绑定真实账号。');}
  async unbindAccount(){this.binding=null;this.emit();}
  records(){return this.history;}
  async cancel(id:string){const item=this.history.find(r=>r.id===id);if(item)item.status='已取消';this.emit();}
  acknowledge(){this.notify('这是合成示例，没有浏览器任务。');}
  mediaUrl(path:string){return path&&!path.includes('不存在')?`/${path}`:'';}
  searchImages(query:string){return ['fixtures/step-1.png','fixtures/step-2.png',...names.map((_,i)=>`fixtures/cover-${i+1}.png`)].filter(p=>p.includes(query));}
  openNote(){this.notify('浏览器为合成预览。真实笔记请在 Obsidian 插件中打开。');}
  async saveSettings(settings:typeof this.settings){this.settings={...settings,configured:true};this.emit();}
  async connect(){throw new Error('合成预览不连接浏览器。');}async disconnect(){}
  connection(){return{running:false,port:27123,paired:false,token:''};}
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  private emit(){for(const fn of this.listeners)fn();}
  notify(text:string){const toast=document.createElement('div');toast.className='demo-toast';toast.textContent=text;document.body.append(toast);setTimeout(()=>toast.remove(),4000);}
}
const host=new DemoHost();
const ui=new PublisherUI(document.getElementById('app')!,host,{version:'0.1.4（合成预览）',openLogin:()=>host.notify('合成预览不执行登录，请在 Obsidian 中使用。'),checkForUpdates:async()=>host.notify('请在 Obsidian 中通过 BRAT 更新，本页为合成预览。')});void ui.mount();
