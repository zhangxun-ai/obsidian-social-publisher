import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fingerprint, hashBytes, listSections } from '../src/core';
import { readFrontmatter } from '../src/storage';
import type { PublisherService } from '../src/service';
import type { createMockEnvironment } from './obsidian-mock';

type Environment = ReturnType<typeof createMockEnvironment>;
type Runtime = { PublisherService: typeof PublisherService; createMockEnvironment: typeof createMockEnvironment };

/** Bundle only into the task's synthetic-test output; no actual Vault paths are used. */
const runtime: Promise<Runtime> = (async () => {
  const root = resolve(import.meta.dirname, '..');
  const output = resolve(root, 'output/synthetic-tests/service-runtime.cjs');
  await mkdir(resolve(root, 'output/synthetic-tests'), { recursive: true });
  await build({
    stdin: { contents: `export { PublisherService } from './src/service'; export { createMockEnvironment } from './tests/obsidian-mock';`, resolveDir: root, sourcefile: 'synthetic-service-test-entry.ts' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: output,
    alias: { obsidian: resolve(root, 'tests/obsidian-mock.ts') },
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(output) as Runtime;
})();

// Header-valid synthetic bytes only. No user's media or filesystem participates in these tests.
function png(marker = 1): Uint8Array { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, marker, 0, 1, 2]); }

function seedPublication(env: Environment, name: string, options: { body?: string; image?: boolean; root?: string; id?: string } = {}) {
  const folder = `${options.root ?? '发布'}/${name}`;
  const path = `${folder}/小红书.md`;
  const image = `${folder}/图片/封面.png`;
  const raw = `---
ip_kind: publication
id: ${options.id ?? `synthetic-${name}`}
发布标题: 合成作品${name}
正文来源: whole
图片:
  - "[[${image}]]"
账号: 合成测试账号
平台账号ID: synthetic-account
原创声明: 不声明
小红书话题: [AI工具, 中文话题]
状态: 草稿
---
${options.body ?? '明确对外的合成文案。'}
`;
  env.vault.seedText(path, raw);
  if (options.image !== false) env.vault.seedBytes(image, png());
  return { path, image, raw };
}

async function fixture() {
  const api = await runtime;
  const env = api.createMockEnvironment();
  env.vault.seedFolder('发布');
  env.vault.seedFolder('发布外');
  env.plugin.data = {boundAccount: {platform: 'xiaohongshu', accountId: 'synthetic-account', nickname: '合成测试账号', checkedAt: Date.now()}};
  const service = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await service.load();
  await service.saveSettings({ configured: true, roots: ['发布'], defaultAccount: '合成测试账号', port: 27123 });
  return { ...env, env, service, api };
}

const origin = `chrome-extension://${'a'.repeat(32)}`;
async function paired(service: PublisherService) {
  const port = await service.bridge.start(0);
  async function request(path: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${service.bridge.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  assert.equal((await request('/pair', {})).status, 200);
  return request;
}

test('configured roots bound discovery and writes to exact directory boundaries', async () => {
  const { env, service, vault } = await fixture();
  const inside = seedPublication(env, 'A');
  seedPublication(env, 'B', { root: '发布外' });
  assert.deepEqual((await service.list()).map((pub) => pub.path), [inside.path]);
  assert.ok(vault.reads.every((path) => path.startsWith('发布/')));
  await assert.rejects(service.saveSettings({ ...service.settings, roots: [] }), /至少配置/);
  await assert.rejects(service.saveSettings({ ...service.settings, roots: ['不存在'] }), /创建/);
  await assert.rejects(service.saveSettings({ ...service.settings, roots: ['/私人'] }), /相对路径/);
  await assert.rejects(service.saveSettings({ ...service.settings, port: 80 }), /端口/);
  assert.deepEqual(service.settings.roots, ['发布']);
  const outside = { ...(await service.list())[0], path: '发布外/B/小红书.md' };
  await assert.rejects(service.save(outside), /配置目录/);
});

test('create makes one registered publication folder and local images folder without modifying existing notes', async () => {
  const { service, vault } = await fixture();
  const original = '研究原稿，保持原位。';
  vault.seedText('发布/既有研究.md', original);
  const created = await service.create('新的合成主题');
  assert.match(created.path, /^发布\/P\d+-新的合成主题\/小红书\.md$/);
  assert.equal(created.registered, true);
  assert.ok(created.id);
  assert.equal(created.bodySource, 'whole');
  assert.equal(created.account, '合成测试账号');
  assert.equal(created.originality, '未确认');
  assert.equal(created.images.length, 0);
  assert.ok(vault.getAbstractFileByPath(created.path.replace('/小红书.md', '/图片')));
  assert.equal(vault.text('发布/既有研究.md'), original);
  assert.equal(vault.getMarkdownFiles().length, 2);
});

test('registering and saving an old section preserves unknown YAML values, comments, and other sections', async () => {
  const { service, vault } = await fixture();
  const path = '发布/旧稿.md';
  const original = `---
# synthetic preservation comment
custom:
  nested: [one, two]
  quoted: "keep quoted"
选题: "[[选题/合成选题]]"
---
# 研究
未选研究，保留。\n
## 发布正文
旧的公开文案。\n
## 复盘
未选复盘，保留。\n`;
  vault.seedText(path, original);
  const pub = (await service.list())[0];
  assert.equal(pub.bodySource, '');
  const section = listSections(original).find((entry) => entry.heading === '发布正文')!;
  pub.bodySource = 'section'; pub.section = section.key; pub.body = '新的公开文案。'; pub.title = '更新发布标题';
  pub.account = '合成测试账号'; pub.originality = '不声明';
  const saved = await service.save(pub);
  const result = vault.text(path);
  assert.ok(saved.id);
  assert.equal(saved.registered, true);
  assert.deepEqual(readFrontmatter(result).custom, readFrontmatter(original).custom);
  assert.equal(readFrontmatter(result).选题, '[[选题/合成选题]]');
  assert.match(result, /# synthetic preservation comment/);
  assert.equal(result.slice(result.indexOf('# 研究'), result.indexOf('## 发布正文')), original.slice(original.indexOf('# 研究'), original.indexOf('## 发布正文')));
  assert.equal(result.slice(result.indexOf('## 复盘')), original.slice(original.indexOf('## 复盘')));
  assert.equal(saved.body, '新的公开文案。');
  assert.equal(saved.id, (await service.save({ ...saved, title: '再次编辑' })).id);
});

test('saving a stale editor fails atomically and preserves a concurrent source edit', async () => {
  const { env, service, vault } = await fixture();
  const item = seedPublication(env, 'A');
  const old = (await service.list())[0];
  const current = item.raw.replace('状态: 草稿', '状态: 草稿\nconcurrent: keep-current');
  vault.seedText(item.path, current);
  await assert.rejects(service.save({ ...old, body: '旧窗口的新正文' }), /源文件已变更/);
  assert.equal(vault.text(item.path), current);
});

test('YAML documents ended with three dots preserve their unknown properties when registered', async () => {
  const { service, vault } = await fixture();
  const path = '发布/三点结束属性.md';
  vault.seedText(path, '---\ncustom: preserve-this\n...\n对外的合成正文。\n');
  const pub = (await service.list())[0];
  pub.bodySource = 'whole'; pub.body = '更新后的合成正文。'; pub.account = '合成账号';
  const saved = await service.save(pub);
  const raw = vault.text(path);
  assert.equal(readFrontmatter(raw).custom, 'preserve-this');
  assert.equal(saved.body, '更新后的合成正文。');
  assert.equal((raw.match(/^---$/gm) ?? []).length, 2);
});

test('inspect returns blocking missing/unreadable image issues instead of throwing fingerprint errors', async () => {
  const { env, service, vault } = await fixture();
  const missing = seedPublication(env, 'missing', { image: false });
  const preview = await service.inspect(missing.path);
  assert.match(preview.fingerprint, /^[a-f\d]{64}$/);
  assert.ok(preview.issues.some((entry) => entry.severity === 'error' && entry.code === 'missing_image'));
  assert.ok(preview.issues.some((entry) => entry.severity === 'error' && entry.code === 'unreadable_image'));
  const invalid = seedPublication(env, 'invalid');
  vault.seedBytes(invalid.image, new Uint8Array([1, 2, 3]));
  assert.ok((await service.inspect(invalid.path)).issues.some((entry) => entry.code === 'unreadable_image'));
});

test('inspect fingerprint matches exact content and image bytes; same-path byte replacement invalidates approval', async () => {
  const { env, service, vault } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  assert.equal(preview.fingerprint, await fingerprint(preview.publication, [{ path: item.image, hash: await hashBytes(png()) }]));
  assert.deepEqual(preview.issues.filter((entry) => entry.severity === 'error'), []);
  assert.match(preview.text, /#AI工具 #中文话题/);
  vault.seedBytes(item.image, png(9));
  await assert.rejects(service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]), /已变化/);
  assert.deepEqual(service.records(), []);
});

test('a source edit during final image reading cannot become a prepared stale snapshot', async () => {
  const { env, service, vault } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  let reads = 0;
  vault.beforeReadBinary = () => {
    reads += 1;
    // This is the last inspect's image read, after its Markdown body has been loaded.
    if (reads === 3) vault.seedText(item.path, item.raw.replace('明确对外的合成文案。', '读取期间已经改动的公开正文。'));
  };
  await assert.rejects(service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]), /变化|重新/);
  assert.deepEqual(service.records(), []);
});

test('an earlier item changed while a later batch item is being read invalidates the entire batch', async () => {
  const { env, service, vault } = await fixture();
  const one = seedPublication(env, 'one');
  const two = seedPublication(env, 'two');
  const first = await service.inspect(one.path);
  const second = await service.inspect(two.path);
  let laterReads = 0;
  vault.beforeReadBinary = (path) => {
    if (path === two.image && ++laterReads === 2) vault.seedText(one.path, one.raw.replace('明确对外的合成文案。', '准备第二篇时第一篇已经变化。'));
  };
  await assert.rejects(service.prepare([{ path: one.path, fingerprint: first.fingerprint }, { path: two.path, fingerprint: second.fingerprint }]), /变化|重新/);
  assert.deepEqual(service.records(), []);
});

test('batch validation is atomic and sequential repeated preparation is rejected', async () => {
  const { env, service } = await fixture();
  const good = seedPublication(env, 'good');
  const bad = seedPublication(env, 'bad', { image: false });
  const goodPreview = await service.inspect(good.path);
  const badPreview = await service.inspect(bad.path);
  const approval = { path: good.path, fingerprint: goodPreview.fingerprint };
  await assert.rejects(service.prepare([approval, { path: bad.path, fingerprint: badPreview.fingerprint }]), /阻断/);
  assert.deepEqual(service.records(), []);
  await assert.rejects(service.prepare([approval, approval]), /重复/);
  assert.deepEqual(service.records(), []);
  await service.prepare([approval]);
  assert.equal(service.records().length, 1);
  await assert.rejects(service.prepare([approval]), /待处理/);
  assert.equal(service.records().length, 1);
});

test('simultaneous preparation of the same publication creates at most one pending task', async () => {
  const { env, service } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  const approvals = [{ path: item.path, fingerprint: preview.fingerprint }];
  const results = await Promise.allSettled([service.prepare(approvals), service.prepare(approvals)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(service.records().length, 1);
});

test('plugin restart invalidates prepared work, preserves history, and exposes no automatic resend', async (context) => {
  const { api, env, service, plugin } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  await service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]);
  const record = service.records()[0];
  const saved = structuredClone(plugin.data);
  const restarted = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await restarted.load();
  assert.equal(restarted.records()[0].status, '需重新准备');
  assert.equal(restarted.records()[0].fingerprint, record.fingerprint);
  assert.deepEqual(plugin.data, saved);
  const request = await paired(restarted);
  context.after(async () => { await restarted.dispose(); });
  assert.deepEqual((await (await request('/jobs')).json()).jobs, []);
  assert.equal((await request('/claim', { taskId: record.id, accountId: 'synthetic-account' })).status, 409);
});

test('stopping queued work does not cancel a claimed editor or unlock it before acknowledgement', async (context) => {
  const { env, service } = await fixture();
  const one = seedPublication(env, 'one');
  const two = seedPublication(env, 'two');
  const first = await service.inspect(one.path);
  const second = await service.inspect(two.path);
  await service.prepare([{ path: one.path, fingerprint: first.fingerprint }, { path: two.path, fingerprint: second.fingerprint }]);
  const records = service.records();
  const id1 = records.find((record) => record.path === one.path)!.id;
  const id2 = records.find((record) => record.path === two.path)!.id;
  const request = await paired(service);
  context.after(async () => { await service.dispose(); });
  assert.equal((await request('/claim', { taskId: id1, accountId: 'synthetic-account' })).status, 200);
  assert.equal(service.records().find((record) => record.id === id1)!.status, '正在填写');
  await assert.rejects(service.cancel(id1), /正在填写/);
  await service.cancel(id2);
  assert.equal(service.records().find((record) => record.id === id2)!.status, '已取消');
  assert.equal((await request('/result', { taskId: id1, status: '待人工确认', detail: '合成官方编辑器已填写，未发布。' })).status, 200);
  assert.equal(service.records().find((record) => record.id === id1)!.status, '待人工确认');
  assert.equal((await (await request('/status')).json()).activeTaskId, id1);
  service.acknowledge(id1);
  assert.equal((await (await request('/status')).json()).activeTaskId, null);
  assert.deepEqual((await (await request('/jobs')).json()).jobs, []);
  assert.equal((await request('/claim', { taskId: id1, accountId: 'synthetic-account' })).status, 409);
});

test('disconnect and plugin restart preserve unknown claimed results without requeueing acknowledged work', async (context) => {
  const { api, env, service } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  await service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]);
  const id = service.records()[0].id;
  const request = await paired(service);
  assert.equal((await request('/claim', { taskId: id, accountId: 'synthetic-account' })).status, 200);
  await service.disconnect();
  assert.equal(service.records()[0].status, '结果待核实');
  const restarted = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await restarted.load();
  assert.equal(restarted.records()[0].status, '结果待核实');
  const reconnect = await paired(restarted);
  context.after(async () => { await restarted.dispose(); });
  assert.deepEqual((await (await reconnect('/jobs')).json()).jobs, []);
  assert.equal((await reconnect('/claim', { taskId: id, accountId: 'synthetic-account' })).status, 409);
});

