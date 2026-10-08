import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublication, extractBody, listSections } from '../src/core';
import { readFrontmatter, writePublication } from '../src/storage';
const source='---\n# 自定义注释\n私人属性: 保留\n嵌套:\n  key: value\n---\n# 研究\n\n私人研究原文。\n\n## 发布正文\n\n可公开内容。\n\n## 单篇复盘\n\n私人复盘原文。\n';
test('single transaction preserves custom YAML comments, nested properties and unselected sections',()=>{
  const pub=parsePublication('发布/旧稿.md',source,readFrontmatter(source),0);pub.id='new-id';pub.bodySource='section';pub.section=listSections(source).find(s=>s.heading==='发布正文')!.key;pub.body='修改后的公开内容。';pub.title='公开标题';pub.images=['发布/中文 空格/图片/封面.png'];
  const result=writePublication(source,pub);const fm=readFrontmatter(result);
  assert.equal(fm.私人属性,'保留');assert.deepEqual(fm.嵌套,{key:'value'});assert.match(result,/# 自定义注释/);assert.match(result,/私人研究原文。/);assert.match(result,/私人复盘原文。/);assert.equal(extractBody(result,'section',pub.section),'修改后的公开内容。');assert.deepEqual(fm.图片,['[[发布/中文 空格/图片/封面.png]]']);
});
test('concurrent source edit cannot be overwritten',()=>{const pub=parsePublication('发布/稿.md',source,readFrontmatter(source),0);assert.throws(()=>writePublication(source+'新的私人记录',pub),/源文件已变更/);});
test('malformed and scalar YAML are blocked without rewriting source',()=>{assert.throws(()=>readFrontmatter('---\nkey: [\n---\nbody'),/格式有误/);assert.throws(()=>readFrontmatter('---\n- list\n---\nbody'),/键值/);});
test('empty and whitespace-delimited frontmatter retain a single property block',()=>{
  for(const raw of ['---\n---\n正文','---  \n私人属性: 保留\n...  \n正文']){
    const pub=parsePublication('发布/稿.md',raw,readFrontmatter(raw),0);pub.bodySource='whole';pub.body='公开的新正文';pub.id='id';
    const updated=writePublication(raw,pub);
    assert.equal(extractBody(updated,'whole'),'公开的新正文');
    if(raw.includes('私人属性'))assert.equal(readFrontmatter(updated).私人属性,'保留');
  }
  assert.throws(()=>readFrontmatter('---  \n未结束: true\n正文'),/结束标记/);
});
