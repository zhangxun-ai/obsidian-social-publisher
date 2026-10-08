const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries(['port', 'token', 'connect', 'forget', 'jobs', 'summary', 'account-check', 'empty-check', 'fill', 'status', 'detect-account', 'account-status', 'official-tabs', 'refresh-tabs'].map((id) => [id, byId(id)]));
let connection = null;
let jobs = [];
let activeTaskId = null;
let busy = false;
let checkingAccount = false;
let lastAccountRequest = null;
let accountPoll = null;
const message = (value) => { elements.status.textContent = value; };
async function timedFetch(url, options, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const allowedPage = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'creator.xiaohongshu.com' && !parsed.port && parsed.pathname === '/publish/publish';
  } catch { return false; }
};

function update() {
  const selected = jobs.find((job) => job.id === elements.jobs.value);
  elements.fill.disabled = busy || !connection || !!activeTaskId || !selected?.accountId || !elements['account-check'].checked || !elements['empty-check'].checked;
  elements.connect.disabled = busy;
  elements['detect-account'].disabled = busy || !connection || checkingAccount;
  elements.forget.disabled = busy;
  elements.jobs.disabled = busy || !connection || !!activeTaskId || jobs.length === 0;
  elements.summary.textContent = activeTaskId
    ? '已有任务被领取。请先核实网页，再回 Obsidian 确认该篇已处理；不会自动重发。'
    : selected ? `账号：${selected.account || '未指定，请先回 Obsidian 补充'} · ${selected.imageCount} 张图片 · 首图为封面` : '';
}

async function request(path, body) {
  if (!connection) throw new Error('请先配对。');
  const response = await timedFetch(`http://127.0.0.1:${connection.port}${path}`, {
    // Chrome omits the Origin header on extension GETs. POST reads retain its genuine Origin.
    method: 'POST', mode: 'cors', cache: 'no-store',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }, 15_000);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本地连接请求未完成，请回 Obsidian 检查连接。');
  return data;
}


async function detectCurrentAccount(tab) {
  if (!tab?.id || !allowedCreatorPage(tab.url)) return { status: 'unknown' };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['account.js'] });
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => globalThis.ObsidianSocialPublisherAccount.detect() });
  return result[0]?.result ?? { status: 'unknown' };
}

const allowedCreatorPage = (url) => {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'creator.xiaohongshu.com' && !parsed.port; }
  catch { return false; }
};


async function refreshOfficialTabs() {
  const previous = elements['official-tabs'].value;
  const tabs = await chrome.tabs.query({ url: 'https://creator.xiaohongshu.com/*', currentWindow: true });
  elements['official-tabs'].replaceChildren(new Option(tabs.length ? '请选择要操作的官方标签页' : '请先打开小红书官方后台', ''));
  for (const tab of tabs) if (tab.id && allowedCreatorPage(tab.url)) {
    elements['official-tabs'].append(new Option(tab.title || '小红书官方后台', String(tab.id)));
  }
  if (tabs.length === 1) elements['official-tabs'].value = String(tabs[0].id);
  else if (tabs.some((tab) => String(tab.id) === previous)) elements['official-tabs'].value = previous;
}
async function selectedOfficialTab() {
  const tabId = Number(elements['official-tabs'].value);
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return null;
  const tab = await chrome.tabs.get(tabId);
  return allowedCreatorPage(tab.url) ? tab : null;
}
elements['refresh-tabs'].addEventListener('click', async () => {
  try { await refreshOfficialTabs(); } catch { message('无法读取官方标签页，请重新打开扩展工作台。'); }
});

async function respondToAccountRequest(manual = false) {
  if (!connection || busy || checkingAccount) return;
  checkingAccount = true;
  update();
  try {
    const { request: pending } = await request('/account-request');
    if (!pending) {
      if (manual) elements['account-status'].textContent = '请保持此工作台打开，回 Obsidian「平台与账号」点击检测登录状态。';
      return;
    }
    if (pending.requestId === lastAccountRequest || pending.platform !== 'xiaohongshu' || pending.expiresAt <= Date.now()) return;
    const tab = await selectedOfficialTab();
    if (!tab) {
      elements['account-status'].textContent = '请先选择要检测的小红书官方标签页；当前检测请求仍在等待。';
      return;
    }
    const result = await detectCurrentAccount(tab);
    // Only a fresh official account response from the selected tab may answer this request.
    const body = result.status === 'recognized'
      ? { requestId: pending.requestId, status: 'recognized', accountId: result.accountId, nickname: result.nickname }
      : { requestId: pending.requestId, status: result.status === 'logged-out' ? 'logged-out' : 'unknown' };
    await request('/account-result', body);
    lastAccountRequest = pending.requestId;
    elements['account-status'].textContent = result.status === 'recognized'
      ? `已识别：${result.nickname}（${result.accountId}）。请回 Obsidian 核对并绑定。`
      : result.status === 'logged-out' ? '当前官方页面尚未登录，请先手动登录。'
      : '无法可靠识别当前账号。请确认官方后台已经登录并刷新页面，再回 Obsidian 重新发起检测；不会按昵称猜测。';
  } catch { if (manual) elements['account-status'].textContent = '账号检测未完成，请检查本地连接和当前官方页面后重试。'; }
  finally { checkingAccount = false; update(); }
}

function startAccountPolling() {
  if (accountPoll) clearInterval(accountPoll);
  // Runs only while this explicitly paired workspace stays open, never in the background.
  accountPoll = setInterval(() => { void respondToAccountRequest(); }, 2000);
  void respondToAccountRequest();
}

elements['detect-account'].addEventListener('click', () => { void respondToAccountRequest(true); });