test('load maps interrupted claim to unknown result and retains acknowledged/manual/cancelled history states', async () => {
  const { api, env, plugin } = await fixture();
  const statuses = ['已准备', '正在填写', '待人工确认', '结果待核实', '已取消', '失败'] as const;
  plugin.data = { settings: { configured: true, roots: ['发布'], defaultAccount: '合成账号', port: 27123 }, records: statuses.map((status, index) => ({ id: `synthetic-${index}`, path: `发布/${index}.md`, status, detail: '合成历史', title: '合成作品', account: '合成账号', imageCount: 1, fingerprint: 'synthetic', createdAt: index, updatedAt: index })) };
  const restored = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await restored.load();
  const byId = new Map(restored.records().map((record) => [record.id, record.status]));
  assert.equal(byId.get('synthetic-0'), '需重新准备');
  assert.equal(byId.get('synthetic-1'), '结果待核实');
  for (let index = 2; index < statuses.length; index += 1) assert.equal(byId.get(`synthetic-${index}`), statuses[index]);
});

test('manual acknowledgement survives restart and allows a newly reviewed version without replaying the old task', async (context) => {
  const { api, env, service } = await fixture();
  const item = seedPublication(env, 'A');
  const preview = await service.inspect(item.path);
  await service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]);
  const oldId = service.records()[0].id;
  const request = await paired(service);
  assert.equal((await request('/claim', { taskId: oldId, accountId: 'synthetic-account' })).status, 200);
  assert.equal((await request('/result', { taskId: oldId, status: '待人工确认', detail: '合成填写完成，人工核对。' })).status, 200);
  service.acknowledge(oldId);
  await service.disconnect();
  assert.equal(service.records()[0].closed, true);
  assert.equal(service.records()[0].status, '待人工确认');
  const restarted = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await restarted.load();
  assert.equal(restarted.records()[0].closed, true);
  const current = await restarted.inspect(item.path);
  await restarted.prepare([{ path: item.path, fingerprint: current.fingerprint }]);
  const reconnect = await paired(restarted);
  context.after(async () => { await restarted.dispose(); });
  const queued = (await (await reconnect('/jobs')).json()).jobs;
  assert.equal(queued.length, 1);
  assert.notEqual(queued[0].id, oldId);
  assert.equal((await reconnect('/claim', { taskId: oldId, accountId: 'synthetic-account' })).status, 409);
});

