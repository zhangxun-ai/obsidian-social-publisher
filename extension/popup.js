const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries(['port', 'token', 'connect', 'forget', 'jobs', 'summary', 'account-check', 'empty-check', 'fill', 'status', 'detect-account', 'account-status', 'official-tabs', 'refresh-tabs', 'connection-panel', 'connection-state', 'connection-options', 'connection-error', 'account-panel', 'target-picker', 'fill-panel', 'jobs-panel', 'jobs-empty', 'refresh-jobs', 'open-login', 'auto-connection', 'discovery-status', 'vault-picker', 'vaults', 'choose-vault', 'open-obsidian', 'retry-connection', 'connection-recovery'].map((id) => [id, byId(id)]));
let connection = null;
let jobs = [];
let activeTaskId = null;
let busy = false;
let pairing = false;
let filling = false;
let connectionPhase = 'discovering';
let discoveredVaults = [];
let preferredVaultId = null;
let lastVaultId = null;
let connectionEpoch = 0;
let recoveryPromise = null;
let interruptedVault = null;
let connectionRejected = false;
let identityPromise = null;
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
  elements.connect.disabled = busy || !!activeTaskId;
  elements['detect-account'].disabled = busy || !connection || checkingAccount;
  elements.forget.disabled = busy || checkingAccount || !!activeTaskId;
  elements['official-tabs'].disabled = busy || checkingAccount || !!activeTaskId;
  elements['refresh-tabs'].disabled = busy || checkingAccount || !!activeTaskId;
  elements.jobs.disabled = busy || !connection || !!activeTaskId || jobs.length === 0;
  elements['connection-panel'].hidden = false;
  elements['auto-connection'].hidden = !!connection && !pairing;
  elements['choose-vault'].disabled = pairing || !elements.vaults.value;
  elements.vaults.disabled = pairing;
  elements['retry-connection'].hidden = !['missing', 'error', 'timeout', 'choosing'].includes(connectionPhase);
  elements['open-obsidian'].hidden = !['missing', 'error', 'timeout'].includes(connectionPhase);
  elements.connect.textContent = pairing ? '正在连接…' : '使用连接码';
  elements['connection-state'].textContent = connectionPhase === 'approval' ? '等待 Obsidian 确认' : pairing ? '正在连接…' : connection ? `已连接${connection.vaultName ? `「${connection.vaultName}」` : ' Obsidian'}` : '未连接 Obsidian';
  elements.forget.hidden = !connection;
  elements['account-panel'].hidden = !connection || pairing;
  elements['fill-panel'].hidden = !connection || (!jobs.length && !activeTaskId);
  elements['jobs-panel'].hidden = !connection || pairing;
  elements['jobs-empty'].hidden = !!jobs.length || !!activeTaskId;
  elements['refresh-jobs'].disabled = busy || !connection;
  elements.summary.textContent = activeTaskId
    ? '已有任务被领取。请先核实网页，再回 Obsidian 确认该篇已处理；不会自动重发。'
    : selected ? `账号：${selected.account || '未指定，请先回 Obsidian 补充'} · ${selected.imageCount} 张图片 · 首图为封面` : '';
}

async function localPost(port, path, body, token, timeout = 15_000) {
  const requestEpoch = connectionEpoch;
  try {
    const response = await timedFetch(`http://127.0.0.1:${port}${path}`, {
      // Chrome itself supplies the extension Origin. Never accept a claimed Origin.
      method: 'POST', mode: 'cors', cache: 'no-store', redirect: 'error',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }, timeout).catch(error => { error.connectionFailure = true; throw error; });
    if (!response.ok) { const error = new Error('本地连接请求未完成。'); error.status = response.status; throw error; }
    return await response.json();
  } catch (error) { error.localRequest = true; error.requestEpoch = requestEpoch; throw error; }
}
async function request(path, body) {
  if (!connection) throw new Error('请先连接 Obsidian。');
  try { return await localPost(connection.port, path, body, connection.token); }
  catch (error) {
    // Recovery may retry reads, never a claim, image transfer, result, or an active fill.
    if ((error.connectionFailure || [401, 403].includes(error.status)) && error.requestEpoch === connectionEpoch &&
      !connectionRejected && !filling && !activeTaskId && !recoveryPromise && connection?.vaultId &&
      ['/status', '/jobs', '/account-request', '/account-detect'].includes(path)) {
      await recoverTrustedConnection();
      if (connection) {
        try { return await localPost(connection.port, path, body, connection.token); }
        catch (retryError) {
          if (retryError.requestEpoch === connectionEpoch && (retryError.connectionFailure || [401, 403].includes(retryError.status))) {
            interruptedVault = { vaultId: connection.vaultId, vaultName: connection.vaultName };
            connection = null;
            stopAccountPolling();
            await chrome.storage.session.remove('ospConnection').catch(() => {});
            connectionState('error', '连接仍不可用。请打开原知识库，再重新查找。');
          }
          throw retryError;
        }
      }
    }
    throw error;
  }
}