async function refresh() {
  const data = await request('/jobs');
  jobs = data.jobs;
  activeTaskId = data.activeTaskId;
  elements.jobs.replaceChildren(new Option(jobs.length ? '请选择一篇作品' : '没有可领取作品', ''));
  for (const job of jobs) elements.jobs.append(new Option(`${job.title} · ${job.account || '未指定账号'}`, job.id));
  elements['account-check'].checked = false;
  elements['empty-check'].checked = false;
  update();
}

elements.connect.addEventListener('click', async () => {
  const port = Number(elements.port.value);
  const token = elements.token.value.trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    message('请使用 Obsidian 中显示的端口和本次配对码。');
    return;
  }
  busy = true;
  connection = { port, token };
  update();
  try {
    await request('/pair', {});
    await chrome.storage.session.set({ ospConnection: connection });
    await refresh();
    await refreshOfficialTabs();
    startAccountPolling();
    message(activeTaskId ? '本次连接中有任务需要先核实。' : '已配对；请手动选择一篇作品。');
  } catch {
    connection = null;
    jobs = [];
    elements.jobs.replaceChildren(new Option('请重新配对', ''));
    message('连接未完成。请核对 Obsidian 本地连接已开启、配对码有效且未绑定其他扩展。');
  } finally { busy = false; update(); }
});

elements.forget.addEventListener('click', async () => {
  await chrome.storage.session.remove('ospConnection');
  if (accountPoll) clearInterval(accountPoll);
  accountPoll = null;
  lastAccountRequest = null;
  connection = null;
  jobs = [];
  activeTaskId = null;
  elements.token.value = '';
  elements.jobs.replaceChildren(new Option('请先配对', ''));
  message('已清除浏览器会话中的配对码；Obsidian 中已领取的任务仍需核实。');
  update();
});

elements.jobs.addEventListener('change', () => {
  elements['account-check'].checked = false;
  elements['empty-check'].checked = false;
  update();
});
for (const id of ['account-check', 'empty-check']) elements[id].addEventListener('change', update);

const base64 = (bytes) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};

elements.fill.addEventListener('click', async () => {
  const taskId = elements.jobs.value;
  if (elements.fill.disabled || !taskId) return;
  busy = true;
  update();
  let claimed = false;
  try {
    const tab = await selectedOfficialTab();
    if (!tab?.id || !allowedPage(tab.url)) throw new Error('请先手动打开小红书官方图文发布页，再点击扩展。');
    const selected = jobs.find((candidate) => candidate.id === taskId);
    const actualAccount = await detectCurrentAccount(tab);
    if (!selected?.accountId || actualAccount.status !== 'recognized' || actualAccount.accountId !== selected.accountId) {
      throw new Error('当前网页账号无法确认或与作品绑定账号不一致，未领取任务。请回 Obsidian 重新检测账号。');
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['adapter.js'] });
    const preflight = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.ObsidianSocialPublisherAdapter.inspect() });
    if (!preflight[0]?.result?.ready) throw new Error(preflight[0]?.result?.reason || '编辑器未能确认，未领取任务。');
    message('正在领取和读取本次素材；请保持窗口打开。');
    // From this point any interruption can have consumed the claim; never retry it.
    claimed = true;
    activeTaskId = taskId;
    const job = await request('/claim', { taskId, accountId: actualAccount.accountId });
    const images = [];
    for (const image of job.images) {
      if (!/^\/media\/[A-Za-z0-9_-]{1,128}\/\d+$/.test(image.url)) throw new Error('图片读取被阻止，请先核对官方网页，再回 Obsidian 处理当前任务。');
      const response = await timedFetch(`http://127.0.0.1:${connection.port}${image.url}`, {
        method: 'POST', mode: 'cors', cache: 'no-store',
        headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: '{}',
      }, 30_000);
      if (!response.ok) throw new Error('本次图片读取失败，素材可能已变化，请回 Obsidian 核实。');
      images.push({ name: image.name, mime: image.mime, base64: base64(new Uint8Array(await response.arrayBuffer())) });
    }
    // Avoid filling another tab if the user has navigated during local transfer.
    const current = await chrome.tabs.get(tab.id);
    if (!allowedPage(current.url)) throw new Error('网页地址已经变化；未继续填写，请核实。');
    const execution = await chrome.scripting.executeScript({ target: { tabId: tab.id },
      func: async (payload) => globalThis.ObsidianSocialPublisherAdapter.fill(payload),
      args: [{ title: job.title, text: job.text, accountId: job.accountId, images }],
    });
    const result = execution[0]?.result;
    if (!result || !['待人工确认', '失败', '结果待核实'].includes(result.status)) throw new Error('未收到可信的填写结果，请人工核实。');
    await request('/result', { taskId, status: result.status, detail: String(result.detail).slice(0, 1000) });
    message(`${result.detail} 请回 Obsidian 确认本篇已处理。`);
  } catch (error) {
    if (claimed) {
      try { await request('/result', { taskId, status: '结果待核实', detail: '领取或填写过程中断，请检查官方网页与 Obsidian 任务记录。不会自动重发。' }); } catch { /* Keep the lock; an unknown result must not trigger a second claim. */ }
      message('领取或填写未完成，结果待核实。请检查官方网页，再回 Obsidian 处理当前任务；不会自动重试。');
    } else { message(error.message || '未进行填写，请核对页面。'); }
  } finally { busy = false; update(); }
});

// Restore credentials only. Reading jobs or filling a page always requires a click.
chrome.storage.session.get('ospConnection').then((data) => {
  const saved = data.ospConnection;
  if (saved) { elements.port.value = saved.port; elements.token.value = saved.token; message('已恢复本浏览器会话的配对信息，请点击配对读取当前作品。'); }
});

void refreshOfficialTabs().catch(() => {});
