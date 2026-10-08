/* Runs only after the user presses the popup's fill button. No publishing controls are accessed. */
(() => {
  if (globalThis.ObsidianSocialPublisherAdapter) return;
  let busy = false;
  let touched = false;
  const uploadedSelector = '[data-testid="uploaded-image"], .img-item, .image-item, .upload-list .upload-item, .upload-img-list img, .image-list img, .img-preview img, .photo-list img, .image-preview img';
  const titleSelector = 'input[placeholder*="标题"], textarea[placeholder*="标题"]';
  const bodySelector = '.tiptap.ProseMirror[contenteditable="true"], .ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"]';
  const visible = (element) => !element.hidden && !element.disabled && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
  const unique = (selector) => [...document.querySelectorAll(selector)].filter(visible);
  const pageAllowed = () => location.protocol === 'https:' && location.hostname === 'creator.xiaohongshu.com' && location.port === '' && location.pathname === '/publish/publish';

  function locate() {
    if (!pageAllowed()) throw new Error('请在小红书官方 /publish/publish 页面操作。');
    const title = unique(titleSelector);
    const body = unique(bodySelector);
    const files = [...document.querySelectorAll('input[type="file"]')].filter((input) =>
      !input.disabled && (/image\//i.test(input.accept) || /\.(?:png|jpe?g|webp|gif)(?:,|$)/i.test(input.accept)));
    if (files.length !== 1 || title.length > 1 || body.length > 1) {
      throw new Error('未能唯一识别图文编辑器；未进行填写，请手动处理。');
    }
    if (title.length !== body.length) throw new Error('编辑器尚未就绪，请等页面加载完成。');
    return { file: files[0], title: title[0], body: body[0] };
  }

  function assertEmpty(fields) {
    if ((fields.title?.value ?? '').trim() || (fields.body?.textContent ?? '').trim() ||
      fields.body?.querySelector('img,video,audio,iframe') || fields.file.files?.length ||
      unique(uploadedSelector).length) {
      throw new Error('编辑器已有文字或媒体，请另开空白编辑器；不会覆盖已有稿件。');
    }
  }

  function inspect() {
    try {
      if (busy || touched) throw new Error('这个页面已执行过填写，请先核实内容；不会再次上传。');
      const fields = locate();
      assertEmpty(fields);
      return { ready: true, phase: fields.title ? 'editor' : 'upload' };
    } catch (error) { return { ready: false, reason: error.message }; }
  }

  const waitForFields = async () => {
    for (let count = 0; count < 80; count += 1) {
      const fields = locate();
      if (fields.title && fields.body) return fields;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('图片已交给网页，但文字编辑器未能确认；请人工核实，不要重复上传。');
  };

  function setTitle(input, value) {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setBody(element, value) {
    // Build text-only paragraphs; never interpret a note as HTML or execute its markup.
    const fragment = document.createDocumentFragment();
    for (const line of value.split('\n')) {
      const paragraph = document.createElement('p');
      if (line) paragraph.textContent = line;
      else paragraph.append(document.createElement('br'));
      fragment.append(paragraph);
    }
    element.replaceChildren(fragment);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fill(payload) {
    const preflight = inspect();
    if (!preflight.ready) return { status: '失败', detail: preflight.reason };
    if (!payload || typeof payload.title !== 'string' || typeof payload.text !== 'string' ||
      !Array.isArray(payload.images) || payload.images.length === 0 ||
      payload.images.some((image) => typeof image.base64 !== 'string' || typeof image.name !== 'string' ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime))) {
      return { status: '失败', detail: '本次素材格式无效，未进行填写。' };
    }
    busy = true;
    try {
      let fields = locate();
      assertEmpty(fields);
      if (payload.images.length > 1 && !fields.file.multiple) throw new Error('网页未提供多图上传控件，未进行填写。');
      const transfer = new DataTransfer();
      for (const image of payload.images) {
        const bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], image.name, { type: image.mime }));
      }
      touched = true;
      fields.file.files = transfer.files;
      fields.file.dispatchEvent(new Event('change', { bubbles: true }));
      fields = await waitForFields();
      if ((fields.title.value ?? '').trim() || fields.body.textContent.trim()) {
        throw new Error('上传后发现编辑器已有文案，未覆盖；请核实网页。');
      }
      setTitle(fields.title, payload.title);
      setBody(fields.body, payload.text);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const paragraphs = [...fields.body.children];
      const returnedText = paragraphs.every((child) => child.tagName === 'P')
        ? paragraphs.map((child) => child.textContent).join('\n') : fields.body.innerText;
      if (fields.title.value !== payload.title || returnedText.replace(/\r\n/g, '\n') !== payload.text) {
        throw new Error('已尝试填写，但网页文案回读不一致，请人工核实。');
      }
      return { status: '结果待核实', detail: `已尝试选择 ${payload.images.length} 张图片并填写文案。此适配未经真实平台验收，图片完整性、账号、话题关联及原创声明均需人工核实；未保存平台草稿或发布。` };
    } catch (error) {
      return { status: touched ? '结果待核实' : '失败', detail: error.message };
    } finally { busy = false; }
  }

  globalThis.ObsidianSocialPublisherAdapter = { inspect, fill };
})();