const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validVault = (value) => value && value.protocol === 2 && typeof value.vaultId === 'string' &&
  /^[A-Za-z0-9_-]{1,128}$/.test(value.vaultId) && typeof value.vaultName === 'string' &&
  value.vaultName.trim().length > 0 && value.vaultName.length <= 120;
const pause = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
function randomId(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function installationIdentity() {
  if (!identityPromise) identityPromise = (async () => {
    const saved = (await chrome.storage.local.get('ospInstallation')).ospInstallation;
    if (saved && /^[A-Za-z0-9_-]{22}$/.test(saved.clientId) && validToken(saved.clientSecret)) {
      return { clientId: saved.clientId, clientSecret: saved.clientSecret };
    }
    const identity = { clientId: randomId(16), clientSecret: randomId(32) };
    await chrome.storage.local.set({ ospInstallation: identity });
    return identity;
  })().catch(error => { identityPromise = null; throw error; });
  return identityPromise;
}
function stopAccountPolling() {
  if (accountPoll) clearInterval(accountPoll);
  accountPoll = null;
}
function connectionState(phase, detail) {
  connectionPhase = phase;
  elements['discovery-status'].textContent = detail;
  update();
}
async function finishConnection(next, epoch) {
  if (epoch !== connectionEpoch) return;
  connection = next;
  interruptedVault = null;
  connectionRejected = false;
  pairing = false;
  lastAccountRequest = null;
  connectionPhase = 'connected';
  lastVaultId = next.vaultId ?? lastVaultId;
  await chrome.storage.session.set({ ospConnection: next }).catch(() => {});
  if (next.vaultId) await chrome.storage.local.set({ ospLastVaultId: next.vaultId }).catch(() => {});
  if (epoch !== connectionEpoch) return;
  elements['connection-options'].open = false;
  elements.token.value = '';
  clearConnectionError(); message(''); update();
  await refreshOfficialTabs().catch(() => { elements['account-status'].textContent = '请刷新页面列表，选择已登录的小红书页面。'; });
  if (epoch !== connectionEpoch) return;
  await refresh().catch(() => { message('已连接 Obsidian，读取作品失败。请点击「刷新待填写作品」。'); });
  if (epoch === connectionEpoch && connection) startAccountPolling();
}
async function connectToVault(vault, epoch) {
  pairing = true;
  connectionState('connecting', `正在连接「${vault.vaultName}」…`);
  try {
    const identity = await installationIdentity();
    let deadline = Date.now() + 120_000;
    while (epoch === connectionEpoch && Date.now() < deadline) {
      const result = await localPost(vault.port, '/connect', identity, null, 3000);
      if (epoch !== connectionEpoch) return;
      if (result.status === 'connected' && validToken(result.token)) {
        await finishConnection({ port: vault.port, token: result.token, vaultId: vault.vaultId, vaultName: vault.vaultName, protocol: 2 }, epoch);
        return;
      }
      if (result.status !== 'approval-required' || typeof result.requestId !== 'string' ||
        !Number.isFinite(result.expiresAt)) throw new Error('连接响应无效。');
      deadline = Math.min(deadline, result.expiresAt);
      connectionState('approval', `请在 Obsidian「${vault.vaultName}」确认连接。仅需确认一次，确认后自动继续。`);
      await pause(Math.min(1000, Math.max(0, deadline - Date.now())));
    }
    if (epoch === connectionEpoch) connectionState('timeout', '确认已超时。请重新查找，并在 Obsidian 确认连接。');
  } catch (error) {
    if (epoch === connectionEpoch && error.status === 403) connectionRejected = true;
    if (epoch === connectionEpoch) connectionState('error', error.status === 403
      ? '连接未获允许，请在 Obsidian 重新开启连接后重试。'
      : '连接未完成。请确认 Obsidian 和 Social Publisher 已打开，再重试。');
  } finally { if (epoch === connectionEpoch) { pairing = false; update(); } }
}
async function scanVaults() {
  return Promise.all(Array.from({ length: 8 }, async (_, offset) => {
    const port = 27123 + offset;
    try {
      const data = await localPost(port, '/discover', {}, null, 1000);
      return validVault(data) ? { protocol: 2, vaultId: data.vaultId, vaultName: data.vaultName, port } : null;
    } catch { return null; }
  }));
}
async function discoverVaults() {
  const epoch = ++connectionEpoch;
  connectionRejected = false;
  interruptedVault = null;
  stopAccountPolling();
  connection = null; pairing = true;
  discoveredVaults = [];
  elements['vault-picker'].hidden = true;
  connectionState('discovering', '正在查找已打开的知识库…');
  const results = await scanVaults();
  if (epoch !== connectionEpoch) return;
  const seen = new Set();
  discoveredVaults = results.filter(vault => vault && !seen.has(vault.vaultId) && seen.add(vault.vaultId));
  pairing = false;
  if (!discoveredVaults.length) {
    elements['connection-options'].hidden = false;
    connectionState('missing', '未找到 Social Publisher。请打开 Obsidian 中的目标知识库，并确认插件已启用。');
    return;
  }
  const wanted = preferredVaultId ?? lastVaultId;
  const remembered = discoveredVaults.find(vault => vault.vaultId === wanted);
  // A missing previous vault must never silently redirect the installation to another vault.
  if (remembered || (!wanted && discoveredVaults.length === 1)) {
    await connectToVault(remembered ?? discoveredVaults[0], epoch);
    return;
  }
  elements.vaults.replaceChildren(new Option('请选择知识库', ''));
  for (const vault of discoveredVaults) elements.vaults.append(new Option(vault.vaultName, vault.vaultId));
  elements['vault-picker'].hidden = false;
  connectionState('choosing', wanted ? '上次连接的知识库未打开。请选择本次要连接的知识库。' : '发现多个知识库，请选择本次要连接的知识库。');
}
async function recoverTrustedConnection() {
  if (recoveryPromise) return recoveryPromise;
  const previous = connection ?? interruptedVault;
  if (!previous?.vaultId || connectionRejected || filling || activeTaskId) return;
  const epoch = ++connectionEpoch;
  stopAccountPolling();
  interruptedVault = { vaultId: previous.vaultId, vaultName: previous.vaultName };
  connection = null;
  pairing = true;
  elements['vault-picker'].hidden = true;
  connectionState('discovering', `正在重新查找原知识库${previous.vaultName ? `「${previous.vaultName}」` : ''}…`);
  recoveryPromise = (async () => {
    try {
      await chrome.storage.session.remove('ospConnection').catch(() => {});
      const vaults = await scanVaults();
      if (epoch !== connectionEpoch) return;
      const vault = vaults.find(candidate => candidate?.vaultId === previous.vaultId);
      if (!vault) {
        connectionState('missing', '未找到原知识库。请打开 Obsidian 中的原知识库，再重新查找。');
        return;
      }
      await connectToVault(vault, epoch);
    } catch { if (epoch === connectionEpoch) connectionState('error', '连接已中断。请打开原知识库，再重新查找。'); }
  })().finally(() => { recoveryPromise = null; if (epoch === connectionEpoch) { pairing = false; update(); } });
  return recoveryPromise;
}
// One bounded attempt when returning after opening Obsidian; no timer-based rediscovery.
window.addEventListener('focus', () => {
  if (!['missing', 'error'].includes(connectionPhase) || connectionRejected || pairing || busy || checkingAccount || filling || activeTaskId || recoveryPromise) return;
  if (interruptedVault) void recoverTrustedConnection();
  else void discoverVaults();
});
elements.vaults.addEventListener('change', update);
elements['choose-vault'].addEventListener('click', async () => {
  const vault = discoveredVaults.find(candidate => candidate.vaultId === elements.vaults.value);
  if (!vault || pairing) return;
  preferredVaultId = vault.vaultId;
  await chrome.storage.local.set({ ospPreferredVaultId: vault.vaultId }).catch(() => {});
  await connectToVault(vault, ++connectionEpoch);
});
elements['retry-connection'].addEventListener('click', () => { if (!filling && !activeTaskId) void discoverVaults(); });
elements['connection-recovery'].addEventListener('click', () => {
  elements['connection-options'].hidden = false;
  elements['connection-options'].open = true;
});


async function detectCurrentAccount(tab) {
  if (!tab?.id || !allowedCreatorPage(tab.url)) return { status: 'unknown', reason: 'wrong-page' };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['account.js'] });
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => globalThis.ObsidianSocialPublisherAccount.detect() });
    return result[0]?.result ?? { status: 'unknown', reason: 'invalid-response' };
  } catch {
    const error = new Error('无法读取此标签页，请刷新小红书页面后重试。');
    error.pageRead = true;
    throw error;
  }
}
function accountRecovery(result) {
  const messages = {
    'wrong-page': '请选择小红书官方后台页面，再点击「重新检测」。',
    'login-required': '尚未登录。请打开小红书登录后，点击「重新检测」。',
    timeout: '账号检测超时。请检查浏览器网络，再点击「重新检测」。',
    network: '无法连接小红书。请检查浏览器网络，再点击「重新检测」。',
    'http-error': '小红书官方服务暂不可用，请稍后重新检测。',
    redirect: '官方页面发生跳转。请重新打开小红书官方后台，再重新检测。',
    'invalid-response': '官方账号信息暂无法可靠识别，请稍后重新检测；不会猜测账号 ID。',
    'identity-missing': '官方账号信息暂无法可靠识别，请稍后重新检测；不会猜测账号 ID。',
  };
  return typeof messages[result.reason] === 'string' ? messages[result.reason]
    : result.status === 'logged-out' ? messages['login-required'] : messages['invalid-response'];
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
  elements['target-picker'].hidden = tabs.length === 1;
  elements['refresh-tabs'].hidden = tabs.length === 1;
}
async function selectedOfficialTab() {
  const tabId = Number(elements['official-tabs'].value);
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return null;
  const tab = await chrome.tabs.get(tabId);
  return allowedCreatorPage(tab.url) ? tab : null;
}
elements['refresh-tabs'].addEventListener('click', async () => {
  try { await refreshOfficialTabs(); await respondToAccountRequest(true); } catch { message('无法读取页面列表，请重新打开扩展工作台。'); }
});
elements['official-tabs'].addEventListener('change', () => { void beginAccountDetection(); });

