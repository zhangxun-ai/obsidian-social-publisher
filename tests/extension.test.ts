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

for (const [name, body, extra, url, status, reason] of [
  ['business failure', { ...envelope(), success: false }, {}, undefined, 'unknown', 'invalid-response'],
  ['nonzero code', { ...envelope(), code: 1 }, {}, undefined, 'unknown', 'invalid-response'],
  ['missing stable ID', { ...envelope(), data: { userName: '合成账号' } }, {}, undefined, 'unknown', 'identity-missing'],
  ['handle instead of immutable ID', { ...envelope(), data: { userId: 'my-handle', userName: '合成账号' } }, {}, undefined, 'unknown', 'identity-missing'],
  ['missing nickname', { ...envelope(), data: { userId: accountId } }, {}, undefined, 'unknown', 'identity-missing'],
  ['redirected response', envelope(), { redirected: true }, undefined, 'unknown', 'redirect'],
  ['wrong response URL', envelope(), { url: endpoint + '/other' }, undefined, 'unknown', 'redirect'],
  ['HTTP failure', envelope(), { ok: false, status: 500 }, undefined, 'unknown', 'http-error'],
  ['unauthenticated response', envelope(), { ok: false, status: 401 }, undefined, 'logged-out', 'login-required'],
  ['wrong origin', envelope(), {}, 'https://evil.example/publish/publish', 'unknown', 'wrong-page'],
  ['nonstandard port', envelope(), {}, 'https://creator.xiaohongshu.com:444/publish/publish', 'unknown', 'wrong-page'],
  ['login page', envelope(), {}, 'https://creator.xiaohongshu.com/login', 'logged-out', 'login-required'],
] as const) {
  test(`account detection fails closed for ${name}`, async () => {
    const { dom } = page('', url, body as any, extra);
    try { const result = await dom.window.ObsidianSocialPublisherAccount.detect(); assert.equal(result.status, status); assert.equal(result.reason, reason); }
    finally { dom.window.close(); }
  });
}

