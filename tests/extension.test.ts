import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const accountSource = readFileSync('extension/account.js', 'utf8');
const adapterSource = readFileSync('extension/adapter.js', 'utf8');
const endpoint = 'https://creator.xiaohongshu.com/api/galaxy/user/info';
const accountId = '0123456789abcdef01234567';
const envelope = () => ({ success: true, code: 0, data: { userId: accountId, userName: '合成账号', phone: 'must-not-leave-projection' } });
function page(markup = '', url = 'https://creator.xiaohongshu.com/publish/publish', body = envelope(), extra = {}) {
  const dom = new JSDOM(markup, { url, runScripts: 'outside-only' });
  const requests: any[] = [];
  dom.window.fetch = async (url: string, options: any) => { requests.push({ url, options }); return { ok: true, status: 200, redirected: false, url: endpoint, json: async () => body, ...extra }; };
  dom.window.eval(accountSource);
  return { dom, requests };
}

test('official account request has a fixed read-only URL and projects only ID and nickname', async () => {
  const { dom, requests } = page('<span>用户ID：fake-dom-id</span>');
  try {
    const result = await dom.window.ObsidianSocialPublisherAccount.detect();
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'recognized', accountId, nickname: '合成账号' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, endpoint);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(requests[0].options.redirect, 'error');
    assert.equal(JSON.stringify(result).includes('phone'), false);
  } finally { dom.window.close(); }
});

for (const [name, body, extra, url, status] of [
  ['business failure', { ...envelope(), success: false }, {}, undefined, 'unknown'],
  ['nonzero code', { ...envelope(), code: 1 }, {}, undefined, 'unknown'],
  ['missing stable ID', { ...envelope(), data: { userName: '合成账号' } }, {}, undefined, 'unknown'],
  ['handle instead of immutable ID', { ...envelope(), data: { userId: 'my-handle', userName: '合成账号' } }, {}, undefined, 'unknown'],
  ['missing nickname', { ...envelope(), data: { userId: accountId } }, {}, undefined, 'unknown'],
  ['redirected response', envelope(), { redirected: true }, undefined, 'unknown'],
  ['wrong response URL', envelope(), { url: endpoint + '/other' }, undefined, 'unknown'],
  ['HTTP failure', envelope(), { ok: false, status: 500 }, undefined, 'unknown'],
  ['unauthenticated response', envelope(), { ok: false, status: 401 }, undefined, 'logged-out'],
  ['wrong origin', envelope(), {}, 'https://evil.example/publish/publish', 'unknown'],
  ['nonstandard port', envelope(), {}, 'https://creator.xiaohongshu.com:444/publish/publish', 'unknown'],
  ['login page', envelope(), {}, 'https://creator.xiaohongshu.com/login', 'logged-out'],
] as const) {
  test(`account detection fails closed for ${name}`, async () => {
    const { dom } = page('', url, body as any, extra);
    try { assert.equal((await dom.window.ObsidianSocialPublisherAccount.detect()).status, status); }
    finally { dom.window.close(); }
  });
}

test('network interruption produces unknown without leaking raw error', async () => {
  const { dom } = page();
  dom.window.fetch = async () => { throw new Error('private response details'); };
  try { assert.deepEqual(JSON.parse(JSON.stringify(await dom.window.ObsidianSocialPublisherAccount.detect())), { status: 'unknown' }); }
  finally { dom.window.close(); }
});