async function respondToAccountRequest(manual = false) {
  if (!connection || busy || checkingAccount) return;
  checkingAccount = true;
  update();
  try {
    const { request: pending } = await request('/account-request');
    if (!pending) {
      if (manual) elements['account-status'].textContent = '请回 Obsidian 点击「检测登录状态」；更新插件后，连接时会自动检测。';
      return;
    }
    if (pending.requestId === lastAccountRequest || pending.platform !== 'xiaohongshu') return;
    if (pending.expiresAt <= Date.now()) { elements['account-status'].textContent = '检测请求已过期，请点击「重新检测」。'; return; }
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
      ? `已识别：${result.nickname}。回 Obsidian 确认绑定即可。`
      : accountRecovery(result);
    elements['open-login'].hidden = result.status === 'recognized';
  } catch (error) {
    if (error.requestEpoch !== undefined && error.requestEpoch !== connectionEpoch) return;
    if (error.localRequest && (!error.status || [401, 403].includes(error.status))) {
      if (accountPoll) clearInterval(accountPoll);
      accountPoll = null; connection = null;
      if (!['error', 'timeout'].includes(connectionPhase)) connectionState('error', '连接已中断。请打开原知识库，再重新查找；旧版插件可使用高级连接。');
    } else elements['account-status'].textContent = error.status === 409
      ? '检测请求已更新或过期，请点击「重新检测」。'
      : error.pageRead ? '无法读取此标签页，请刷新小红书页面后重试。'
      : '账号检测未完成，请重新检测；仍无法完成时请重新连接 Obsidian。';
  }
  finally { checkingAccount = false; update(); }
}

