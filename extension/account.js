/* Read only the same-origin official account endpoint. The browser keeps its session. */
(() => {
  if (globalThis.ObsidianSocialPublisherAccount) return;
  const endpoint = 'https://creator.xiaohongshu.com/api/galaxy/user/info';
  async function detect() {
    if (location.protocol !== 'https:' || location.hostname !== 'creator.xiaohongshu.com' || location.port) return { status: 'unknown' };
    if (/^\/login(?:\/|$)/.test(location.pathname)) return { status: 'logged-out' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      // No Cookie/header/storage access. Normal same-origin session handling stays in Chrome.
      const response = await fetch(endpoint, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (response.status === 401) return { status: 'logged-out' };
      if (!response.ok || response.redirected || response.url !== endpoint) return { status: 'unknown' };
      const data = await response.json();
      const accountId = data?.data?.userId;
      const nickname = data?.data?.userName;
      if (data?.success !== true || data?.code !== 0 || typeof accountId !== 'string' ||
        !/^[a-f0-9]{24}$/.test(accountId) || typeof nickname !== 'string' ||
        !nickname.trim() || nickname.length > 80 || /[\u0000-\u001f\u007f]/.test(nickname)) return { status: 'unknown' };
      // Project only these public fields; never retain or forward the rest of the response.
      return { status: 'recognized', accountId, nickname: nickname.trim() };
    } catch { return { status: 'unknown' }; }
    finally { clearTimeout(timer); }
  }
  globalThis.ObsidianSocialPublisherAccount = { detect };
})();