for (const changed of ['abcdef0123456789abcdef01', 'unknown']) {
  test(`adapter blocks ${changed} account before assigning image files`, async () => {
    const { dom } = page('<input type="file" accept="image/png" multiple><input placeholder="标题"><div class="tiptap ProseMirror" contenteditable="true"></div>');
    const window = dom.window;
    let uploads = 0;
    window.document.querySelector('input[type="file"]').addEventListener('change', () => uploads++);
    window.eval(adapterSource);
    window.fetch = async () => ({ ok: true, status: 200, redirected: false, url: endpoint, json: async () => changed === 'unknown' ? {} : { ...envelope(), data: { userId: changed, userName: '其他账号' } } });
    try {
      const result = await window.ObsidianSocialPublisherAdapter.fill({ accountId, title: 'title', text: 'body', images: [{ name: 'a.png', mime: 'image/png', base64: 'YQ==' }] });
      assert.equal(result.status, '失败'); assert.match(result.detail, /账号/); assert.equal(uploads, 0);
    } finally { window.close(); }
  });
}

async function workspace(t: any, tabs: any[], actualAccountId = '0123456789abcdef01234567', options: { autoConnect?: boolean; response?: (path: string, fallback: any) => any } = {}) {
  const html = readFileSync('extension/popup.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://extension.test/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls: { path: string; body: any }[] = [];
  const queries: any[] = [];
  const window = dom.window;
  window.chrome = {
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: {
      query: async (query: any) => { queries.push(query); return tabs; },
      get: async (id: number) => tabs.find(tab => tab.id === id),
    },
    scripting: { executeScript: async (input: any) => {
      if (input.files) return [];
      if (String(input.func).includes('Account.detect')) return [{ result: { status: 'recognized', accountId: actualAccountId, nickname: '合成账号' } }];
      return [{ result: { ready: true } }];
    } },
  };
  window.AbortController = AbortController;
  let nonce = 0;
  window.fetch = async (url: string, fetchOptions: any) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(fetchOptions.body) });
    if (path === '/pair' || path === '/account-detect') nonce++;
    const result = path === '/jobs' ? { jobs: [{ id: 'task-id', title: 'title', account: '合成账号', accountId: '0123456789abcdef01234567', imageCount: 1 }], activeTaskId: null }
      : path === '/account-request' ? { request: { requestId: `nonce-${nonce}`, platform: 'xiaohongshu', expiresAt: Date.now() + 120_000 } }
      : {};
    return options.response?.(path, result) ?? { ok: true, json: async () => result };
  };
  window.eval(readFileSync('extension/popup.js', 'utf8'));
  const tick = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => setTimeout(resolve, 0)); };
  await tick();
  if (options.autoConnect !== false) {
    window.document.getElementById('token').value = 'a'.repeat(43);
    window.document.getElementById('connect').click();
  }
  await tick();
  return { window, calls, queries, tick };
}

test('persistent workspace detects a selected official tab while extension page has focus', async t => {
  const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/publish/publish', title: '官方后台' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.queries[0])), { url: 'https://creator.xiaohongshu.com/*', currentWindow: true });
  const report = p.calls.find(call => call.path === '/account-result');
  assert.equal(report?.body.accountId, '0123456789abcdef01234567');
  assert.equal(report?.body.status, 'recognized');
  assert.match(p.window.document.getElementById('account-status').textContent, /确认绑定/);
  assert.equal(p.window.document.getElementById('target-picker').hidden, true);
  p.window.document.getElementById('detect-account').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 2);
  assert.notEqual(p.calls.filter(call => call.path === '/account-result')[0].body.requestId, p.calls.filter(call => call.path === '/account-result')[1].body.requestId);
});

test('invalid connection code fails inline before requests, then accepts the exact copied code with whitespace', async t => {
  const p = await workspace(t, [], undefined, { autoConnect: false });
  const d = p.window.document;
  assert.equal(d.getElementById('account-panel').hidden, true);
  assert.equal(d.getElementById('fill-panel').hidden, true);
  assert.equal(d.getElementById('connection-options').open, false);
  d.getElementById('token').value = '••••••••';
  d.getElementById('connect').click(); await p.tick();
  assert.equal(p.calls.length, 0);
  assert.equal(d.getElementById('connection-error').hidden, false);
  assert.match(d.getElementById('connection-error').textContent, /复制连接码/);
  assert.equal(d.activeElement.id, 'token');
  assert.equal(d.getElementById('token').getAttribute('aria-invalid'), 'true');
  d.getElementById('token').value = ` ${'a'.repeat(20)}\n${'a'.repeat(23)} `;
  d.getElementById('connect').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/pair').length, 1);
  assert.equal(d.getElementById('connection-error').hidden, true);
  assert.match(d.getElementById('connection-state').textContent, /已连接/);
});