function startAccountPolling() {
  if (accountPoll) clearInterval(accountPoll);
  // Runs only while this explicitly paired workspace stays open, never in the background.
  accountPoll = setInterval(() => { void respondToAccountRequest(); }, 2000);
  void respondToAccountRequest(true);
}

async function beginAccountDetection() {
  if (!connection || busy || checkingAccount) return;
  busy = true; update();
  elements['account-status'].textContent = '正在检测账号…';
  elements['open-login'].hidden = false;
  try {
    await refreshOfficialTabs();
    await request('/account-detect', {});
  } catch (error) {
    if (error.status !== 404) { elements['account-status'].textContent = '未能开始检测，请检查 Obsidian 连接后重试。'; return; }
    // Older plugins still support requests initiated in Obsidian.
    elements['account-status'].textContent = '请回 Obsidian 点击「检测登录状态」，或更新插件以自动检测。';
  } finally { busy = false; update(); }
  await respondToAccountRequest(true);
}
elements['detect-account'].addEventListener('click', () => { void beginAccountDetection(); });

async function refresh() {
  const epoch = connectionEpoch;
  const vaultId = connection?.vaultId;
  const data = await request('/jobs');
  if (epoch !== connectionEpoch && !connection) return;
  // A successful retry after same-vault trust recovery remains valid; another vault does not.
  if (!connection || (epoch !== connectionEpoch && (!vaultId || connection.vaultId !== vaultId))) return;
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
  const token = elements.token.value.replace(/[\t\n\r ]/g, '');
  clearConnectionError();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    elements['connection-options'].open = true;
    connectionError('连接端口不正确，请填写 Obsidian 中显示的端口。', elements.port);
    return;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    connectionError(token ? '连接码不完整或格式不正确。请在 Obsidian 点击「复制连接码」，重新粘贴。' : '请先粘贴从 Obsidian 复制的连接码。');
    return;
  }
  const epoch = ++connectionEpoch;
  stopAccountPolling();
  busy = true;
  pairing = true;
  connection = { port, token };
  update();
  try {
    await request('/pair', {});
    await finishConnection({ port, token }, epoch);
  } catch (error) {
    connection = null;
    jobs = [];
    connectionState('error', '旧版连接未完成。请查看高级连接中的提示，或重新查找知识库。');
    connectionError(error.status === 401 || error.status === 403
      ? '连接码已失效，或已连接其他浏览器。请在 Obsidian 断开连接后重新复制连接码。'
      : '无法连接 Obsidian。请确认插件已开启，再复制最新的连接码。');
  } finally { busy = false; pairing = false; update(); }
  if (!connection) return;
  startAccountPolling();
});