test('network interruption produces unknown without leaking raw error', async () => {
  const { dom } = page();
  dom.window.fetch = async () => { throw new Error('private response details'); };
  try { assert.deepEqual(JSON.parse(JSON.stringify(await dom.window.ObsidianSocialPublisherAccount.detect())), { status: 'unknown', reason: 'network' }); }
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

async function workspace(t: any, tabs: any[], actualAccountId = '0123456789abcdef01234567', options: { autoConnect?: boolean; response?: (path: string, fallback: any) => any; accountResult?: any; scriptThrows?: boolean } = {}) {
  const html = readFileSync('extension/popup.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://extension.test/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls: { path: string; body: any }[] = [];
  const queries: any[] = [];
  const window = dom.window;
  window.chrome = {
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} }, local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      query: async (query: any) => { queries.push(query); return tabs; },
      get: async (id: number) => tabs.find(tab => tab.id === id),
    },
    scripting: { executeScript: async (input: any) => {
      if (options.scriptThrows) throw new Error('private browser diagnostics');
      if (input.files) return [];
      if (String(input.func).includes('Account.detect')) return [{ result: options.accountResult ?? { status: 'recognized', accountId: actualAccountId, nickname: '合成账号' } }];
      return [{ result: { ready: true } }];
    } },
  };
  window.AbortController = AbortController;
  let nonce = 0;
  window.fetch = async (url: string, fetchOptions: any) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(fetchOptions.body) });
    if (path === '/pair' || path === '/account-detect') nonce++;
    if (path === '/discover') return { ok: false, status: 404 };
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
  assert.equal(p.calls.filter(call => call.path !== '/discover').length, 0);
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
  assert.equal(p.calls.filter(call => call.path !== '/discover').length, 0);
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
  assert.equal(d.getElementById('connection-options').hidden, false);
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
      runtime: { onInstalled: { addListener: () => {} }, getURL: () => 'chrome-extension://fixture/popup.html', getContexts: async (filter: any) => {
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

type AutoOptions = {
  vaults?: Record<number, { protocol: number; vaultId: string; vaultName: string }>;
  local?: Record<string, any>;
  session?: Record<string, any>;
  handle?: (path: string, port: number, body: any, headers: any, signal?: AbortSignal) => any;
  jobs?: any[];
};
async function automaticWorkspace(t: any, options: AutoOptions = {}) {
  const dom = new JSDOM(readFileSync('extension/popup.html', 'utf8'), { url: 'https://extension.test/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  const local = options.local ?? {};
  const session = options.session ?? {};
  const calls: any[] = [];
  let maxDiscovery = 0;
  let inDiscovery = 0;
  const storage = (memory: any) => ({
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, memory[key]])),
    set: async (updates: any) => { Object.assign(memory, updates); },
    remove: async (key: string) => { delete memory[key]; },
  });
  window.chrome = {
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      query: async () => [{ id: 7, url: 'https://creator.xiaohongshu.com/publish/publish', title: '官方后台' }],
      get: async () => ({ id: 7, url: 'https://creator.xiaohongshu.com/publish/publish' }),
    },
    scripting: { executeScript: async (input: any) => input.files ? [] : [{ result: String(input.func).includes('Account.detect')
      ? { status: 'recognized', accountId, nickname: '合成账号' } : { ready: true } }] },
  };
  window.AbortController = AbortController;
  const originalTimer = window.setTimeout.bind(window);
  window.setTimeout = (callback: any, delay: number) => originalTimer(callback, delay === 1000 ? 1 : delay);
  window.fetch = async (url: string, init: any) => {
    const { pathname: path, port: portText } = new URL(url);
    const port = Number(portText);
    const body = JSON.parse(init.body);
    calls.push({ path, port, body, authorized: !!init.headers.Authorization });
    if (path === '/discover') {
      inDiscovery++; maxDiscovery = Math.max(maxDiscovery, inDiscovery);
      await new Promise(resolve => setTimeout(resolve, 0));
      inDiscovery--;
    }
    const custom = options.handle?.(path, port, body, init.headers, init.signal);
    if (custom) return custom;
    const data = path === '/discover' ? options.vaults?.[port]
      : path === '/connect' ? { status: 'connected', token: 'n'.repeat(43) }
      : path === '/jobs' ? { jobs: options.jobs ?? [], activeTaskId: null }
      : path === '/account-request' ? { request: { requestId: 'fresh-nonce', platform: 'xiaohongshu', expiresAt: Date.now() + 120_000 } }
      : {};
    return { ok: !!data, status: data ? 200 : 404, json: async () => data };
  };
  window.eval(readFileSync('extension/popup.js', 'utf8'));
  const tick = async (count = 12) => { for (let i = 0; i < count; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  await tick();
  return { window, calls, local, session, tick, maxDiscovery: () => maxDiscovery };
}
const dailyVault = { protocol: 2, vaultId: 'daily-vault', vaultName: 'Obsidian' };
const testVault = { protocol: 2, vaultId: 'test-vault', vaultName: '独立测试库' };
const okResponse = (data: any) => ({ ok: true, status: 200, json: async () => data });

test('one discovered vault connects with installation identity and no manual code, then detects', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault } });
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 8);
  assert.equal(p.maxDiscovery(), 8);
  assert.deepEqual(p.calls.filter(call => call.path === '/discover').map(call => call.port), [27123,27124,27125,27126,27127,27128,27129,27130]);
  assert.equal(p.calls.filter(call => ['/discover', '/connect'].includes(call.path)).every(call => !call.authorized), true);
  const credentials = p.calls.find(call => call.path === '/connect').body;
  assert.equal(/^[A-Za-z0-9_-]{22}$/.test(credentials.clientId), true);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(credentials.clientSecret), true);
  assert.equal(p.session.ospConnection.vaultId, dailyVault.vaultId);
  assert.equal(p.calls.some(call => call.path === '/pair'), false);
  assert.equal(p.calls.some(call => call.path === '/account-result'), true);
  assert.equal(p.window.document.getElementById('connection-options').hidden, true);
  assert.equal(p.window.document.getElementById('fill-panel').hidden, true);
  assert.match(p.window.document.getElementById('connection-state').textContent, /Obsidian/);
  assert.equal(p.window.document.body.textContent.includes(credentials.clientSecret), false);
});

