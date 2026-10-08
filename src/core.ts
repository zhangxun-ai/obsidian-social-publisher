import type {
  BodySource,
  ImageVersion,
  Issue,
  MarkdownSection,
  Originality,
  PlatformTextResult,
  Publication,
  ValidationContext,
} from "./types";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff?)(?:[?#].*)?$/i;
const EXTERNAL_TARGET = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function issue(code: string, message: string, severity: Issue["severity"] = "error"): Issue {
  return { code, severity, message };
}

/** Find only a leading YAML block. Its original bytes are never serialized here. */
function documentBodyStart(markdown: string): number {
  const first = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!first) return 0;
  const ending = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  ending.lastIndex = first[0].length;
  const match = ending.exec(markdown);
  if (!match) throw new Error("文件开头的 YAML 属性区没有结束标记，暂不读取或改写正文。");
  return match.index + match[0].length;
}

type SourceLine = { text: string; start: number; end: number };
function linesFrom(markdown: string, start: number): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  pattern.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) && match[0].length) {
    lines.push({ text: match[0].replace(/[\r\n]+$/, ""), start: match.index, end: pattern.lastIndex });
  }
  return lines;
}

/** Heading offsets respect fenced code, so sample headings inside code cannot select private text. */
export function listSections(markdown: string): MarkdownSection[] {
  const lines = linesFrom(markdown, documentBodyStart(markdown));
  const headings: Omit<MarkdownSection, "key" | "label" | "end">[] = [];
  let fence: { character: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && /^ {0,3}(?:`+|~+)[ \t]*$/.test(line.text)) fence = undefined;
      continue;
    }
    if (fence) continue;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
    if (atx) {
      const heading = atx[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
      if (heading) headings.push({ heading, level: atx[1].length, start: line.start, bodyStart: line.end });
      continue;
    }
    const next = lines[index + 1];
    if (line.text.trim() && !/^\s{4}/.test(line.text) && next && /^ {0,3}(?:=+|-+)[ \t]*$/.test(next.text)) {
      headings.push({ heading: line.text.trim(), level: next.text.trim()[0] === "=" ? 1 : 2, start: line.start, bodyStart: next.end });
      index += 1;
    }
  }
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const heading of headings) totals.set(heading.heading, (totals.get(heading.heading) ?? 0) + 1);
  return headings.map((heading, index) => {
    const occurrence = (counts.get(heading.heading) ?? 0) + 1;
    counts.set(heading.heading, occurrence);
    return {
      ...heading,
      key: `${heading.level}:${encodeURIComponent(heading.heading)}:${occurrence}`,
      label: (totals.get(heading.heading) ?? 0) > 1 ? `${heading.heading}（第 ${occurrence} 处）` : heading.heading,
      end: headings.slice(index + 1).find((next) => next.level <= heading.level)?.start ?? markdown.length,
    };
  });
}

function findSection(markdown: string, name: string): MarkdownSection {
  if (!name.trim()) throw new Error("请明确选择发布正文章节。");
  const sections = listSections(markdown);
  const exact = sections.find((section) => section.key === name);
  if (exact) return exact;
  const matches = sections.filter((section) => section.heading === name || section.label === name);
  if (matches.length > 1) throw new Error(`“${name}”有多个同名章节，请重新选择具体章节。`);
  if (!matches.length) throw new Error(`已选章节“${name}”不存在，请重新选择正文范围。`);
  return matches[0];
}

function trimBlankLines(value: string): string {
  if (!value.trim()) return "";
  return value.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

export function extractBody(markdown: string, mode: BodySource, section = ""): string {
  if (mode === "whole") return trimBlankLines(markdown.slice(documentBodyStart(markdown)));
  if (mode === "section") {
    const selected = findSection(markdown, section);
    return trimBlankLines(markdown.slice(selected.bodyStart, selected.end));
  }
  throw new Error("尚未确认正文范围；请选择整篇正文或具体章节。");
}

/** Replace the selected range only. YAML and every unselected character stay intact. */
export function replaceBody(markdown: string, mode: BodySource, section: string, body: string): string {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const replacement = body.replace(/\r\n|\r|\n/g, newline);
  if (mode === "whole") return markdown.slice(0, documentBodyStart(markdown)) + replacement;
  if (mode !== "section") throw new Error("保存前必须明确正文范围。");
  const selected = findSection(markdown, section);
  const introducedBoundary = listSections(replacement).some((heading) => heading.level <= selected.level);
  if (introducedBoundary) throw new Error(`正文中包含与“${selected.heading}”同级或更高的标题，会改变章节边界；请降低标题级别或改为普通文本。`);
  const normalized = replacement.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
  const content = newline + normalized + (selected.end < markdown.length ? newline + newline : newline);
  return markdown.slice(0, selected.bodyStart) + content + markdown.slice(selected.end);
}

/** Decode link syntax, not a filesystem path; resolution belongs to Obsidian's link resolver. */
export function normalizeImageReference(reference: string): string {
  let value = reference.trim();
  const wiki = /^!?\[\[([\s\S]*?)\]\]$/.exec(value);
  if (wiki) value = wiki[1].split("|")[0];
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
  value = value.replace(/\\([\\()[\] ])/g, "$1").trim();
  try { value = decodeURIComponent(value); } catch { /* A literal percent is legal in a local filename. */ }
  return value;
}

interface MarkdownImage { start: number; end: number; target: string }

/** Parenthesized destinations are parsed with balanced parentheses and optional quoted titles. */
function markdownImages(markdown: string): MarkdownImage[] {
  const result: MarkdownImage[] = [];
  const startPattern = /!\[(?:\\.|[^\]\\])*\]\(/g;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(markdown))) {
    let cursor = startPattern.lastIndex;
    while (/\s/.test(markdown[cursor] ?? "") && cursor < markdown.length) cursor += 1;
    let target = "";
    let end = cursor;
    if (markdown[cursor] === "<") {
      const close = markdown.indexOf(">", cursor + 1);
      if (close < 0) continue;
      target = markdown.slice(cursor + 1, close);
      end = close + 1;
    } else {
      let depth = 0;
      const begin = cursor;
      for (; cursor < markdown.length; cursor += 1) {
        if (markdown[cursor] === "\\") { cursor += 1; continue; }
        if (markdown[cursor] === "(") depth += 1;
        else if (markdown[cursor] === ")") {
          if (!depth) break;
          depth -= 1;
        }
        // Spaces in local filenames are supported; a whitespace + quoted suffix is an image title.
        if (/\s/.test(markdown[cursor]) && /^[ \t]+["']/.test(markdown.slice(cursor))) break;
      }
      target = markdown.slice(begin, cursor).trim();
      end = cursor;
    }
    const remainder = /^[ \t]*(?:(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*')[ \t]*)?\)/.exec(markdown.slice(end));
    if (!remainder) continue;
    end += remainder[0].length;
    result.push({ start: match.index, end, target: normalizeImageReference(target) });
    startPattern.lastIndex = end;
  }
  return result;
}

export function extractImageReferences(markdown: string): string[] {
  const refs: { start: number; target: string }[] = [];
  for (const match of markdown.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const target = normalizeImageReference(`[[${match[1]}]]`);
    if (IMAGE_EXTENSION.test(target) && !EXTERNAL_TARGET.test(target)) refs.push({ start: match.index!, target });
  }
  for (const image of markdownImages(markdown)) {
    if (!EXTERNAL_TARGET.test(image.target) && IMAGE_EXTENSION.test(image.target)) refs.push({ start: image.start, target: image.target });
  }
  return [...new Set(refs.sort((left, right) => left.start - right.start).map((reference) => reference.target))];
}

/** Never return partially converted private/unsupported content as publishable text. */
export function toPlatformText(markdown: string): PlatformTextResult {
  const issues: Issue[] = [];
  let text: string;
  try { text = markdown.slice(documentBodyStart(markdown)).replace(/\r\n|\r/g, "\n"); }
  catch (error) { return { text: "", issues: [issue("invalid-frontmatter", (error as Error).message)] }; }
  const images = markdownImages(text);
  if (extractImageReferences(text).length) issues.push(issue('embedded-images', '正文中的图片嵌入不进入文字；请核对本次图片列表，未关联的图片不会上传。', 'warning'));
  if (images.some((image) => EXTERNAL_TARGET.test(image.target))) issues.push(issue("remote-image", "正文含远程图片，首版仅使用明确选择的本地图片；请先保存到知识库并关联。"));
  if (images.some((image) => !EXTERNAL_TARGET.test(image.target) && !IMAGE_EXTENSION.test(image.target))) issues.push(issue("unsupported-image", "正文含非图片或无法识别的嵌入文件，请改成明确的本地图片引用；笔记、PDF 等不会自动转换。"));
  for (const image of [...images].reverse()) text = text.slice(0, image.start) + text.slice(image.end);
  text = text.replace(/!\[\[([^\]\n]+)\]\]/g, (full, target: string) => {
    const reference = normalizeImageReference(`[[${target}]]`);
    return IMAGE_EXTENSION.test(reference) && !EXTERNAL_TARGET.test(reference) ? "" : full;
  });
  const unsupported: [string, RegExp, string][] = [
    ["internal-link", /\[\[|\]\]/, "正文含 Obsidian 内部链接或嵌入笔记，请改为可公开的文字或网址后再准备。"],
    ["code-block", /^ {0,3}(?:`{3,}|~{3,})|^(?: {4}|\t)\S/m, "正文含代码块，首版不自动转换；请明确改写成发布文案。"],
    ["html", /<!--|<\/?[a-z][\w:-]*(?:\s[^>]*|\/?\s*)>/i, "正文含 HTML 或注释，首版不自动转换，避免隐藏内容进入发布稿。"],
    ["table", /^ {0,3}(?=[^\n]*\|)\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/m, "正文含 Markdown 表格，请改写为段落后再准备。"],
    ["obsidian-comment", /%%/, "正文含 Obsidian 私人注释（%%），请移至未选章节或删除本次正文中的注释。"],
    ["callout", /^\s*>\s*\[!\w+\]/m, "正文含 Obsidian Callout，请改写为普通段落后再准备。"],
    ["reference-link", /!?\[[^\]\n]+\]\[[^\]\n]*\]|^\s{0,3}\[[^\]\n]+\]:/m, "正文含引用式链接或图片，请改成直接网址或本地图片引用。"],
    ["footnote", /\[\^[^\]]+\]/, "正文含脚注，请将必要说明写入正文后再准备。"],
    ["block-id", /(?:^|[ \t])\^[a-z\d-]+[ \t]*$/im, "正文含 Obsidian 块标识，请移除本次正文中的内部定位标识后再准备。"],
    ["inline-query", /`(?:=|\$=)/, "正文含动态查询表达式，首版不执行或发布查询；请改成核对后的普通文字。"],
    ["math", /\$\$|\\\[|\\\(|\$[^\s$\n](?:[^$\n]*[^\s$\n])?\$/, "正文含公式，首版不自动转换，请改写成普通文字。"],
    ["unresolved-image", /!\[/, "正文中有未识别的图片语法，请检查并使用本地 Markdown 或 Obsidian 图片链接。"],
  ];
  for (const [code, pattern, message] of unsupported) if (pattern.test(text)) issues.push(issue(code, message));
  if (issues.some((entry) => entry.severity === "error")) return { text: "", issues };

  // Preserve both label and URL, including topics, instead of silently dropping the destination.
  text = text.replace(/\[([^\]\n]+)\]\((<[^>\n]+>|[^)\n]+)\)/g, (_full, label: string, target: string) => {
    const url = target.replace(/^<|>$/g, "").trim();
    if (!/^(?:https?:\/\/|mailto:)/i.test(url)) {
      issues.push(issue("local-link", "正文含本地或不支持的链接，请改成可公开的文字或 HTTPS 网址。"));
      return "";
    }
    return label === url ? url : `${label}（${url}）`;
  });
  if (issues.some((entry) => entry.severity === "error")) return { text: "", issues };
  // Inline formatting deliberately becomes plain text; escaped punctuation keeps its literal meaning.
  const escaped: string[] = [];
  text = text.replace(/\\([\\`*{}\[\]()#+.!_>~|-])/g, (_full, punctuation: string) => {
    escaped.push(punctuation);
    return `\u0001${escaped.length - 1}\u0002`;
  });
  text = text
    .replace(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/gm, "$1")
    .replace(/^ {0,3}>[ \t]?/gm, "")
    .replace(/^ {0,3}(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/^(.+)\n {0,3}(?:=+|-+)[ \t]*$/gm, "$1")
    .replace(/(`+)([^\n]*?)\1/g, "$2")
    .replace(/\*\*([\s\S]+?)\*\*|__([\s\S]+?)__/g, (_full, star: string, underscore: string) => star ?? underscore)
    .replace(/~~([\s\S]+?)~~/g, "$1")
    .replace(/==([^\n]+?)==/g, "$1")
    .replace(/^([ \t]*[-*+][ \t]+)\[([ xX])\][ \t]*/gm, (_full, bullet: string, checked: string) => `${bullet}${checked === " " ? "☐" : "☑"} `)
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, "$1$2")
    .replace(/\u0001(\d+)\u0002/g, (_full, index: string) => escaped[Number(index)])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, issues };
}

export function normalizeVaultPath(path: string): string {
  if (!path || /[\u0000-\u001f]/.test(path)) throw new Error("知识库路径为空或包含控制字符。");
  const value = path.replace(/\\/g, "/");
  if (value.startsWith("/") || EXTERNAL_TARGET.test(value) || /^[A-Za-z]:/.test(value)) throw new Error("仅允许知识库内的相对路径。");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("路径超出知识库范围。");
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) throw new Error("路径不能指向知识库根目录。");
  return parts.join("/");
}

export function withinScope(path: string, scopes: string | readonly string[]): boolean {
  try {
    const normalized = normalizeVaultPath(path);
    return (typeof scopes === "string" ? [scopes] : scopes).some((scope) => {
      try {
        const root = normalizeVaultPath(scope);
        return normalized === root || normalized.startsWith(`${root}/`);
      } catch { return false; }
    });
  } catch { return false; }
}

export function selectedInFilter<T extends { path: string }>(items: readonly T[], selected: ReadonlySet<string>): T[] {
  return items.filter((item) => selected.has(item.path));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).map((entry) => entry.trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

export function parsePublication(path: string, markdown: string, frontmatter: Record<string, unknown> | null | undefined, mtime: number): Publication {
  const fm = frontmatter ?? {};
  const source = stringValue(fm["正文来源"] ?? fm.bodySource);
  const bodySource: BodySource = source === "whole" || source === "整篇正文" || source === "整篇" ? "whole" : source === "section" || source === "指定章节" || source === "章节" ? "section" : "";
  const section = stringValue(fm["正文章节"] ?? fm.section);
  const rawImages = stringList(fm["图片"]).map(normalizeImageReference);
  const cover = normalizeImageReference(stringValue(fm["封面"]));
  const images = [...new Set(cover ? [cover, ...rawImages] : rawImages)];
  const originalityValue = stringValue(fm["原创声明"]);
  const originality: Originality = originalityValue === "声明原创" || originalityValue === "不声明" ? originalityValue : "未确认";
  const issues: Issue[] = [];
  let body = "";
  if (bodySource) {
    try { body = extractBody(markdown, bodySource, section); }
    catch (error) { issues.push(issue("body-range", (error as Error).message)); }
  }
  let candidates: string[] = [];
  try { candidates = extractImageReferences(bodySource ? body : markdown.slice(documentBodyStart(markdown))); }
  catch (error) { issues.push(issue("invalid-frontmatter", (error as Error).message)); }
  if (rawImages.length !== new Set(rawImages).size) issues.push(issue("duplicate-image", "图片列表包含重复引用，预览按首次出现的顺序去重。", "warning"));
  const publication: Publication = {
    title: stringValue(fm["发布标题"] ?? fm.title) || path.split("/").pop()!.replace(/\.md$/i, ""),
    id: stringValue(fm.id), path, registered: fm.ip_kind === "publication", bodySource, section, body, images,
    topics: stringList(fm["小红书话题"]), account: stringValue(fm["账号"]), originality,
    status: stringValue(fm["状态"]) || "草稿", topic: stringValue(fm["选题"]), mtime, issues, candidates,
    raw: markdown, sourceMarkdown: markdown,
  };
  return publication;
}

export function validatePublication(publication: Publication, context: ValidationContext = {}): Issue[] {
  const issues = [...publication.issues];
  if (!publication.registered) issues.push(issue("not-registered", "请先设为发布作品并确认正文范围。"));
  if (!publication.id.trim()) issues.push(issue("missing-id", "作品缺少稳定 ID，请先保存发布字段。"));
  if (publication.id && context.duplicateIds?.has(publication.id)) issues.push(issue("duplicate-id", "发现重复作品 ID，请为复制的作品生成新 ID 后再准备。"));
  if (!publication.title.trim()) issues.push(issue("missing-title", "请填写发布标题。"));
  if (!publication.bodySource) issues.push(issue("body-source", "请确认正文范围，旧稿不会默认使用整篇内容。"));
  if (publication.bodySource === "section") {
    try { findSection(publication.sourceMarkdown, publication.section); }
    catch (error) { issues.push(issue("body-range", (error as Error).message)); }
  }
  if (!publication.body.trim()) issues.push(issue("missing-body", "发布正文为空。"));
  if (!publication.account.trim()) issues.push(issue("missing-account", "请填写并核对本次使用的账号。"));
  if (!publication.images.length) issues.push(issue("missing-images", "图文作品至少需要一张明确选择的本地图片。"));
  for (const image of publication.images) {
    try { normalizeVaultPath(image); }
    catch { issues.push(issue("unsafe-image", `图片路径不属于知识库内：${image}`)); }
    if (context.missingImages?.has(image)) issues.push(issue("missing-image", `找不到已选图片：${image}`));
    if (context.unreadableImages?.has(image)) issues.push(issue("unreadable-image", `无法读取已选图片：${image}`));
  }
  if (new Set(publication.images).size !== publication.images.length) issues.push(issue("duplicate-image", "图片列表存在重复文件，请保留一次并确认图序。"));
  if (publication.originality === "未确认") issues.push(issue("originality-unconfirmed", "原创声明尚未确认，请在官方编辑器核对；系统不会自动设置。", "warning"));
  issues.push(...toPlatformText(publication.body).issues);
  const unique = new Map<string, Issue>();
  for (const entry of issues) unique.set(`${entry.code}:${entry.message}`, entry);
  return [...unique.values()];
}

export async function hashBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // Copy views to exclude unrelated bytes outside byteOffset/byteLength and satisfy DOM types.
  const value = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(0));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A changed byte at the same path invalidates confirmation just like a title or order edit. */
export async function fingerprint(publication: Pick<Publication, "id" | "title" | "body" | "account" | "topics" | "originality" | "images">, imageVersions: readonly ImageVersion[]): Promise<string> {
  if (imageVersions.length !== publication.images.length || imageVersions.some((image, index) => image.path !== publication.images[index] || !image.hash)) {
    throw new Error("图片版本必须完整，并与本次明确选择的图片顺序一致。");
  }
  return hashBytes(new TextEncoder().encode(JSON.stringify({
    version: 1,
    id: publication.id,
    title: publication.title,
    body: publication.body,
    account: publication.account,
    topics: publication.topics,
    originality: publication.originality,
    images: imageVersions.map((image) => ({ path: image.path, hash: image.hash })),
  })));
}

export function moveImage(images: readonly string[], from: number, to: number): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= images.length || to >= images.length) throw new Error("图片排序位置无效。");
  const result = [...images];
  const [image] = result.splice(from, 1);
  result.splice(to, 0, image);
  return result;
}
