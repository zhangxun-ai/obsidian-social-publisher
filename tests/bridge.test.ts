import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { LocalBridge, type BridgeJob, type BridgeProvider } from '../src/bridge.ts';

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const OTHER_ORIGIN = `chrome-extension://${'b'.repeat(32)}`;
const rawHostStatus = (port: number, host: string, token: string) => new Promise<number>((resolve, reject) => {
  const request = httpRequest({ hostname: '127.0.0.1', port, path: '/pair', method: 'POST',
    headers: { Host: host, Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (response) => {
    response.resume();
    response.on('end', () => resolve(response.statusCode!));
  });
  request.on('error', reject);
  request.end('{}');
});
const makeJob = (id = 'task_1'): BridgeJob => ({
  id, title: '合成标题', account: '合成账号', text: '第一行\n\n第二行 #测试话题',
  topics: ['测试话题'], originality: '未确认', images: [
    { name: '封面.png', mime: 'image/png', data: Buffer.from('synthetic-cover') },
    { name: '02.png', mime: 'image/png', data: Buffer.from('synthetic-second') },
  ],
});

async function fixture(overrides: Partial<BridgeProvider> = {}) {
  const source = makeJob();
  const reports: unknown[][] = [];
  let validations = 0;
  const bridge = new LocalBridge({
    listJobs: () => [{ id: source.id, title: source.title, account: source.account, imageCount: source.images.length,
      text: 'must-not-leak', path: '/private/must-not-leak' }],
    claimJob: (id) => ({ ...source, id }), validateJob: () => { validations += 1; },
    report: (...args) => { reports.push(args); }, ...overrides,
  });
  const port = await bridge.start(0);
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}, method?: string) =>
    fetch(`http://127.0.0.1:${bridge.port ?? port}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Origin: ORIGIN, Authorization: `Bearer ${bridge.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const pair = () => call('/pair', {});
  return { bridge, source, reports, port, call, pair, validations: () => validations };
}

test('bridge is opt-in, pairs one extension, rejects web origins, wrong tokens and host rebinding', async (t) => {
  const dormant = new LocalBridge({ listJobs: () => [], claimJob: () => makeJob(), validateJob: () => {}, report: () => {} });
  assert.equal(dormant.running, false);
  assert.equal(dormant.token, '');
  assert.equal(dormant.port, null);
  const f = await fixture();
  t.after(() => f.bridge.stop());
  assert.match(f.bridge.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.call('/jobs')).status, 403);
  assert.equal((await f.call('/pair', {}, { Origin: 'https://creator.xiaohongshu.com' })).status, 403);
  assert.equal((await f.call('/pair', {}, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal(await rawHostStatus(f.port, `localhost:${f.port}`, f.bridge.token), 403);
  assert.equal(await rawHostStatus(f.port, `evil.example:${f.port}`, f.bridge.token), 403);
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/status`)).status, 403);
  assert.equal((await f.pair()).status, 200);
  assert.equal(f.bridge.pairedExtensionId, 'a'.repeat(32));
  assert.equal((await f.call('/status', undefined, { Origin: OTHER_ORIGIN })).status, 403);
  assert.equal((await f.call('/pair', {}, { Origin: OTHER_ORIGIN })).status, 403);
  assert.equal((await f.call('/status')).headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await f.call('/status')).headers.get('Cache-Control'), 'no-store');
});

test('concurrent pairing cannot replace the first paired extension', async (t) => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  const results = await Promise.all([f.pair(), f.call('/pair', {}, { Origin: OTHER_ORIGIN })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
});

test('API rejects oversized, unknown, non-JSON and unsupported requests', async (t) => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  await f.pair();
  assert.equal((await f.call('/claim', { taskId: 'a'.repeat(5000) })).status, 413);
  assert.equal((await f.call('/claim', { taskId: 'task_1' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.call('/claim', { taskId: '../private' })).status, 400);
  assert.equal((await f.call('/claim', { taskId: 'task_1', file: '/private/secret' })).status, 400);
  assert.equal((await f.call('/files/private')).status, 404);
  assert.equal((await f.call('/status?file=private')).status, 400);
  assert.equal((await f.call('/status', {}, {}, 'PUT')).status, 405);
  const preflight = await f.call('/claim', undefined, {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
  }, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await f.call('/claim', undefined, { 'Access-Control-Request-Method': 'DELETE' }, 'OPTIONS')).status, 403);
});

test('MV3 POST reads retain strict Origin validation and never accept a browser-claimed origin header', async (t) => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  await f.pair();
  assert.equal((await f.call('/status', {})).status, 200);
  assert.equal((await f.call('/jobs', {})).status, 200);
  assert.equal((await f.call('/jobs', { path: '/private/file' })).status, 400);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 200);
  assert.equal(await (await f.call('/media/task_1/0', {})).text(), 'synthetic-cover');
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/jobs`, { method: 'POST', headers: {
    Authorization: `Bearer ${f.bridge.token}`, 'Content-Type': 'application/json', 'X-Extension-Origin': ORIGIN,
  }, body: '{}' })).status, 403);
  assert.equal((await f.call('/jobs', {}, { Origin: 'https://evil.example', 'X-Extension-Origin': ORIGIN })).status, 403);
});

test('metadata does not expose content; claim and media use frozen selected bytes with source revalidation', async (t) => {
  let valid = true;
  let validates = 0;
  const f = await fixture({ validateJob: () => { validates += 1; if (!valid) throw new Error('/private/source'); } });
  t.after(() => f.bridge.stop());
  await f.pair();
  const metadata = await (await f.call('/jobs')).json();
  assert.deepEqual(Object.keys(metadata.jobs[0]).sort(), ['account', 'id', 'imageCount', 'title']);
  assert.equal((await f.call('/media/task_1/0')).status, 409);
  const claimed = await f.call('/claim', { taskId: 'task_1' });
  assert.equal(claimed.status, 200);
  const job = await claimed.json();
  assert.deepEqual(job.images.map((image: { name: string }) => image.name), ['封面.png', '02.png']);
  assert.equal(JSON.stringify(job).includes('synthetic-cover'), false);
  assert.equal((await (await f.call(job.images[0].url)).text()), 'synthetic-cover');
  const before = validates;
  f.source.images[0].data.fill(0); // Mutating a provider buffer cannot mutate the confirmed bridge snapshot.
  assert.equal((await (await f.call(job.images[0].url)).text()), 'synthetic-cover');
  assert.equal(validates, before + 1);
  assert.equal((await f.call('/media/task_1/9')).status, 404);
  assert.equal((await f.call('/media/another/0')).status, 409);
  valid = false;
  const stale = await f.call(job.images[0].url);
  assert.equal(stale.status, 409);
  assert.equal((await stale.text()).includes('/private/source'), false);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
  assert.deepEqual((await (await f.call('/jobs')).json()).jobs, []);
});

test('changed sources block an initial claim before it can be consumed', async (t) => {
  let valid = false;
  let calls = 0;
  const f = await fixture({
    validateJob: () => { if (!valid) throw new Error('changed'); },
    claimJob: (id) => { calls += 1; return makeJob(id); },
  });
  t.after(() => f.bridge.stop());
  await f.pair();
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
  assert.equal(calls, 0);
  valid = true;
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 200);
});