test('first connection waits for Obsidian approval before any authenticated requests', async t => {
  let approved = false;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/connect' ? okResponse(approved
    ? { status: 'connected', token: 'n'.repeat(43) } : { status: 'approval-required', requestId: 'approval-1', expiresAt: Date.now() + 120_000 }) : null });
  assert.match(p.window.document.getElementById('discovery-status').textContent, /Obsidian.*确认连接/);
  assert.equal(p.calls.some(call => call.authorized), false);
  assert.equal(Object.hasOwn(p.session, 'ospConnection'), false);
  approved = true;
  await p.tick();
  assert.equal(p.session.ospConnection.vaultId, dailyVault.vaultId);
  assert.equal(p.calls.some(call => call.path === '/account-result'), true);
});

test('multiple vaults require an explicit selection and never default to test vault', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: testVault, 27124: dailyVault } });
  assert.equal(p.calls.some(call => call.path === '/connect'), false);
  assert.equal(p.window.document.getElementById('vault-picker').hidden, false);
  assert.match(p.window.document.getElementById('vaults').textContent, /Obsidian/);
  const select = p.window.document.getElementById('vaults');
  select.value = dailyVault.vaultId;
  select.dispatchEvent(new p.window.Event('change'));
  p.window.document.getElementById('choose-vault').click(); await p.tick();
  assert.equal(p.calls.find(call => call.path === '/connect').port, 27124);
  assert.equal(p.local.ospPreferredVaultId, dailyVault.vaultId);
});

test('remembered vault is restored but missing remembered vault cannot silently move to another', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27124: dailyVault, 27123: testVault }, local: { ospPreferredVaultId: dailyVault.vaultId } });
  assert.equal(p.calls.find(call => call.path === '/connect').port, 27124);
  const missing = await automaticWorkspace(t, { vaults: { 27123: testVault }, local: { ospPreferredVaultId: dailyVault.vaultId } });
  assert.equal(missing.calls.some(call => call.path === '/connect'), false);
  assert.match(missing.window.document.getElementById('discovery-status').textContent, /上次连接.*未打开/);
});

test('saved authorized session resumes without rediscovery, pairing, or a new trust request', async t => {
  const p = await automaticWorkspace(t, { session: { ospConnection: { port: 27124, token: 's'.repeat(43), vaultId: dailyVault.vaultId, vaultName: dailyVault.vaultName, protocol: 2 } } });
  assert.equal(p.calls[0].path, '/status');
  assert.equal(p.calls.some(call => ['/discover', '/pair', '/connect'].includes(call.path)), false);
  assert.equal(p.calls.some(call => call.path === '/account-result'), true);
});

test('installation identity persists across a browser session restart and reconnects automatically', async t => {
  const local: Record<string, any> = {};
  const first = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, local });
  const second = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, local });
  const firstIdentity = first.calls.find(call => call.path === '/connect').body;
  const secondIdentity = second.calls.find(call => call.path === '/connect').body;
  assert.equal(firstIdentity.clientId === secondIdentity.clientId, true);
  assert.equal(firstIdentity.clientSecret === secondIdentity.clientSecret, true);
  assert.match(second.window.document.getElementById('connection-state').textContent, /已连接/);
});

test('approval expiration offers retry instead of polling indefinitely', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/connect'
    ? okResponse({ status: 'approval-required', requestId: 'expired', expiresAt: Date.now() - 1 }) : null });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /超时/);
  assert.equal(p.window.document.getElementById('retry-connection').hidden, false);
});

test('denied trust request stops and explains how to re-enable connecting', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/connect' ? { ok: false, status: 403 } : null });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /未获允许.*重新开启/);
  assert.equal(p.calls.some(call => call.authorized), false);
});

test('unavailable discovery offers opening Obsidian, retry, and collapsed legacy recovery', async t => {
  const p = await automaticWorkspace(t);
  const d = p.window.document;
  assert.equal(d.getElementById('open-obsidian').hidden, false);
  assert.equal(d.getElementById('open-obsidian').getAttribute('href'), 'obsidian://');
  assert.equal(d.getElementById('retry-connection').hidden, false);
  assert.equal(d.getElementById('connection-options').hidden, false);
  assert.equal(d.getElementById('connection-options').open, false);
  assert.equal(p.calls.some(call => call.path === '/connect'), false);
});

test('expired session read reconnects only to the same discovered vault and retries the read', async t => {
  let reads = 0;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => {
    if (path === '/account-request' && reads++ === 0) return { ok: false, status: 401 };
    return null;
  } });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 2);
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 16);
  assert.equal(p.calls.some(call => call.path === '/account-result'), true);
  assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
});