test('invalid custom port opens its advanced field without attempting connection', async t => {
  const p = await workspace(t, [], undefined, { autoConnect: false });
  const d = p.window.document;
  d.getElementById('port').value = '80';
  d.getElementById('connect').click(); await p.tick();
  assert.equal(p.calls.length, 0);
  assert.equal(d.getElementById('connection-options').open, true);
  assert.equal(d.activeElement.id, 'port');
  assert.match(d.getElementById('connection-error').textContent, /端口/);
});

test('tasks read failure preserves a successful connection and still detects the account', async t => {
  const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/' }], undefined, {
    response: path => { if (path === '/jobs') throw new Error('private diagnostic'); },
  });
  const d = p.window.document;
  assert.match(d.getElementById('connection-state').textContent, /已连接/);
  assert.equal(d.getElementById('fill-panel').hidden, true);
  assert.match(d.getElementById('status').textContent, /读取作品失败/);
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 1);
  assert.doesNotMatch(d.body.textContent, /private diagnostic/);
});

test('empty task list hides publishing controls until explicit refresh finds a prepared task', async t => {
  let empty = true;
  const p = await workspace(t, [], undefined, { response: (path, fallback) => path === '/jobs' && empty ? { ok: true, json: async () => ({ jobs: [], activeTaskId: null }) } : undefined });
  const d = p.window.document;
  assert.equal(d.getElementById('fill-panel').hidden, true);
  assert.equal(d.getElementById('jobs-empty').hidden, false);
  empty = false;
  d.getElementById('refresh-jobs').click(); await p.tick();
  assert.equal(d.getElementById('fill-panel').hidden, false);
  assert.equal(d.getElementById('fill').disabled, true);
});

test('rejected pairing provides local recovery and does not expose response details', async t => {
  const p = await workspace(t, [], undefined, { response: path => path === '/pair' ? { ok: false, status: 401, json: async () => ({ error: 'private diagnostic' }) } : undefined });
  const d = p.window.document;
  assert.match(d.getElementById('connection-error').textContent, /已失效/);
  assert.equal(d.getElementById('connection-panel').hidden, false);
  assert.equal(d.getElementById('account-panel').hidden, true);
  assert.equal(d.activeElement.id, 'token');
  assert.doesNotMatch(d.body.textContent, /private diagnostic/);
});

test('expired detection response keeps pairing and offers retry', async t => {
  const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/' }], undefined, { response: path => path === '/account-result' ? { ok: false, status: 409 } : undefined });
  assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
  assert.match(p.window.document.getElementById('account-status').textContent, /重新检测/);
});

test('older plugin falls back to initiating detection in Obsidian', async t => {
  const p = await workspace(t, [], undefined, { response: path => path === '/account-request' ? { ok: true, json: async () => ({ request: null }) } : path === '/account-detect' ? { ok: false, status: 404 } : undefined });
  assert.match(p.window.document.getElementById('account-status').textContent, /Obsidian.*检测登录状态/);
  p.window.document.getElementById('detect-account').click(); await p.tick();
  assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 0);
});

test('multiple official tabs require selection and leave detection nonce pending', async t => {
  const p = await workspace(t, [7, 8].map(id => ({ id, url: 'https://creator.xiaohongshu.com/publish/publish', title: `官方${id}` })));
  p.window.document.getElementById('detect-account').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 0);
  assert.match(p.window.document.getElementById('account-status').textContent, /先选择/);
  p.window.document.getElementById('official-tabs').value = '8';
  p.window.document.getElementById('detect-account').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 1);
});

