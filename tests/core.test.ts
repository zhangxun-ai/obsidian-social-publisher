import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBody, extractImageReferences, fingerprint, hashBytes, listSections,
  moveImage, normalizeImageReference, normalizeVaultPath, parsePublication,
  replaceBody, selectedInFilter, toPlatformText, validatePublication, withinScope,
} from "../src/core";
import type { Publication } from "../src/types";

const source = `---
ip_kind: publication
id: synthetic-001
custom:
  keep: "do not touch"
---
# 选题论证
这是未选择的研究记录。

## 发布正文
**正文**第一段。#AI工具

### 小节
保留这个子章节。

## 复盘
这是未选择的复盘记录。
`;

function sample(overrides: Partial<Publication> = {}): Publication {
  const markdown = "清晰的合成正文。\n\n#AI工具 #中文话题";
  return {
    ...parsePublication("发布/P001/小红书.md", markdown, {
      ip_kind: "publication", id: "synthetic-001", 发布标题: "合成作品", 正文来源: "whole",
      图片: ["发布/P001/图片/封面.png", "发布/P001/图片/01.png"], 小红书话题: ["#AI工具", "中文话题"],
      账号: "合成账号", 原创声明: "不声明",
    }, 1),
    ...overrides,
  };
}

test("selected sections include descendants but exclude peer headings and frontmatter", () => {
  const sections = listSections(source);
  const selected = sections.find((section) => section.heading === "发布正文")!;
  assert.equal(selected.level, 2);
  const body = extractBody(source, "section", selected.key);
  assert.match(body, /正文.*第一段/);
  assert.match(body, /### 小节/);
  assert.doesNotMatch(body, /do not touch|研究记录|复盘记录/);
  assert.equal(extractBody(source, "section", "发布正文"), body);
});

test("editing a section preserves YAML bytes and every unselected section", () => {
  const section = listSections(source).find((entry) => entry.heading === "发布正文")!;
  const changed = replaceBody(source, "section", section.key, "新的正文。\n\n#AI工具");
  assert.equal(changed.slice(0, section.bodyStart), source.slice(0, section.bodyStart));
  assert.equal(changed.slice(changed.indexOf("## 复盘")), source.slice(source.indexOf("## 复盘")));
  assert.equal(extractBody(changed, "section", section.key), "新的正文。\n\n#AI工具");
  assert.throws(() => replaceBody(source, "section", section.key, "## 新的同级章节\n正文"), /章节边界/);
});

test("whole-body replacement preserves the original BOM/YAML/CRLF header", () => {
  const raw = "\uFEFF---\r\nunknown: 'keep exactly'\r\n---\r\n旧正文\r\n";
  assert.equal(extractBody(raw, "whole"), "旧正文");
  assert.equal(replaceBody(raw, "whole", "", "新正文\n下一行"), "\uFEFF---\r\nunknown: 'keep exactly'\r\n---\r\n新正文\r\n下一行");
});

test("old manuscripts never default to publishing the whole note", () => {
  const publication = parsePublication("发布/旧稿.md", source, {}, 1);
  assert.equal(publication.bodySource, "");
  assert.equal(publication.body, "");
  assert.equal(publication.registered, false);
  assert.ok(validatePublication(publication).some((entry) => entry.code === "body-source"));
  assert.throws(() => extractBody(source, ""), /尚未确认/);
  assert.throws(() => replaceBody(source, "", "", "new"), /明确正文/);
});

test("missing or ambiguous sections and unfinished YAML fail safely", () => {
  assert.throws(() => extractBody(source, "section", "不存在"), /不存在/);
  const repeated = "## 正文\n第一篇\n## 正文\n第二篇";
  assert.throws(() => extractBody(repeated, "section", "正文"), /多个同名/);
  const entries = listSections(repeated);
  assert.notEqual(entries[0].key, entries[1].key);
  assert.equal(extractBody(repeated, "section", entries[1].key), "第二篇");
  assert.throws(() => extractBody("---\nprivate: yes\n正文", "whole"), /没有结束标记/);
  assert.equal(toPlatformText("---\nprivate: yes\n正文").text, "");
});

test("headings inside fenced code do not define selectable sections", () => {
  const raw = "## 正文\n有效内容\n```md\n## 私人标题样例\n```\n## 复盘\n私密";
  assert.deepEqual(listSections(raw).map((entry) => entry.heading), ["正文", "复盘"]);
  assert.match(extractBody(raw, "section", "正文"), /私人标题样例/);
  assert.ok(toPlatformText(extractBody(raw, "section", "正文")).issues.some((entry) => entry.code === "code-block"));
});

test("setext headings have correct boundaries and can be replaced", () => {
  const raw = "正文\n----\n可公开段落\n\n复盘\n----\n私密记录";
  assert.deepEqual(listSections(raw).map((entry) => entry.heading), ["正文", "复盘"]);
  const changed = replaceBody(raw, "section", "正文", "替换后的正文");
  assert.match(changed, /^正文\n----\n/);
  assert.match(changed, /复盘\n----\n私密记录$/);
});

test("local image candidates support Unicode, spaces, encoded names and balanced parentheses", () => {
  const raw = `![[图片/中文 封面.png|640]]
![配图](<图片/中文 空格.png>)
![配图](图片/第二 张(新版).png "配图说明")
![配图](图片/%E4%B8%AD%E6%96%87.png)
![[图片/中文 封面.png]]
![[研究笔记]]
![remote](https://example.com/private.png)`;
  assert.deepEqual(extractImageReferences(raw), ["图片/中文 封面.png", "图片/中文 空格.png", "图片/第二 张(新版).png", "图片/中文.png"]);
  assert.equal(normalizeImageReference("![[图片/封面.png|320]]"), "图片/封面.png");
});

test("only explicit metadata images are selected; cover is first and deduplicated", () => {
  const raw = "正文\n![[候选.png]]";
  const publication = parsePublication("发布/合成.md", raw, {
    ip_kind: "publication", id: "id", 正文来源: "whole", 封面: "[[发布/封面.png]]",
    图片: ["[[发布/01.png]]", "[[发布/封面.png]]"],
  }, 1);
  assert.deepEqual(publication.images, ["发布/封面.png", "发布/01.png"]);
  assert.deepEqual(publication.candidates, ["候选.png"]);
  assert.ok(!publication.images.includes("候选.png"));
  assert.equal(publication.raw, raw);
  assert.equal(publication.sourceMarkdown, raw);
});

test("plain text conversion preserves topics, spacing, punctuation, list order and external URLs", () => {
  const raw = "---\nsecret: keep\n---\n# 发布标题\n\n**加粗**，*重点*，`行内代码`。\n\n1. 第一步\n2. 第二步\n\n[公开链接](https://example.com/a)\n\n#AI工具 #中文话题\n\n\\#字面井号\n\n![[图片/封面.png]]";
  const result = toPlatformText(raw);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'embedded-images');
  assert.equal(result.issues[0].severity, 'warning');
  assert.equal(result.text, "发布标题\n\n加粗，重点，行内代码。\n\n1. 第一步\n2. 第二步\n\n公开链接（https://example.com/a）\n\n#AI工具 #中文话题\n\n#字面井号");
  assert.doesNotMatch(result.text, /secret|封面/);
});