test('authentication failure during a claimed fill never reconnects or retries that claim', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, jobs: [{ id: 'task-id', title: 'title', account: '合成账号', accountId, imageCount: 1 }],
    handle: path => path === '/claim' ? { ok: false, status: 401 } : null });
  const d = p.window.document;
  d.getElementById('jobs').value = 'task-id';
  d.getElementById('jobs').dispatchEvent(new p.window.Event('change'));
  for (const id of ['account-check', 'empty-check']) { d.getElementById(id).checked = true; d.getElementById(id).dispatchEvent(new p.window.Event('change')); }
  d.getElementById('fill').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/claim').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(d.getElementById('fill').disabled, true);
  assert.match(d.getElementById('status').textContent, /不会自动重试/);
});

test('first install opens workbench once but update does not connect or read pages', async () => {
  let installed: (details: any) => void = () => {};
  let creates = 0;
  const chrome = {
    action: { onClicked: { addListener: () => {} } },
    runtime: { onInstalled: { addListener: (listener: any) => { installed = listener; } }, getURL: () => 'chrome-extension://fixture/popup.html', getContexts: async () => [] },
    tabs: { create: async () => { creates++; } },
  };
  runInNewContext(readFileSync('extension/background.js', 'utf8'), { chrome });
  installed({ reason: 'update' }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(creates, 0);
  installed({ reason: 'install' }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(creates, 1);
});


test('each discovery request times out and the fixed scan stops without a background retry loop', async t => {
  let aborted = 0;
  const p = await automaticWorkspace(t, { handle: (path, _port, _body, _headers, signal) => path === '/discover'
    ? new Promise((_resolve, reject) => {
      const onAbort = () => { aborted++; reject(new Error('synthetic timeout')); };
      if (signal!.aborted) onAbort();
      else signal!.addEventListener('abort', onAbort, { once: true });
    }) : null });
  assert.equal(aborted, 8);
  assert.equal(p.calls.length, 8);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /未找到/);
  await p.tick();
  assert.equal(p.calls.length, 8);
});

test('a late unauthorized read from the previous session cannot disconnect its successful recovery', async t => {
  let oldAccountResponse: (response: any) => void = () => {};
  let accountReads = 0;
  let jobsReads = 0;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => {
    if (path === '/account-request' && accountReads++ === 0) return new Promise(resolve => { oldAccountResponse = resolve; });
    if (path === '/jobs' && jobsReads++ === 1) return { ok: false, status: 401 };
    return null;
  } });
  p.window.document.getElementById('refresh-jobs').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 2);
  oldAccountResponse({ ok: false, status: 401 }); await p.tick();
  assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
  assert.equal(p.window.document.getElementById('account-panel').hidden, false);
});

test('trusted recovery refuses a different vault now occupying the previous port', async t => {
  let discoveries = 0;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: (path, port) => {
    if (path === '/discover' && port === 27123 && ++discoveries > 1) return okResponse(testVault);
    if (path === '/account-request') return { ok: false, status: 401 };
    return null;
  } });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(p.window.document.getElementById('account-panel').hidden, true);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /未找到原知识库/);
});

test('a denied recovered connection retains the specific approval recovery instruction', async t => {
  let connections = 0;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => {
    if (path === '/connect' && ++connections > 1) return { ok: false, status: 403 };
    if (path === '/account-request') return { ok: false, status: 401 };
    return null;
  } });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 2);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /未获允许.*重新开启/);
});

test('claimed task stays locked until an explicit refresh confirms Obsidian acknowledged it', async t => {
  let active = true;
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/jobs'
    ? okResponse({ jobs: [], activeTaskId: active ? 'locked-task' : null }) : null });
  const d = p.window.document;
  assert.equal(d.getElementById('fill').disabled, true);
  assert.equal(d.getElementById('connect').disabled, true);
  assert.equal(d.getElementById('forget').disabled, true);
  assert.equal(d.getElementById('refresh-jobs').disabled, false);
  d.getElementById('refresh-jobs').click(); await p.tick();
  assert.match(d.getElementById('summary').textContent, /已有任务被领取/);
  active = false;
  d.getElementById('refresh-jobs').click(); await p.tick();
  assert.doesNotMatch(d.getElementById('summary').textContent, /已有任务被领取/);
  assert.equal(d.getElementById('forget').disabled, false);
  assert.equal(p.calls.some(call => call.path === '/claim'), false);
});


