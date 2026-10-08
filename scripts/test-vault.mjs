import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const {id}=JSON.parse(await readFile('manifest.json','utf8'));
const root=resolve(`.dev-vault-${id}`);
await mkdir(root,{recursive:true});
const marker=resolve(root,'.publisher-test-vault.json');
try{const data=JSON.parse(await readFile(marker,'utf8'));if(data.id!==id)throw new Error('不是此项目的测试库。');}
catch(error){if(error.code!=='ENOENT')throw error;const entries=await readdir(root);if(entries.length)throw new Error('测试库路径已有其他文件，请检查后选择独立路径。');await writeFile(marker,JSON.stringify({id,synthetic:true}));}
const plugin=resolve(root,'.obsidian/plugins',id);await mkdir(plugin,{recursive:true});
for(const name of ['manifest.json','main.js','styles.css'])await copyFile(`dist/${id}/${name}`,resolve(plugin,name));
async function create(path,content){try{await writeFile(resolve(root,path),content,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
await create('.obsidian/community-plugins.json',JSON.stringify([id]));
await create('.obsidian/appearance.json',JSON.stringify({theme:'moonstone'}));
await create('.obsidian/app.json',JSON.stringify({alwaysUpdateLinks:true}));
await create(`.obsidian/plugins/${id}/data.json`,JSON.stringify({settings:{configured:true,roots:['发布'],defaultAccount:'演示账号',port:27123},records:[]}));
const names=['把重复工作交给 AI 的三个步骤','我的 Obsidian 素材整理方法','标题不用从头写'];
for(const [index,title] of names.entries()){
  const folder=`发布/P00${index+1}-${title}`;await mkdir(resolve(root,folder,'图片'),{recursive:true});
  for(const [source,target] of [[`cover-${index+1}.png`,'封面.png'],['step-1.png','01.png'],['step-2.png','02.png']]){try{await copyFile(`tests/fixtures/${source}`,resolve(root,folder,'图片',target),1);}catch(error){if(error.code!=='EEXIST')throw error;}}
  const imagePaths=['封面.png','01.png','02.png'].map(name=>`  - "[[${folder}/图片/${name}]]"`).join('\n');
  await create(`${folder}/小红书.md`,`---\nip_kind: publication\nid: synthetic-${index+1}\n发布标题: ${title}\n正文来源: whole\n图片:\n${imagePaths}\n封面: "[[${folder}/图片/封面.png]]"\n小红书话题: [AI工作流, 效率工具]\n账号: 演示账号\n原创声明: 不声明\n状态: 待发布\n---\n每次发内容，最费时间的往往不是写作，而是重复整理。\n\n先列出你每周重复三次以上的步骤，再选一个交给 AI。\n\n1. 拆出重复步骤\n2. 写清输入和输出\n3. 留下人的判断\n`);
}
await create('发布/旧稿合成样例.md','---\n保留属性: 请保留我\n---\n# 作品研究\n\n这部分不对外发布。\n\n## 发布正文\n\n这是旧稿中的对外文案。\n\n## 单篇复盘\n\n这是需要保留的私人复盘。\n');
await create('README.md','# Social Publisher 独立测试库\n\n全部内容为合成样例，不是日常知识库。可测试新建、旧稿登记、图片排序、预览与本地准备。\n');
console.log(`独立测试库已准备：${root}`);