test('content and same-path image changes after preparation are stopped before bridge transmission', async () => {
  for (const change of ['body', 'image'] as const) {
    const { env, service, vault } = await fixture();
    const item = seedPublication(env, 'A');
    const preview = await service.inspect(item.path);
    await service.prepare([{ path: item.path, fingerprint: preview.fingerprint }]);
    const id = service.records()[0].id;
    if (change === 'body') vault.seedText(item.path, item.raw.replace('明确对外的合成文案。', '准备后已变化的正文。'));
    else vault.seedBytes(item.image, png(9));
    const request = await paired(service);
    try {
      assert.equal((await request('/claim', { taskId: id, accountId: 'synthetic-account' })).status, 409);
      assert.equal(service.records()[0].status, '结果待核实');
      assert.deepEqual((await (await request('/jobs')).json()).jobs, []);
      assert.equal((await request(`/media/${id}/0`)).status, 409);
    } finally { await service.dispose(); }
  }
});

async function detect(service: PublisherService, request: Awaited<ReturnType<typeof paired>>, status: 'recognized' | 'logged-out' | 'unknown' = 'recognized', accountId = 'synthetic-account') {
  await service.requestAccountDetection();
  const {request: detectionRequest} = await (await request('/account-request', {})).json();
  assert.ok(detectionRequest);
  const report = status === 'recognized' ? {requestId: detectionRequest.requestId, status, accountId, nickname: '合成测试账号'} : {requestId: detectionRequest.requestId, status};
  assert.equal((await request('/account-result', report)).status, 200);
  return detectionRequest.requestId as string;
}