test('workspace blocks a different real page account before claiming local task', async t => {
  const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/publish/publish' }], 'abcdef0123456789abcdef01');
  const document = p.window.document;
  document.getElementById('jobs').value = 'task-id';
  document.getElementById('jobs').dispatchEvent(new p.window.Event('change'));
  for (const id of ['account-check', 'empty-check']) { document.getElementById(id).checked = true; document.getElementById(id).dispatchEvent(new p.window.Event('change')); }
  document.getElementById('fill').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/claim').length, 0);
  assert.match(document.getElementById('status').textContent, /账号/);
});

test('browser action opens a persistent workspace without reading pages in background', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.minimum_chrome_version, '116');
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  const background = readFileSync('extension/background.js', 'utf8');
  assert.match(background, /action.onClicked/);
  assert.doesNotMatch(background, /executeScript|fetch\(|setInterval|cookies|localStorage/);
});

test('account change while the page prepares editor stops before writing any text', async () => {
  const { dom } = page('<input type="file" accept="image/png" multiple><input placeholder="标题"><div class="tiptap ProseMirror" contenteditable="true"></div>');
  const window = dom.window;
  let checks = 0;
  let assigned: any[] = [];
  Object.defineProperty(window.document.querySelector('input[type="file"]'), 'files', { get: () => assigned, set: (value: any[]) => { assigned = value; } });
  window.DataTransfer = class { files: any[] = []; items = { add: (file: any) => { this.files.push(file); } }; };
  window.fetch = async () => ({ ok: true, status: 200, redirected: false, url: endpoint,
    json: async () => (++checks === 1 ? envelope() : { ...envelope(), data: { userId: 'abcdef0123456789abcdef01', userName: '其他账号' } }) });
  window.eval(adapterSource);
  try {
    const result = await window.ObsidianSocialPublisherAdapter.fill({ accountId, title: 'title', text: 'body', images: [{ name: 'a.png', mime: 'image/png', base64: 'YQ==' }] });
    assert.equal(result.status, '结果待核实');
    assert.equal(checks, 2);
    assert.equal(assigned.length, 1);
    assert.equal(window.document.querySelector('input[placeholder]').value, '');
    assert.equal(window.document.querySelector('[contenteditable]').textContent, '');
    assert.match(result.detail, /账号/);
  } finally { window.close(); }
});

for (const state of ['normal', 'maximized', 'minimized']) {
  test(`browser action reuses and foregrounds existing workspace in another ${state} window`, async () => {
    let click: (() => void) | undefined;
    const changes: any[] = [];
    const chrome = {
      action: { onClicked: { addListener: (listener: () => void) => { click = listener; } } },
      runtime: { getURL: () => 'chrome-extension://fixture/popup.html', getContexts: async (filter: any) => {
        assert.deepEqual(JSON.parse(JSON.stringify(filter)), { contextTypes: ['TAB'], documentUrls: ['chrome-extension://fixture/popup.html'] });
        return [{ tabId: 42, windowId: 9 }];
      } },
      tabs: {
        query: async () => { throw new Error('Own extension URL is not visible through tabs.query without tabs permission'); },
        update: async (id: number, options: any) => { changes.push({ type: 'tab', id, ...options }); },
        create: async () => { changes.push({ type: 'create' }); },
      },
      windows: {
        get: async (id: number) => ({ id, state }),
        update: async (id: number, options: any) => { changes.push({ type: 'window', id, ...options }); },
      },
    };
    runInNewContext(readFileSync('extension/background.js', 'utf8'), { chrome });
    click!();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(changes, [
      { type: 'tab', id: 42, active: true },
      state === 'minimized' ? { type: 'window', id: 9, focused: true, state: 'normal' } : { type: 'window', id: 9, focused: true },
    ]);
  });
}
