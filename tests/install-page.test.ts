import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

function loadPage() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://zhangxun-ai.github.io/obsidian-social-publisher/',
    beforeParse(window: { HTMLDialogElement: { prototype: HTMLDialogElement } }) {
      window.HTMLDialogElement.prototype.showModal = function () {
        if (this.open) throw new Error('Dialog already open');
        this.setAttribute('open', '');
      };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    },
  });
  // Test page feedback only; do not navigate to an external app protocol.
  dom.window.document.addEventListener('click', (event: Event) => event.preventDefault());
  return dom;
}

test('install immediately shows confirmation guidance without claiming success', () => {
  const dom = loadPage();
  try {
    const document = dom.window.document;
    (document.getElementById('install') as HTMLAnchorElement).click();
    assert.equal((document.getElementById('install-guide') as HTMLDialogElement).open, true);
    assert.match(document.getElementById('status')!.textContent!, /尚未确认安装/);
    assert.match(document.getElementById('install-guide')!.textContent!, /独立的设置窗口/);
    assert.match(document.getElementById('install-guide')!.textContent!, /网页无法检测是否安装成功/);
    const uri = new URL(document.getElementById('install')!.getAttribute('href')!);
    assert.equal(uri.protocol, 'obsidian:');
    assert.equal(uri.hostname, 'brat');
    assert.equal(uri.searchParams.get('plugin'), 'zhangxun-ai/obsidian-social-publisher');
  } finally { dom.window.close(); }
});

test('retry keeps guidance open; dismiss and subsequent install work', () => {
  const dom = loadPage();
  try {
    const document = dom.window.document;
    const guide = document.getElementById('install-guide') as HTMLDialogElement;
    (document.getElementById('install') as HTMLAnchorElement).click();
    (document.getElementById('retry-install') as HTMLAnchorElement).click();
    assert.equal(guide.open, true);
    assert.equal(document.getElementById('retry-install')!.getAttribute('href'), document.getElementById('install')!.getAttribute('href'));
    (document.getElementById('close-guide') as HTMLButtonElement).click();
    assert.equal(guide.open, false);
    (document.getElementById('install') as HTMLAnchorElement).click();
    assert.equal(guide.open, true);
  } finally { dom.window.close(); }
});