test("unsupported or private structures block conversion and never return partial publishable text", () => {
  const examples = [
    ["internal-link", "公开段落\n[[私人研究|可见别名]]"],
    ["internal-link", "公开段落\n![[私人研究]]"],
    ["code-block", "公开段落\n```txt\n私人token\n```"],
    ["html", "公开段落\n<div style='display:none'>私人记录</div>"],
    ["html", "公开段落\n<!-- 未结束的私人备注"],
    ["table", "| 对象 | 备注 |\n| --- | --- |\n| 内部 | 私人 |"],
    ["table", "| 内容 |\n| - |\n| 私人 |"],
    ["obsidian-comment", "公开段落 %%私人复盘%%"],
    ["callout", "> [!note]\n> 私人研究"],
    ["reference-link", "![图片][private]\n[private]: attachment.png"],
    ["footnote", "注释[^1]\n[^1]: 私人信息"],
    ["math", "数学公式 $x$"],
    ["remote-image", "![remote](https://example.com/private.png)"],
    ["local-link", "[私人资料](研究/私人.md)"],
    ["unsupported-image", "![内部嵌入](研究/私人.md)"],
    ["block-id", "公开段落 ^private-anchor"],
    ["inline-query", "动态内容 `=this.private`"],
  ];
  for (const [code, raw] of examples) {
    const result = toPlatformText(raw);
    assert.equal(result.text, "", code);
    assert.ok(result.issues.some((entry) => entry.code === code), `${code}: ${JSON.stringify(result.issues)}`);
  }
});