test('recognized browser identity requires explicit fresh confirmation and persists only public binding metadata', async (t) => {
  const {api, env, service, plugin} = await fixture();
  await service.unbindAccount();
  await assert.rejects(service.requestAccountDetection(), /连接/);
  const request = await paired(service);
  t.after(() => service.dispose());
  const requestId = await detect(service, request);
  assert.equal(service.accountState().binding, null);
  assert.equal(plugin.data?.boundAccount, null);
  assert.equal(service.accountState().detection?.status, 'recognized');
  await assert.rejects(service.bindAccount('previous-dialog'), /重新检测/);
  await service.bindAccount(requestId);
  const binding = service.accountState().binding!;
  assert.deepEqual(Object.keys(binding).sort(), ['accountId', 'checkedAt', 'nickname', 'platform']);
  assert.equal(binding.accountId, 'synthetic-account');
  assert.deepEqual(plugin.data?.boundAccount, binding);
  const restarted = new api.PublisherService(env.app, env.pluginApi, env.notice);
  await restarted.load();
  assert.deepEqual(restarted.accountState().binding, binding);
  assert.equal(restarted.accountState().detection, null);
  assert.equal(restarted.accountState().connected, false);
});

test('new requests, expiration, unknown results and disconnection cannot bind an old detected identity', async (t) => {
  const {service} = await fixture();
  const request = await paired(service);
  t.after(() => service.dispose());
  const original = await detect(service, request);
  await service.requestAccountDetection();
  await assert.rejects(service.bindAccount(original), /重新检测/);
  assert.equal((await request('/account-result', {requestId: original, status: 'logged-out'})).status, 409);
  const unknown = await detect(service, request, 'unknown');
  await assert.rejects(service.bindAccount(unknown), /重新检测/);
  const recognized = await detect(service, request);
  const realNow = Date.now;
  try {
    const now = realNow(); Date.now = () => now + 120_001;
    assert.equal(service.accountState().detection?.status, 'unknown');
    assert.equal(service.accountState().detection?.account, undefined);
    await assert.rejects(service.bindAccount(recognized), /重新检测/);
  } finally { Date.now = realNow; }
  const reconnectId = await detect(service, request);
  await service.disconnect();
  assert.equal(service.accountState().detection, null);
  await assert.rejects(service.bindAccount(reconnectId), /重新检测/);
});