for (const [reason, recovery] of [
  ['wrong-page', /请选择.*官方后台/],
  ['login-required', /登录.*重新检测/],
  ['timeout', /超时.*浏览器网络/],
  ['network', /无法连接小红书.*浏览器网络/],
  ['http-error', /官方服务暂不可用.*稍后/],
  ['redirect', /跳转.*重新打开.*官方后台/],
  ['invalid-response', /账号信息暂无法可靠识别.*不会猜测/],
  ['identity-missing', /账号信息暂无法可靠识别.*不会猜测/],
] as const) {
  test(`account reason ${reason} gives recovery guidance without widening the report contract`, async t => {
    const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/' }], undefined,
      { accountResult: { status: reason === 'login-required' ? 'logged-out' : 'unknown', reason } });
    assert.match(p.window.document.getElementById('account-status').textContent, recovery);
    assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
    const report = p.calls.find(call => call.path === '/account-result');
    assert.ok(report);
    assert.deepEqual(Object.keys(report.body).sort(), ['requestId', 'status']);
  });
}

test('page script injection failure asks to refresh that tab without disconnecting Obsidian', async t => {
  const p = await workspace(t, [{ id: 7, url: 'https://creator.xiaohongshu.com/' }], undefined, { scriptThrows: true });
  assert.match(p.window.document.getElementById('account-status').textContent, /无法读取此标签页.*刷新小红书页面/);
  assert.match(p.window.document.getElementById('connection-state').textContent, /已连接/);
  assert.equal(p.calls.some(call => call.path === '/account-result'), false);
  assert.doesNotMatch(p.window.document.body.textContent, /private browser diagnostics/);
});


test('official account request timeout has a specific reason and retains no response details', async () => {
  const { dom } = page();
  const schedule = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback: any) => schedule(callback, 1);
  dom.window.fetch = async (_url: string, options: any) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
  });
  try { assert.deepEqual(JSON.parse(JSON.stringify(await dom.window.ObsidianSocialPublisherAccount.detect())), { status: 'unknown', reason: 'timeout' }); }
  finally { dom.window.close(); }
});

test('malformed official response is distinguished from unavailable network', async () => {
  const { dom } = page('', undefined, envelope(), { json: async () => { throw new Error('private raw body'); } });
  try { assert.deepEqual(JSON.parse(JSON.stringify(await dom.window.ObsidianSocialPublisherAccount.detect())), { status: 'unknown', reason: 'invalid-response' }); }
  finally { dom.window.close(); }
});


test('an expired saved session pins its original vault even when local selection metadata is missing', async t => {
  const p = await automaticWorkspace(t, { local: {}, vaults: { 27123: testVault },
    session: { ospConnection: { port: 27124, token: 's'.repeat(43), vaultId: dailyVault.vaultId, vaultName: dailyVault.vaultName, protocol: 2 } },
    handle: path => path === '/status' ? { ok: false, status: 401 } : null });
  assert.equal(p.calls.some(call => call.path === '/connect'), false);
  assert.equal(p.window.document.getElementById('vault-picker').hidden, false);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /上次连接.*未打开/);
});

for (const failure of ['network', 'timeout'] as const) {
  test(`${failure} read recovers the original vault at a new port instead of the vault occupying its old port`, async t => {
    let restarted = false;
    let failedRead = false;
    const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: (path, port, _body, _headers, signal) => {
      if (restarted && path === '/discover') return port === 27130 ? okResponse(dailyVault)
        : port === 27123 ? okResponse(testVault) : { ok: false, status: 404 };
      if (restarted && path === '/jobs' && !failedRead) {
        failedRead = true;
        if (failure === 'network') return Promise.reject(new Error('synthetic connection refused'));
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true }));
      }
      return null;
    } });
    const originalTimer = p.window.setTimeout.bind(p.window);
    p.window.setTimeout = (callback: any, delay: number) => originalTimer(callback, delay === 15_000 ? 1 : delay);
    restarted = true;
    p.window.document.getElementById('refresh-jobs').click(); await p.tick(25);
    assert.equal(failedRead, true);
    assert.equal(p.calls.filter(call => call.path === '/discover').length, 16);
    assert.deepEqual(p.calls.filter(call => call.path === '/connect').map(call => call.port), [27123, 27130]);
    assert.equal(p.session.ospConnection.port, 27130);
    assert.equal(p.session.ospConnection.vaultId, dailyVault.vaultId);
    assert.equal(p.window.document.getElementById('account-panel').hidden, false);
  });
}

