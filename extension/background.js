// The action opens one persistent workspace. No background polling or page injection.
let opening = false;
chrome.action.onClicked.addListener(() => {
  if (opening) return;
  opening = true;
  void (async () => {
    try {
      const url = chrome.runtime.getURL('popup.html');
      const existing = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
      const tab = existing.find((context) => Number.isInteger(context.tabId) && context.tabId >= 0);
      if (tab) {
        await chrome.tabs.update(tab.tabId, { active: true });
        if (Number.isInteger(tab.windowId)) {
          const window = await chrome.windows.get(tab.windowId);
          await chrome.windows.update(tab.windowId, window.state === 'minimized'
            ? { focused: true, state: 'normal' } : { focused: true });
        }
      } else await chrome.tabs.create({ url });
    } finally { opening = false; }
  })();
});
