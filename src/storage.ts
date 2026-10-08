import { Document, parseDocument } from 'yaml';
import type { Publication } from './types';
import { replaceBody } from './core';

function frontmatterRange(raw: string): { yaml: string; end: number } | null {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!opening) return null;
  const ending = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  ending.lastIndex = opening[0].length;
  const closing = ending.exec(raw);
  if (!closing) throw new Error('笔记属性格式有误：YAML 没有结束标记。');
  return {yaml: raw.slice(opening[0].length, closing.index), end: closing.index + closing[0].length};
}

export function readFrontmatter(raw: string): Record<string, unknown> {
  const match = frontmatterRange(raw);
  if (!match) return {};
  const doc = parseDocument(match.yaml);
  if (doc.errors.length) throw new Error('笔记属性格式有误，请先在 Obsidian 修复 YAML。');
  const value = doc.toJS();
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('笔记属性必须为键值形式。');
  return value;
}

/** One vault.process transaction preserves unrelated fields and unselected text. */
export function writePublication(current: string, publication: Publication): string {
  if (current !== publication.raw) throw new Error('源文件已变更。请重新打开作品后保存，以保留最新修改。');
  if (!publication.bodySource) throw new Error('请选择整篇纯正文或指定章节。');
  const bodyUpdated = replaceBody(current, publication.bodySource, publication.section, publication.body);
  const match = frontmatterRange(bodyUpdated);
  const doc = match ? parseDocument(match.yaml) : new Document({});
  if (doc.errors.length || (doc.toJS() !== null && (typeof doc.toJS() !== 'object' || Array.isArray(doc.toJS())))) {
    throw new Error('原有属性无法安全更新，请先修复 YAML。');
  }
  const fields: Record<string, unknown> = {
    ip_kind: 'publication', id: publication.id,
    平台: '小红书', 形式: '图文', 发布标题: publication.title,
    正文来源: publication.bodySource, 正文章节: publication.section || null,
    图片: publication.images.map(path => `[[${path}]]`),
    封面: publication.images[0] ? `[[${publication.images[0]}]]` : null,
    小红书话题: publication.topics,
    账号: publication.account || null, 平台账号ID: publication.accountId || null, 原创声明: publication.originality,
    状态: publication.status || '草稿'
  };
  if (publication.topic) fields.选题 = publication.topic;
  for (const [key, value] of Object.entries(fields)) doc.set(key, value);
  const rest = match ? bodyUpdated.slice(match.end) : bodyUpdated;
  return `---\n${doc.toString().trimEnd()}\n---\n${rest}`;
}