for (const otherVaultPresent of [false, true]) {
  test(`lost connection stops after one bounded scan when ${otherVaultPresent ? 'only another vault exists' : 'no service exists'}`, async t => {
    let offline = false;
    const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: (path, port) => {
      if (offline && path === '/discover') return otherVaultPresent && port === 27125 ? okResponse(testVault) : { ok: false, status: 404 };
      if (offline && path === '/jobs') return Promise.reject(new Error('synthetic connection refused'));
      return null;
    } });
    offline = true;
    p.window.document.getElementById('refresh-jobs').click(); await p.tick();
    assert.equal(p.calls.filter(call => call.path === '/discover').length, 16);
    assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
    assert.equal(Object.hasOwn(p.session, 'ospConnection'), false);
    assert.equal(p.window.document.getElementById('account-panel').hidden, true);
    assert.equal(p.window.document.getElementById('open-obsidian').hidden, false);
    assert.equal(p.window.document.getElementById('retry-connection').hidden, false);
    assert.match(p.window.document.getElementById('discovery-status').textContent, /未找到原知识库/);
    await p.tick(25);
    assert.equal(p.calls.filter(call => call.path === '/discover').length, 16);
  });
}

test('returning to a previously unavailable workbench performs one scan and connects after Obsidian opens', async t => {
  const vaults: Record<number, any> = {};
  const p = await automaticWorkspace(t, { vaults });
  assert.equal(p.calls.length, 8);
  vaults[27126] = dailyVault;
  p.window.dispatchEvent(new p.window.Event('focus'));
  p.window.dispatchEvent(new p.window.Event('focus'));
  await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 16);
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(p.session.ospConnection.port, 27126);
});

test('focus recovery remains pinned to the interrupted vault even when other vaults are available', async t => {
  let phase = 'online';
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: (path, port) => {
    if (phase !== 'online' && path === '/discover') return phase === 'reopened' && port === 27128 ? okResponse(dailyVault)
      : port === 27123 ? okResponse(testVault) : { ok: false, status: 404 };
    if (phase === 'offline' && path === '/jobs') return Promise.reject(new Error('synthetic connection refused'));
    return null;
  } });
  phase = 'offline';
  p.window.document.getElementById('refresh-jobs').click(); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  phase = 'reopened';
  p.window.dispatchEvent(new p.window.Event('focus')); await p.tick();
  assert.deepEqual(p.calls.filter(call => call.path === '/connect').map(call => call.port), [27123, 27128]);
  assert.equal(p.session.ospConnection.vaultId, dailyVault.vaultId);
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 24);
});

test('focus does not repeat a rejected trust request', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/connect' ? { ok: false, status: 403 } : null });
  p.window.dispatchEvent(new p.window.Event('focus')); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 8);
  assert.match(p.window.document.getElementById('discovery-status').textContent, /未获允许.*重新开启/);
});

test('network failure reporting an account result never reconnects or resends the result', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, handle: path => path === '/account-result'
    ? Promise.reject(new Error('synthetic connection refused')) : null });
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/account-result').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 8);
});

test('network failure during a claimed fill does not recover even when focus returns', async t => {
  const p = await automaticWorkspace(t, { vaults: { 27123: dailyVault }, jobs: [{ id: 'task-id', title: 'title', account: '合成账号', accountId, imageCount: 1 }],
    handle: path => path === '/claim' ? Promise.reject(new Error('synthetic connection refused')) : null });
  const d = p.window.document;
  d.getElementById('jobs').value = 'task-id';
  d.getElementById('jobs').dispatchEvent(new p.window.Event('change'));
  for (const id of ['account-check', 'empty-check']) { d.getElementById(id).checked = true; d.getElementById(id).dispatchEvent(new p.window.Event('change')); }
  d.getElementById('fill').click(); await p.tick();
  p.window.dispatchEvent(new p.window.Event('focus')); await p.tick();
  assert.equal(p.calls.filter(call => call.path === '/claim').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/connect').length, 1);
  assert.equal(p.calls.filter(call => call.path === '/discover').length, 8);
  assert.equal(d.getElementById('fill').disabled, true);
});