function clearConnectionError() {
  elements['connection-error'].hidden = true;
  for (const element of [elements.token, elements.port]) element.removeAttribute('aria-invalid');
}
function connectionError(text, field = elements.token) {
  elements['connection-error'].textContent = text;
  elements['connection-error'].hidden = false;
  field.setAttribute('aria-invalid', 'true');
  update(); field.focus();
}
for (const field of [elements.token, elements.port]) field.addEventListener('input', clearConnectionError);
elements['refresh-jobs'].addEventListener('click', async () => {
  if (!connection || busy) return;
  busy = true; update();
  try { await refresh(); message(''); } catch { message('作品未能读取，请确认 Obsidian 连接仍开启后重试。'); }
  finally { busy = false; update(); }
});

elements.forget.addEventListener('click', async () => {
  ++connectionEpoch;
  await chrome.storage.session.remove('ospConnection');
  if (accountPoll) clearInterval(accountPoll);
  accountPoll = null;
  lastAccountRequest = null;
  connection = null;
  jobs = [];
  activeTaskId = null;
  elements.token.value = '';
  elements.jobs.replaceChildren(new Option('请先连接', ''));
  clearConnectionError(); message('');
  connectionState('missing', '已断开连接。需要继续时请重新查找知识库。');
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
  filling = true;
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
  } finally { filling = false; busy = false; update(); }
});

// Opening the workbench resumes its authorized session; first trust still needs Obsidian approval.
async function initializeConnection() {
  const initialEpoch = connectionEpoch;
  try {
    const savedLocal = await chrome.storage.local.get(['ospPreferredVaultId', 'ospLastVaultId']);
    preferredVaultId = savedLocal.ospPreferredVaultId ?? null;
    lastVaultId = savedLocal.ospLastVaultId ?? null;
    const saved = (await chrome.storage.session.get('ospConnection')).ospConnection;
    if (initialEpoch !== connectionEpoch) return;
    if (saved && Number.isInteger(saved.port) && saved.port >= 1024 && saved.port <= 65535 && validToken(saved.token)) {
      // Even an expired session identifies its vault. Never fall through to another one.
      if (typeof saved.vaultId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(saved.vaultId)) lastVaultId = saved.vaultId;
      const epoch = ++connectionEpoch;
      pairing = true; update();
      try {
        await localPost(saved.port, '/status', {}, saved.token, 1000);
        await finishConnection(saved, epoch);
        return;
      } catch { await chrome.storage.session.remove('ospConnection').catch(() => {}); }
      pairing = false;
    }
    await discoverVaults();
  } catch { pairing = false; connectionState('error', '无法恢复浏览器连接。请重新查找；仍无法连接时可使用高级连接。'); }
}
void refreshOfficialTabs().catch(() => {});
update();
void initializeConnection();