test("body extraction preserves indentation so an initial code block cannot bypass validation", () => {
  const raw = "\n    私人代码样例\n\n";
  const body = extractBody(raw, "whole");
  assert.equal(body, "    私人代码样例");
  assert.equal(toPlatformText(body).text, "");
  assert.ok(toPlatformText(body).issues.some((entry) => entry.code === "code-block"));
});

test("scopes use directory boundaries and disallow root, absolute paths and traversal escapes", () => {
  assert.equal(normalizeVaultPath("发布/./作品/../封面.png"), "发布/封面.png");
  assert.equal(withinScope("02-项目/内容IP变现/发布/稿.md", "02-项目/内容IP变现"), true);
  assert.equal(withinScope("02-项目/内容IP变现副本/稿.md", "02-项目/内容IP变现"), false);
  assert.equal(withinScope("02-项目/内容IP变现/../../私人/稿.md", "02-项目/内容IP变现"), false);
  assert.equal(withinScope("/Users/example/私人.md", "02-项目"), false);
  assert.equal(withinScope("发布/稿.md", ""), false);
  for (const path of ["", "/", "../secret", "C:\\secret.png", "https://example.com/x", "路径\u0000.png"]) assert.throws(() => normalizeVaultPath(path));
});

test("execution selection is always the intersection with current filter; no selection means no work", () => {
  const filtered = [{ path: "a.md" }, { path: "b.md" }];
  assert.deepEqual(selectedInFilter(filtered, new Set(["b.md", "hidden.md"])), [{ path: "b.md" }]);
  assert.deepEqual(selectedInFilter(filtered, new Set()), []);
});

test("validation blocks invalid data and warns about originality that needs official-editor confirmation", () => {
  assert.deepEqual(validatePublication(sample()), []);
  const pub = sample({ originality: "未确认" });
  const codes = validatePublication(pub, {
    duplicateIds: new Set([pub.id]), missingImages: new Set([pub.images[0]]), unreadableImages: new Set([pub.images[1]]),
  }).map((entry) => entry.code);
  for (const code of ["duplicate-id", "missing-image", "unreadable-image", "originality-unconfirmed"]) assert.ok(codes.includes(code));
  assert.equal(validatePublication(pub).find(entry => entry.code === 'originality-unconfirmed')?.severity, 'warning');
  assert.ok(validatePublication(sample({ images: ["../secret.png"] })).some((entry) => entry.code === "unsafe-image"));
});

test("image reordering is immutable, makes the first image cover and rejects invalid indices", () => {
  const images = ["封面.png", "01.png", "02.png"];
  assert.deepEqual(moveImage(images, 2, 0), ["02.png", "封面.png", "01.png"]);
  assert.deepEqual(images, ["封面.png", "01.png", "02.png"]);
  assert.throws(() => moveImage(images, -1, 1));
});

test("confirmation fingerprint covers text, account, topics, originality, image order and same-path byte changes", async () => {
  const pub = sample();
  const versions = [{ path: pub.images[0], hash: await hashBytes(new Uint8Array([1, 2])) }, { path: pub.images[1], hash: await hashBytes(new Uint8Array([3, 4])) }];
  const original = await fingerprint(pub, versions);
  assert.match(original, /^[a-f\d]{64}$/);
  assert.equal(await fingerprint(pub, versions), original);
  for (const changed of [
    { title: "另一个标题" }, { body: "另一个正文" }, { account: "另一个账号" },
    { topics: ["另一个话题"] }, { originality: "声明原创" as const },
  ]) assert.notEqual(await fingerprint({ ...pub, ...changed }, versions), original);
  assert.notEqual(await fingerprint({ ...pub, images: [...pub.images].reverse() }, [...versions].reverse()), original);
  assert.notEqual(await fingerprint(pub, [{ ...versions[0], hash: await hashBytes(new Uint8Array([9, 2])) }, versions[1]]), original);
  await assert.rejects(fingerprint(pub, versions.slice(0, 1)), /图片版本必须完整/);
  await assert.rejects(fingerprint(pub, [...versions].reverse()), /顺序一致/);
});

test("hashing a byte view excludes bytes outside the view", async () => {
  const bytes = new Uint8Array([0, 1, 2, 0]);
  assert.equal(await hashBytes(bytes.subarray(1, 3)), await hashBytes(new Uint8Array([1, 2])));
});