test('legacy account labels stay intact but do not grant a bound identity or a fill task', async () => {
  const {env, service, vault} = await fixture();
  const item = seedPublication(env, 'legacy');
  vault.seedText(item.path, item.raw.replace('平台账号ID: synthetic-account\n', ''));
  const preview = await service.inspect(item.path);
  assert.equal(preview.publication.account, '合成测试账号');
  assert.equal(preview.publication.accountId, '');
  assert.ok(preview.issues.some(issue => issue.code === 'account-not-bound'));
  await assert.rejects(service.prepare([{path: item.path, fingerprint: preview.fingerprint}]), /阻断/);
  await service.save({...preview.publication, title: '仍可编辑旧笔记'});
  assert.equal(readFrontmatter(vault.text(item.path)).账号, '合成测试账号');
});

test('wrong actual account and rebinding stop a task before transmission', async (t) => {
  const {env, service} = await fixture();
  const item = seedPublication(env, 'identity');
  const preview = await service.inspect(item.path);
  await service.prepare([{path: item.path, fingerprint: preview.fingerprint}]);
  const id = service.records()[0].id;
  const request = await paired(service);
  t.after(() => service.dispose());
  assert.equal((await request('/claim', {taskId: id, accountId: 'another-account'})).status, 409);
  assert.equal(service.records()[0].status, '已准备');
  await detect(service, request, 'logged-out');
  assert.equal((await request('/claim', {taskId: id, accountId: 'another-account'})).status, 409);
  await detect(service, request, 'unknown');
  assert.equal((await request('/claim', {taskId: id, accountId: 'another-account'})).status, 409);
  const detectionId = await detect(service, request, 'recognized', 'replacement-account');
  await service.bindAccount(detectionId);
  assert.equal((await request('/claim', {taskId: id, accountId: 'replacement-account'})).status, 409);
  assert.equal((await request(`/media/${id}/0`, {})).status, 409);
  assert.ok((await service.inspect(item.path)).issues.some(issue => issue.code === 'account-not-bound'));
});