test('claims are serial, one-time, and result statuses cannot impersonate published', async (t) => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  await f.pair();
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 200);
  assert.equal((await f.call('/claim', { taskId: 'task_2' })).status, 409);
  assert.equal((await f.call('/result', { taskId: 'task_1', status: '已发布', detail: 'fake' })).status, 400);
  assert.equal((await f.call('/result', { taskId: 'task_2', status: '待人工确认', detail: '' })).status, 409);
  assert.equal((await f.call('/result', { taskId: 'task_1', status: '结果待核实', detail: '合成结果' })).status, 200);
  assert.deepEqual(f.reports, [['task_1', '结果待核实', '合成结果']]);
  assert.equal((await f.call('/result', { taskId: 'task_1', status: '失败', detail: '' })).status, 409);
  assert.equal((await f.call('/media/task_1/0')).status, 409);
  assert.equal((await f.call('/claim', { taskId: 'task_2' })).status, 409);
  assert.equal(f.bridge.acknowledge('wrong'), false);
  assert.equal(f.bridge.acknowledge('task_1'), true);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
  assert.equal((await f.call('/claim', { taskId: 'task_2' })).status, 200);
});

test('simultaneous claim requests produce exactly one provider call', async (t) => {
  let calls = 0;
  const f = await fixture({
    validateJob: async () => { await new Promise((resolve) => setTimeout(resolve, 15)); },
    claimJob: (id) => { calls += 1; return makeJob(id); },
  });
  t.after(() => f.bridge.stop());
  await f.pair();
  const results = await Promise.all([f.call('/claim', { taskId: 'task_1' }), f.call('/claim', { taskId: 'task_2' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(calls, 1);
});

test('restarting rotates token, discards media, and never makes a consumed task eligible again', async (t) => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  await f.pair();
  await f.call('/claim', { taskId: 'task_1' });
  const oldToken = f.bridge.token;
  await f.bridge.stop();
  assert.equal(f.bridge.token, '');
  assert.equal(f.bridge.running, false);
  await f.bridge.start(0);
  assert.notEqual(f.bridge.token, oldToken);
  assert.equal((await f.call('/pair', {}, { Authorization: `Bearer ${oldToken}` })).status, 401);
  await f.pair();
  assert.equal((await f.call('/media/task_1/0')).status, 409);
  assert.equal((await (await f.call('/status')).json()).activeTaskId, 'task_1');
  assert.equal(f.bridge.acknowledge('task_1'), true);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
});

test('a disconnected in-flight claim cannot restore media into a restarted session', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture({ claimJob: async (id) => { await gate; return makeJob(id); } });
  t.after(() => f.bridge.stop());
  await f.pair();
  const interrupted = f.call('/claim', { taskId: 'task_1' }).catch(() => null);
  for (let n = 0; n < 20; n += 1) {
    if ((await (await f.call('/status')).json()).activeTaskId) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await f.bridge.stop();
  await f.bridge.start(0);
  await f.pair();
  release();
  await interrupted;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await f.call('/media/task_1/0')).status, 409);
  assert.equal(f.bridge.acknowledge('task_1'), true);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
});

test('provider failure after claim is not retryable and does not leak private errors', async (t) => {
  let calls = 0;
  const f = await fixture({ claimJob: () => { calls += 1; throw new Error('/private/note.md'); } });
  t.after(() => f.bridge.stop());
  await f.pair();
  const failed = await f.call('/claim', { taskId: 'task_1' });
  assert.equal(failed.status, 409);
  assert.equal((await failed.text()).includes('/private/note.md'), false);
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
  assert.equal(calls, 1);
});

test('media caps and MIME checks reject invalid prepared payloads without exposing bytes', async (t) => {
  const oversized = makeJob();
  oversized.images = [{ name: 'big.png', mime: 'image/png', data: Buffer.allocUnsafe(100 * 1024 * 1024 + 1) }];
  const f = await fixture({ claimJob: () => oversized });
  t.after(() => f.bridge.stop());
  await f.pair();
  assert.equal((await f.call('/claim', { taskId: 'task_1' })).status, 409);
  assert.equal((await f.call('/media/task_1/0')).status, 409);
  const wrongMime = await fixture({ claimJob: () => ({ ...makeJob(), images: [{ name: 'file.html', mime: 'text/html', data: Buffer.from('<script>') }] }) });
  t.after(() => wrongMime.bridge.stop());
  await wrongMime.pair();
  assert.equal((await wrongMime.call('/claim', { taskId: 'task_1' })).status, 409);
});

test('manual acknowledgement cannot release a claim or result callback still in flight', async (t) => {
  let releaseClaim!: () => void;
  let releaseReport!: () => void;
  const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
  const reportGate = new Promise<void>((resolve) => { releaseReport = resolve; });
  const f = await fixture({ claimJob: async (id) => { await claimGate; return makeJob(id); }, report: () => reportGate });
  t.after(() => f.bridge.stop());
  await f.pair();
  const pending = f.call('/claim', { taskId: 'task_1' });
  for (let n = 0; n < 20; n += 1) {
    if ((await (await f.call('/status')).json()).activeTaskId) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(f.bridge.acknowledge('task_1'), false);
  releaseClaim();
  assert.equal((await pending).status, 200);
  const report = f.call('/result', { taskId: 'task_1', status: '待人工确认', detail: '' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.bridge.acknowledge('task_1'), false);
  releaseReport();
  assert.equal((await report).status, 200);
  assert.equal(f.bridge.acknowledge('task_1'), true);
});

const adapterSource = readFileSync(resolve('extension/adapter.js'), 'utf8');

test('extension has no persistent injection, cookies, remote messaging or broad host permissions', () => {
  const manifest = JSON.parse(readFileSync(resolve('extension/manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'https://creator.xiaohongshu.com/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.externally_connectable, undefined);
});

function page(html = '', url = 'https://creator.xiaohongshu.com/publish/publish') {
  const { JSDOM } = createRequire(resolve('package.json'))('jsdom');
  const dom = new JSDOM(`<input type="file" accept="image/*" multiple><input placeholder="填写标题"><div class="tiptap ProseMirror" contenteditable="true"></div><button id="publish">发布</button><button id="draft">存草稿</button><input id="original" type="checkbox">${html}`, { url, runScripts: 'outside-only' });
  // This test uses an in-memory synthetic document, not a browser or a platform account.
  const window = dom.window;
  let assigned: unknown[] = [];
  Object.defineProperty(window.document.querySelector('input[type=file]'), 'files', { get: () => assigned, set: (value) => { assigned = value; } });
  window.DataTransfer = class {
    files: unknown[] = [];
    items = { add: (file: unknown) => { this.files.push(file); } };
  };
  window.eval(adapterSource);
  return { window, adapter: window.ObsidianSocialPublisherAdapter, close: () => window.close() };
}

test('synthetic DOM: empty editor receives exact text and ordered files without clicking publishing controls', async (t) => {
  const p = page();
  t.after(p.close);
  let clicks = 0;
  for (const id of ['publish', 'draft', 'original']) p.window.document.getElementById(id).addEventListener('click', () => { clicks += 1; });
  assert.equal(p.adapter.inspect().ready, true);
  const result = await p.adapter.fill({ title: '原样标题', text: '第一行\n\n特殊 <b>文本</b> #候选', images: [
    { name: '封面.png', mime: 'image/png', base64: Buffer.from('cover').toString('base64') },
    { name: '01.png', mime: 'image/png', base64: Buffer.from('second').toString('base64') },
  ] });
  assert.equal(result.status, '结果待核实');
  assert.equal(p.window.document.querySelector('input[placeholder]').value, '原样标题');
  assert.deepEqual([...p.window.document.querySelectorAll('.ProseMirror p')].map((n: any) => n.textContent), ['第一行', '', '特殊 <b>文本</b> #候选']);
  assert.deepEqual([...p.window.document.querySelector('input[type=file]').files].map((file: any) => file.name), ['封面.png', '01.png']);
  assert.equal(p.window.document.querySelector('.ProseMirror b'), null);
  assert.equal(clicks, 0);
  assert.equal(p.window.document.getElementById('original').checked, false);
  assert.equal(p.adapter.inspect().ready, false);
  assert.equal((await p.adapter.fill({})).status, '失败');
});

test('synthetic DOM: existing text or media and non-official pages block before touching the editor', async (t) => {
  const contents = [
    { html: '', change: (p: any) => { p.window.document.querySelector('input[placeholder]').value = '不能覆盖'; } },
    { html: '', change: (p: any) => { p.window.document.querySelector('.ProseMirror').textContent = '已有正文'; } },
    { html: '<div data-testid="uploaded-image">已有图片</div>', change: () => {} },
  ];
  for (const content of contents) {
    const p = page(content.html);
    t.after(p.close);
    content.change(p);
    assert.equal(p.adapter.inspect().ready, false);
    const result = await p.adapter.fill({ title: 'new', text: 'new', images: [{ name: 'a.png', mime: 'image/png', base64: 'YQ==' }] });
    assert.equal(result.status, '失败');
    assert.equal(p.window.document.querySelector('input[type=file]').files.length, 0);
  }
  const wrong = page('', 'https://example.com/publish/publish');
  t.after(wrong.close);
  assert.equal(wrong.adapter.inspect().ready, false);
  const otherPath = page('', 'https://creator.xiaohongshu.com/other');
  t.after(otherPath.close);
  assert.equal(otherPath.adapter.inspect().ready, false);
});

test('synthetic DOM: uncertain or changed controls fail safely and never claim successful upload', async (t) => {
  const ambiguous = page('<input placeholder="另一标题">');
  t.after(ambiguous.close);
  assert.equal(ambiguous.adapter.inspect().ready, false);
  const noMultiple = page();
  t.after(noMultiple.close);
  noMultiple.window.document.querySelector('input[type=file]').multiple = false;
  const image = { name: 'a.png', mime: 'image/png', base64: 'YQ==' };
  assert.equal((await noMultiple.adapter.fill({ title: 't', text: 'b', images: [image, image] })).status, '失败');
  assert.equal(noMultiple.window.document.querySelector('input[type=file]').files.length, 0);
  const changed = page();
  t.after(changed.close);
  changed.window.document.querySelector('input[type=file]').addEventListener('change', () => {
    changed.window.document.querySelector('input[placeholder]').value = '网页自己的已有内容';
  });
  const result = await changed.adapter.fill({ title: 't', text: 'b', images: [image] });
  assert.equal(result.status, '结果待核实');
  assert.equal(changed.window.document.querySelector('input[placeholder]').value, '网页自己的已有内容');
});