test('unbinding during a claimed task blocks remaining image transfer without releasing the serial task lock', async (t) => {
  const {env, service} = await fixture();
  const item = seedPublication(env, 'claimed-identity');
  const preview = await service.inspect(item.path);
  await service.prepare([{path: item.path, fingerprint: preview.fingerprint}]);
  const id = service.records()[0].id;
  const request = await paired(service);
  t.after(() => service.dispose());
  assert.equal((await request('/claim', {taskId: id, accountId: 'synthetic-account'})).status, 200);
  await service.unbindAccount();
  assert.equal((await request(`/media/${id}/0`, {})).status, 409);
  assert.equal((await (await request('/status')).json()).activeTaskId, id);
});

test('public account ID is stored in Markdown and changes the reviewed fingerprint independently of nickname', async () => {
  const {env, service, vault} = await fixture();
  const item = seedPublication(env, 'fingerprint-identity');
  const preview = await service.inspect(item.path);
  const changed = {...preview.publication, accountId: 'another-account'};
  const imageVersions = [{path: item.image, hash: await hashBytes(png())}];
  assert.notEqual(await fingerprint(changed, imageVersions), preview.fingerprint);
  const edited = await service.save(changed);
  assert.equal(edited.accountId, 'another-account');
  assert.ok((await service.inspect(item.path)).issues.some(issue => issue.code === 'account-not-bound'));
  const saved = await service.save({...edited, accountId: 'synthetic-account', title: '更新标题'});
  assert.equal(saved.accountId, 'synthetic-account');
  assert.equal(readFrontmatter(vault.text(item.path)).平台账号ID, 'synthetic-account');
});

test('extension pairing and disconnect emit observable connection changes and invalidate pending account requests', async (t) => {
  const {service} = await fixture();
  let updates = 0;
  service.subscribe(() => { updates += 1; });
  const request = await paired(service);
  t.after(() => service.dispose());
  assert.ok(updates >= 2);
  assert.equal(service.accountState().paired, true);
  await service.requestAccountDetection();
  const oldNonce = service.accountState().detection!.requestId;
  await service.bridge.stop();
  assert.equal(service.accountState().detection, null);
  assert.equal(service.accountState().paired, false);
  await paired(service);
  assert.equal(service.accountState().detection, null);
  assert.notEqual(service.accountState().detection?.requestId, oldNonce);
});

test('a fresh matching DOM identity can claim after display detection expired, and old account metadata remains editable after unbinding', async (t) => {
  const {env, service} = await fixture();
  const item = seedPublication(env, 'expired-display');
  const preview = await service.inspect(item.path);
  await service.prepare([{path: item.path, fingerprint: preview.fingerprint}]);
  const id = service.records()[0].id;
  const request = await paired(service);
  t.after(() => service.dispose());
  await detect(service, request, 'unknown');
  // /claim actualAccountId is read afresh by the trusted paired extension; cached display status never substitutes for it.
  assert.equal((await request('/claim', {taskId: id, accountId: 'synthetic-account'})).status, 200);
  await service.unbindAccount();
  const saved = await service.save({...preview.publication, body: '解绑后仍可修改文案。'});
  assert.equal(saved.accountId, 'synthetic-account');
  assert.equal(saved.body, '解绑后仍可修改文案。');
  assert.ok((await service.inspect(item.path)).issues.some(issue => issue.code === 'account-not-bound'));
});
