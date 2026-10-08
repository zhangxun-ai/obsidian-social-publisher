import { extractBody, listSections, moveImage, selectedInFilter, toPlatformText, validatePublication } from './core';
import type { Issue, Publication } from './types';
import type { Preview, PublisherHost } from './host';

type Screen = 'works' | 'editor' | 'preview' | 'records' | 'settings' | 'create' | 'import' | 'confirm';
type Child = Node | string | undefined | null;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  for (const child of children) if (child !== undefined && child !== null) node.append(child);
  return node;
}
function button(text: string, action: () => unknown, kind = '', disabled = false): HTMLButtonElement {
  const node = el('button', `sp-button ${kind}`, text); node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', () => { void action(); }); return node;
}
function input(value: string, label: string, change: (value: string) => void, type = 'text'): HTMLInputElement {
  const node = el('input', 'sp-input'); node.type = type; node.value = value; node.setAttribute('aria-label', label);
  node.addEventListener('input', () => change(node.value)); return node;
}
function select(value: string, label: string, options: Array<[string, string]>, change: (value: string) => void): HTMLSelectElement {
  const node = el('select', 'sp-input'); node.setAttribute('aria-label', label);
  for (const [key, text] of options) { const option = el('option', '', text); option.value = key; node.append(option); }
  node.value = value; node.addEventListener('change', () => change(node.value)); return node;
}
function field(label: string, control: Node, hint = ''): HTMLElement {
  return el('label', 'sp-field', el('span', 'sp-label', label), control, hint ? el('span', 'sp-muted', hint) : null);
}
function checkbox(label: string, checked: boolean, change: (value: boolean) => void): HTMLInputElement {
  const node = el('input', 'sp-checkbox'); node.type = 'checkbox'; node.checked = checked; node.setAttribute('aria-label', label);
  node.addEventListener('change', () => change(node.checked)); return node;
}
function basename(path: string): string { return path.split('/').pop() || path; }
function status(pub: Publication): string {
  if (!pub.registered) return '未设置发布内容';
  if ([...pub.issues, ...validatePublication(pub), ...toPlatformText(pub.body).issues].some(i => i.severity === 'error')) return '需要修改';
  return pub.status || '草稿';
}
function badge(text: string): HTMLElement {
  const taskLabels: Record<string, string> = {
    '已准备': '等待浏览器填写', '正在填写': '正在填写网页',
    '待人工确认': '等待核对网页', '结果待核实': '填写结果待核对',
    '需重新准备': '需重新创建任务', '失败': '填写未完成',
  };
  return el('span', `sp-badge ${['需要修改', '未设置发布内容', '失败', '结果待核实', '需重新准备'].includes(text) ? 'sp-warning' : ['待发布', '已准备', '待人工确认'].includes(text) ? 'sp-purple' : ''}`, taskLabels[text] || text);
}

/**
 * THESIS: Obsidian 内完成准确的图文准备，选择、图序与预览在同一工作台可核对。
 * OWN-WORLD: 继承宿主浅/深色主题，细分隔线、紧凑表格、少量紫色强调。
 * STORY: 发现稿件 → 明确正文 → 关联素材 → 预览确认 → 本地准备 → 官方页面核对。
 * FIRST VIEWPORT: 顶部三个导航，左侧作品表格与底部选择栏，右侧封面和正文预览。
 * FORM: 用户已确认 UI/02-workspace.png 和 UI/03-editor.png，不重新选择视觉方向。
 */
export class PublisherUI {
  private screen: Screen = 'works';
  private publications: Publication[] = [];
  private selected = new Set<string>();
  private approvals = new Map<string, string>();
  private activePath = '';
  private query = '';
  private filter = '全部';
  private account = '';
  private draft: Publication | null = null;
  private preview: Preview | null = null;
  private previewExpired = false;
  private imageIndex = 0;
  private busy = false;
  private error = '';
  private unsubscribe: () => void;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;

  constructor(private root: HTMLElement, private host: PublisherHost) {
    root.classList.add('sp-app');
    this.unsubscribe = host.subscribe(() => this.requestRefresh());
  }
  async mount(): Promise<void> { await this.reload(true); }
  requestRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { void this.reload(false); }, 180);
  }
  destroy(): void { this.unsubscribe(); clearTimeout(this.refreshTimer); this.root.replaceChildren(); }
  async reload(render = true): Promise<void> {
    try {
      this.publications = await this.host.list();
      for (const [path, approved] of [...this.approvals]) {
        try {
          const current = await this.host.inspect(path);
          if (this.approvals.get(path) === approved && current.fingerprint !== approved) this.approvals.delete(path);
        } catch { if (this.approvals.get(path) === approved) this.approvals.delete(path); }
      }
      if (!this.activePath || !this.publications.some(p => p.path === this.activePath)) this.activePath = this.publications[0]?.path || '';
      let changedPreview = false;
      if (this.screen === 'preview' && this.preview) {
        const next = await this.host.inspect(this.preview.publication.path);
        if (next.fingerprint !== this.preview.fingerprint) { this.previewExpired = true; this.error = '源内容或图片已变化，此前预览已过期。请重新打开预览。'; this.approvals.delete(next.publication.path); changedPreview = true; }
      }
      if (render || changedPreview || ['works', 'records', 'confirm'].includes(this.screen)) this.render();
    } catch (error) { if(this.screen==='preview')this.previewExpired=true;this.error = (error as Error).message; this.render(); }
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.render();
    try { await action(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; this.render(); }
  }
  private go(screen: Screen): void {
    if (this.draft && screen !== 'editor') {
      this.confirmDiscard(() => { this.draft = null; this.screen = screen; this.error = ''; this.render(); }); return;
    }
    this.screen = screen; this.error = ''; this.render();
  }
  private confirmDiscard(next: () => void): void {
    const dialog = el('dialog', 'sp-dialog', el('h2', '', '离开编辑？'), el('p', '', '当前表单的修改尚未保存。'));
    const controls = el('div', 'sp-actions', button('继续编辑', () => { dialog.close(); dialog.remove(); }), button('放弃修改', () => { dialog.close(); dialog.remove(); next(); }, 'sp-primary'));
    dialog.append(controls); this.root.append(dialog); dialog.addEventListener('cancel', () => dialog.remove()); dialog.showModal();
  }
  private get visible(): Publication[] {
    return this.publications.filter(p => (this.filter === '全部' || status(p) === this.filter) && (!this.account || p.account === this.account) && `${p.title} ${p.path}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
  }
  private get chosen(): Publication[] { return selectedInFilter(this.visible, this.selected); }
  private render(): void {
    this.revision += 1;
    const top = el('header', 'sp-top', el('strong', 'sp-brand', 'Social Publisher'));
    const nav = el('nav', 'sp-nav'); nav.setAttribute('aria-label', 'Social Publisher');
    for (const [key, label] of [['works', '作品'], ['records', '填写任务记录'], ['settings', '设置']] as const) {
      const active = key === 'works' ? !['records', 'settings'].includes(this.screen) : this.screen === key;
      const b = button(label, () => this.go(key), active ? 'sp-nav-active' : '');
      if (active) b.setAttribute('aria-current', 'page'); nav.append(b);
    }
    top.append(nav, el('span', 'sp-top-note', this.host.demo ? '合成示例 · 不读取真实知识库' : '本地工作区'));
    const main = el('main', 'sp-main'); main.setAttribute('aria-busy', String(this.busy));
    this.root.replaceChildren(top, main);
    if (this.error) {
      const banner = el('div', 'sp-error', el('span', '', this.error), button('关闭提示', () => {this.error = ''; this.render();}, 'sp-text'));
      banner.setAttribute('role', 'alert'); main.append(banner);
    }
    if (!this.host.settings.configured && this.screen !== 'settings') this.onboard(main);
    else if (this.screen === 'works') this.works(main);
    else if (this.screen === 'editor') this.editor(main);
    else if (this.screen === 'preview') this.fullPreview(main);
    else if (this.screen === 'create') this.create(main);
    else if (this.screen === 'import') this.importNotes(main);
    else if (this.screen === 'confirm') this.confirmBatch(main);
    else if (this.screen === 'records') this.records(main);
    else this.settings(main);
    if (this.busy) {
      main.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true);
      const live = el('div', 'sp-busy', '正在处理，请稍候…'); live.setAttribute('role', 'status'); main.append(live);
    }
  }
  private heading(main: HTMLElement, title: string, subtitle = '', actions?: HTMLElement): void {
    main.append(el('div', 'sp-heading', el('div', '', el('h1', '', title), subtitle ? el('p', 'sp-muted', subtitle) : null), actions));
  }
  private onboard(main: HTMLElement): void {
    this.heading(main, '选择要管理的发布内容', '使用已有笔记，或为新作品创建独立文件夹。');
    const form = el('form', 'sp-onboard sp-panel');
    let roots = this.host.settings.roots.join('\n'); let account = this.host.settings.defaultAccount;
    const dirs = el('textarea', 'sp-input'); dirs.value = roots; dirs.rows = 3; dirs.setAttribute('aria-label', '发布内容目录'); dirs.oninput = () => roots = dirs.value;
    form.append(el('h2', '', '选择发布内容目录'), field('相对于当前知识库的路径', dirs, '每行一个目录；只扫描这里的 Markdown，不扫描整个 02-项目。'), field('默认发布账号（可稍后填写）', input(account, '默认发布账号', v => account = v), '仅用于本地核对，不表示已登录。'), el('p', 'sp-note', '文案和图片保存在本地。准备完成后，你可以在官方编辑器核对并发布。'));
    const start = button('打开作品工作台', () => this.run(async () => { await this.host.saveSettings({...this.host.settings, roots: roots.split('\n').map(s => s.trim()).filter(Boolean), defaultAccount: account}); await this.reload(false); }), 'sp-primary');
    form.append(start); form.onsubmit = event => {event.preventDefault(); start.click();}; main.append(form);
  }
  private works(main: HTMLElement): void {
    this.heading(main, '发布作品', '', el('div', 'sp-actions', button('使用已有笔记', () => this.go('import')), button('新建作品', () => this.go('create'), 'sp-primary')));
    main.querySelector('h1')?.append(el('span','sp-work-count',`${this.publications.length} 篇`));
    const layout = el('div', 'sp-workspace'); const left = el('section', 'sp-work-list');
    const search = input(this.query, '搜索标题或文件名', value => {
      this.query = value; this.selected.clear();
      const cursor = search.selectionStart; this.render();
      const next = this.root.querySelector<HTMLInputElement>('[aria-label="搜索标题或文件名"]'); next?.focus(); if (cursor !== null) next?.setSelectionRange(cursor, cursor);
    }); search.placeholder = '搜索标题或文件名'; search.type = 'search';
    const filters = el('div', 'sp-filter-bar', search);
    for (const key of ['全部', '待发布', '草稿', '需要修改', '未设置发布内容']) {
      const count = this.publications.filter(p => key === '全部' || status(p) === key).length;
      filters.append(button(`${key} ${count}`, () => {this.filter = key; this.selected.clear(); this.render();}, this.filter === key ? 'sp-filter-active' : ''));
    }
    filters.append(select(this.account, '按账号筛选', [['', '全部账号'], ...[...new Set(this.publications.map(p => p.account).filter(Boolean))].map(a => [a, a] as [string,string])], value => {this.account = value; this.selected.clear(); this.render();}));
    left.append(filters);
    const tableWrap = el('div', 'sp-table-wrap'); const table = el('table', 'sp-table');
    const head = el('tr', '', el('th', '', checkbox('全选当前筛选结果', this.visible.length > 0 && this.chosen.length === this.visible.length, checked => {this.selected = new Set(checked ? this.visible.map(p => p.path) : []); this.render();})), el('th', '', '作品'), el('th', '', '状态'), el('th', 'sp-media-col', '图片'), el('th', 'sp-time-col', '更新'));
    table.append(el('thead', '', head)); const body = el('tbody');
    for (const pub of this.visible) {
      const row = el('tr', this.selected.has(pub.path) ? 'sp-selected' : this.activePath === pub.path ? 'sp-focused' : '');
      const name = button(pub.title || basename(pub.path), () => {this.activePath = pub.path; this.imageIndex = 0; this.render();}, 'sp-title-button');
      const meta = el('div', 'sp-title-meta', name, el('span', 'sp-path', pub.path.replace(this.host.settings.roots.find(r => pub.path.startsWith(r)) + '/', '')), el('span', 'sp-muted', pub.account || '未指定账号'));
      row.append(el('td', '', checkbox(`选择 ${pub.title}`, this.selected.has(pub.path), checked => {checked ? this.selected.add(pub.path) : this.selected.delete(pub.path); this.render();})), el('td', '', el('div', 'sp-work-title', this.image(pub.images[0], 'sp-cover-small'), meta)), el('td', '', badge(status(pub))));
      const images = el('td', 'sp-media-col'); const strip = el('div', 'sp-thumb-strip'); for (const path of pub.images.slice(0,4)) strip.append(this.image(path, 'sp-thumb')); if (pub.images.length > 4) strip.append(el('span', 'sp-muted', `+${pub.images.length - 4}`)); images.append(strip); row.append(images);
      row.append(el('td', 'sp-time-col sp-muted', new Intl.DateTimeFormat('zh-CN', {month:'2-digit',day:'2-digit'}).format(pub.mtime || Date.now()))); body.append(row);
    }
    table.append(body); tableWrap.append(table);
    if (!this.visible.length) tableWrap.append(el('div', 'sp-empty', el('h2', '', this.publications.length ? '没有匹配的作品' : '还没有发布作品'), el('p', 'sp-muted', this.publications.length ? '调整搜索或筛选条件，继续查找。' : '新建一篇作品，或选择已有笔记并设置发布内容。'), button(this.publications.length ? '清除筛选' : '新建作品', () => {if(this.publications.length) {this.filter = '全部'; this.query = ''; this.account = ''; this.render();} else this.go('create');})));
    left.append(tableWrap, el('footer', 'sp-selection-bar', el('span', 'sp-muted', `已选 ${this.chosen.length} 篇 · 当前列表 ${this.visible.length} 篇`), el('div', 'sp-actions', button('取消选择', () => {this.selected.clear(); this.render();}, 'sp-text', !this.chosen.length), button(`创建填写任务 · ${this.chosen.length} 篇`, () => this.go('confirm'), 'sp-primary', !this.chosen.length))));
    const rail = el('aside', 'sp-preview-rail sp-panel'); const pub = this.publications.find(p => p.path === this.activePath);
    if (pub) this.rail(rail, pub); else rail.append(el('p', 'sp-muted', '选择一篇作品，在这里预览。'));
    layout.append(left, rail); main.append(layout);
  }
  private image(path = '', className = ''): HTMLElement {
    const url = path ? this.host.mediaUrl(path) : '';
    if (!url) return el('div', `${className} sp-image-empty`, '未关联图片');
    const img = el('img', className); img.src = url; img.alt = basename(path); img.loading = 'lazy'; img.draggable = false;
    img.addEventListener('error', () => {img.replaceWith(el('div', `${className} sp-image-empty`, '图片不可读'));}, {once:true}); return img;
  }
  private carousel(container: HTMLElement, pub: Publication): void {
    if (this.imageIndex >= pub.images.length) this.imageIndex = 0;
    container.append(this.image(pub.images[this.imageIndex], 'sp-preview-cover'));
    const controls = el('div', 'sp-carousel', button('上一张', () => {this.imageIndex = (this.imageIndex - 1 + pub.images.length) % pub.images.length; this.render();}, 'sp-text', pub.images.length < 2), el('span', 'sp-muted', pub.images.length ? `${this.imageIndex + 1} / ${pub.images.length}` : '0 张'), button('下一张', () => {this.imageIndex = (this.imageIndex + 1) % pub.images.length; this.render();}, 'sp-text', pub.images.length < 2)); container.append(controls);
  }
  private rail(container: HTMLElement, pub: Publication): void {
    container.append(el('h2', '', '本次内容')); this.carousel(container, pub);
    const converted = toPlatformText(pub.body);
    container.append(el('h3', '', pub.title || '尚未填写标题'), el('p', 'sp-excerpt', converted.text || (pub.registered ? '添加发布正文后，这里会显示转换后的内容。' : '先选择要发布的正文和图片，再保存发布设置。')));
    const topics = el('div', 'sp-topics'); for (const topic of pub.topics) topics.append(el('span', 'sp-topic', `#${topic}`));
    container.append(topics, el('p', 'sp-muted', `${pub.images.length} 张图片 · ${status(pub)}`), el('div', 'sp-actions', button(pub.registered ? '编辑作品' : '将已有笔记用于发布', () => this.edit(pub), 'sp-primary'), button('完整预览', () => this.openPreview(pub.path), 'sp-text', !pub.registered)), el('div', 'sp-rail-foot', '仅在本地整理，尚未上传或发布'));
  }
  private edit(pub: Publication): void { this.draft = structuredClone(pub); this.activePath = pub.path; this.screen = 'editor'; this.error = ''; this.render(); }
  private editor(main: HTMLElement): void {
    const draft = this.draft; if (!draft) {this.screen = 'works'; this.works(main); return;}
    const save = () => this.run(async () => {
      const saved = await this.host.save(draft); this.approvals.delete(saved.path); this.draft = null; await this.reload(false); this.activePath = saved.path; this.screen = 'works'; this.host.notify('修改已保存在本地。');
    });
    main.append(button('返回作品', () => this.go('works'), 'sp-text sp-back'));
    this.heading(main, draft.registered ? '编辑作品' : '将已有笔记用于发布', '选择要发布的正文和图片。保存会写回原笔记，其他章节会保留。', el('div', 'sp-actions', button('取消', () => this.go('works')), button('保存到原笔记', save, 'sp-primary', !draft.bodySource)));
    const layout = el('div', 'sp-editor-grid'); const fields = el('section', 'sp-panel');
    const title = input(draft.title, '发布标题', value => draft.title = value); fields.append(field('发布标题', title));
    const modes = el('div', 'sp-segments');
    for (const [value, text] of [['whole','使用整篇笔记'], ['section','只使用指定章节']] as const) {
      const radio = el('input'); radio.type = 'radio'; radio.name = 'sp-body-source'; radio.checked = draft.bodySource === value;
      radio.addEventListener('change', () => {draft.bodySource = value; try {draft.body = value === 'whole' ? extractBody(draft.raw, 'whole') : draft.section ? extractBody(draft.raw, 'section', draft.section) : '';} catch(error){this.error = (error as Error).message;} this.render();});
      modes.append(el('label', draft.bodySource === value ? 'sp-segment-active' : '', radio, text));
    }
    fields.append(field('发布正文范围', modes));
    if (!draft.registered) fields.append(el('p', 'sp-note', '请选择要发布的范围。若笔记含研究或复盘，请只使用指定章节；系统不会自动选中整篇。'));
    if (draft.bodySource === 'section') {
      const sections = listSections(draft.raw);
      fields.append(field('对外发布的章节', select(draft.section, '正文章节', [['','请选择章节'], ...sections.map(s => [s.key, s.label] as [string,string])], value => {draft.section = value; try {draft.body = value ? extractBody(draft.raw, 'section', value) : '';} catch(error){this.error = (error as Error).message;} this.render();}), '只采用所选标题下的内容，直到下一同级或更高标题。'));
    }
    fields.append(el('div', 'sp-source-line', el('span','sp-muted', `来源：${basename(draft.path)}`), button('在 Obsidian 中打开', () => this.host.openNote(draft.path), 'sp-text')));
    const body = el('textarea', 'sp-input sp-body-input'); body.value = draft.body; body.disabled = !draft.bodySource || (draft.bodySource === 'section' && !draft.section); body.setAttribute('aria-label','发布正文'); body.placeholder = '在这里写对外发布的正文…'; body.addEventListener('input', () => draft.body = body.value);
    fields.append(field('发布正文', body, '保留换行；完整预览会展示转换后的实际填写文本。'));
    const topics = input(draft.topics.join('，'), '小红书话题', value => draft.topics = [...new Set(value.split(/[,，\n#]+/).map(s => s.trim()).filter(Boolean))]);
    fields.append(field('小红书话题', topics, '用逗号分隔。候选文字，需在官方编辑器确认话题关联。'));
    const settings = el('div', 'sp-field-row', field('发布账号', input(draft.account, '发布账号', value => draft.account = value)), field('原创声明', select(draft.originality, '原创声明', [['未确认','未确认'], ['声明原创','声明原创'], ['不声明','不声明']], value => draft.originality = value as Publication['originality'])));
    const statusOptions: Array<[string,string]> = [['草稿','草稿'],['待发布','待发布']];
    if (!statusOptions.some(([value])=>value===draft.status)) statusOptions.push([draft.status, `${draft.status}（原记录）`]);
    fields.append(settings, field('稿件状态', select(draft.status, '稿件状态', statusOptions, value => draft.status = value), '本地状态，不表示平台结果。'));
    const media = el('section', 'sp-panel sp-media-editor');
    media.append(el('h2', '', `发布图片 · ${draft.images.length} 张`), el('p','sp-muted','首图为封面。拖动排序，也可使用前移、后移按钮。'));
    const grid = el('div', 'sp-image-grid');
    draft.images.forEach((path,index) => {
      const item = el('div', 'sp-image-item'); item.draggable = true;
      item.addEventListener('dragstart', event => event.dataTransfer?.setData('application/x-sp-image-index', String(index)));
      item.addEventListener('dragover', event => event.preventDefault());
      item.addEventListener('drop', event => {event.preventDefault(); const from = Number(event.dataTransfer?.getData('application/x-sp-image-index')); if (Number.isInteger(from)) {draft.images = moveImage(draft.images, from, index); this.render();}});
      item.append(el('div', 'sp-image-number', index === 0 ? '封面' : String(index + 1).padStart(2,'0')), this.image(path, 'sp-edit-image'), el('span','sp-image-name',basename(path)), el('div', 'sp-image-controls', button('设封面', () => {draft.images = moveImage(draft.images,index,0);this.render();}, '', index === 0), button('前移', () => {draft.images = moveImage(draft.images,index,index-1);this.render();}, '', index === 0), button('后移', () => {draft.images = moveImage(draft.images,index,index+1);this.render();}, '', index === draft.images.length - 1), button('移除', () => {draft.images.splice(index,1); if(!draft.candidates.includes(path))draft.candidates.push(path);this.render();}, 'sp-text'))); grid.append(item);
    });
    if (!draft.images.length) grid.append(el('div', 'sp-media-empty', '还没有发布图片。请从下方添加图片。'));
    media.append(grid, el('p','sp-muted','移除关联不会删除原图。新出现的图片不会自动加入。'), el('hr'), el('h2','',`可添加的图片 · ${draft.candidates.filter(p=>!draft.images.includes(p)).length} 张`));
    const candidates = el('div', 'sp-candidate-grid');
    for (const path of draft.candidates.filter(p=>!draft.images.includes(p))) {
      const b = button('', () => {draft.images.push(path);this.render();}, 'sp-candidate'); b.setAttribute('aria-label',`添加图片 ${basename(path)}`); b.append(this.image(path,'sp-candidate-image'), el('span','',basename(path))); candidates.append(b);
    }
    media.append(candidates, button('从知识库选择图片', () => this.imagePicker(draft), 'sp-text'), el('p','sp-muted','也可将新图存入当前作品的「图片」目录，然后重新打开编辑。'));
    layout.append(fields,media); main.append(layout, el('footer','sp-editor-footer',el('span','sp-muted','本地草稿 · 保存后重新预览'),button('保存并预览',()=>this.run(async()=>{const saved=await this.host.save(draft);this.approvals.delete(saved.path);this.draft=null;await this.reload(false);this.preview=await this.host.inspect(saved.path);this.previewExpired=false;this.screen='preview';}), 'sp-primary',!draft.bodySource)));
  }
  private imagePicker(draft: Publication): void {
    const dialog = el('dialog','sp-dialog'); dialog.append(el('h2','','从知识库选择图片'),el('p','sp-muted','输入文件名或路径，仅将明确选中的图片加入本次作品。'));
    const list = el('div','sp-picker-results');
    const search = input('', '搜索知识库图片', query => {
      list.replaceChildren();
      for(const path of this.host.searchImages(query)) list.append(button(path,()=>{if(!draft.images.includes(path))draft.images.push(path);dialog.close();dialog.remove();this.render();},'sp-picker-result'));
      if(!list.childElementCount)list.append(el('p','sp-muted',query?'没有匹配的图片。':'输入关键词开始查找。'));
    }); search.placeholder='输入图片文件名或路径'; dialog.append(search,list,button('关闭',()=>{dialog.close();dialog.remove();})); this.root.append(dialog);dialog.addEventListener('cancel',()=>dialog.remove());dialog.showModal();search.focus();
  }
  private async openPreview(path: string): Promise<void> {
    await this.run(async()=>{this.preview=await this.host.inspect(path);this.previewExpired=false;this.screen='preview';this.imageIndex=0;});
  }
  private issues(container: HTMLElement, issues: Issue[]): void {
    if(!issues.length){container.append(el('p','sp-check-ok','本地检查通过。平台限制与排版请在官方编辑器核对。'));return;}
    const list=el('ul','sp-issues');for(const issue of issues)list.append(el('li',issue.severity==='error'?'sp-issue-error':'',`${issue.severity==='error'?'需要修改':'请核对'}：${issue.message}`));container.append(list);
  }
  private fullPreview(main: HTMLElement): void {
    const preview=this.preview;if(!preview)return;
    const pub=preview.publication;const expired=this.previewExpired;const errors=preview.issues.some(i=>i.severity==='error');
    main.append(button('返回作品',()=>this.go('works'),'sp-text sp-back'));
    this.heading(main,'实际填写内容预览','这是本次标题、纯文本正文和图片顺序。平台效果以官方编辑器为准。',el('div','sp-actions',button('重新加载预览',()=>this.openPreview(pub.path)),button('编辑作品',()=>this.edit(pub))));
    const layout=el('div','sp-full-preview');const phone=el('section','sp-platform-preview');this.carousel(phone,pub);phone.append(el('h2','',pub.title),el('div','sp-final-text',preview.text));
    const checks=el('section','sp-panel');checks.append(el('h2','','发布前检查'),el('div','sp-preview-stats',el('span','',`标题 ${[...pub.title].length} 字`),el('span','',`正文 ${[...preview.text].length} 字`),el('span','',`${pub.images.length} 张图片`)),el('p','sp-muted',`核对账号：${pub.account||'尚未指定'}`));this.issues(checks,preview.issues);
    checks.append(el('div','sp-actions',button('复制标题',()=>this.copy(pub.title),'',errors),button('复制正文',()=>this.copy(preview.text),'',errors)),el('hr'),el('p','sp-note','原创声明、话题关联和平台设置，需要在官方编辑器确认。本地检查不代表平台审核结果。'),button(this.approvals.get(pub.path)===preview.fingerprint?'已确认此版本':'确认此版本',()=>this.run(async()=>{const current=await this.host.inspect(pub.path);if(current.fingerprint!==preview.fingerprint)throw new Error('源内容或图片已变化，此前预览已过期。请重新加载预览。');this.approvals.set(pub.path,preview.fingerprint);this.host.notify('已确认本次版本。');}), 'sp-primary',errors||expired),button('返回任务确认',()=>this.go('confirm'),'sp-text',!this.chosen.length));
    layout.append(phone,checks);main.append(layout);
  }
  private async copy(text:string):Promise<void>{try{await navigator.clipboard.writeText(text);this.host.notify('已复制。');}catch{this.host.notify('复制失败，请手动选择文本复制。');}}
  private create(main:HTMLElement):void{
    main.append(button('返回作品',()=>this.go('works'),'sp-text sp-back'));this.heading(main,'新建发布作品','一篇作品一个文件夹，文案与专属图片放在一起。');let title='';
    const form=el('form','sp-panel sp-form-narrow');const name=input('','作品主题',value=>title=value);name.placeholder='例如：AI 文案为什么有机器味';
    const submit=button('创建并开始编辑',()=>this.run(async()=>{const pub=await this.host.create(title);await this.reload(false);this.edit(pub);}), 'sp-primary');
    form.append(field('作品主题',name),el('div','sp-folder-example',`${this.host.settings.roots[0]}/\n└── P编号-作品主题/\n    ├── 小红书.md\n    └── 图片/`),el('p','sp-muted','图片文件名可保持 GPT Image 的原名，无需重命名。'),submit);form.onsubmit=e=>{e.preventDefault();submit.click();};main.append(form);
  }
  private importNotes(main:HTMLElement):void{
    main.append(button('返回作品',()=>this.go('works'),'sp-text sp-back'));this.heading(main,'使用已有笔记','选择一篇笔记，设置要发布的正文和图片。保存到原笔记，不复制或移动文件。');
    const panel=el('section','sp-panel');const unregistered=this.publications.filter(p=>!p.registered);
    for(const pub of unregistered)panel.append(el('div','sp-import-row',el('div','',el('strong','',pub.title),el('p','sp-muted',pub.path)),button('选择并核对正文',()=>this.edit(pub),'sp-primary')));
    if(!unregistered.length)panel.append(el('div','sp-empty',el('h2','','当前目录没有尚未设置发布内容的笔记'),el('p','sp-muted','要使用其他位置的笔记，请先将所在目录加入内容目录。'),button('管理内容目录',()=>this.go('settings'))));main.append(panel);
  }
  private confirmBatch(main:HTMLElement):void{
    main.append(button('返回作品',()=>this.go('works'),'sp-text sp-back'));this.heading(main,'确认填写任务',`本次 ${this.chosen.length} 篇；仅处理当前筛选中的明确选择。`);
    const panel=el('section','sp-panel');let allApproved=this.chosen.length>0;
    for(const pub of this.chosen){const approved=this.approvals.has(pub.path);if(!approved)allApproved=false;panel.append(el('div','sp-confirm-row',this.image(pub.images[0],'sp-cover-small'),el('div','sp-grow',el('strong','',pub.title),el('p','sp-muted',`${pub.account||'未指定账号'} · ${pub.images.length} 张图片`)),badge(approved?'已核对版本':'待预览'),button(approved?'再次预览':'查看并确认',()=>this.openPreview(pub.path))));}
    if(!this.chosen.length)panel.append(el('p','sp-muted','当前没有选中的作品。请返回列表选择。'));
    panel.append(el('hr'),el('p','sp-note','创建任务会保留本次已确认的标题、正文和图片顺序，供浏览器扩展填写小红书编辑器。内容变化后需重新预览并创建任务。此步骤不会上传或发布。'),el('div','sp-actions',button(`创建 ${this.chosen.length} 篇填写任务`,()=>this.run(async()=>{const entries=this.chosen.map(pub=>({path:pub.path,fingerprint:this.approvals.get(pub.path)||''}));await this.host.prepare(entries);this.selected.clear();this.screen='records';}), 'sp-primary',!allApproved),button('返回选择',()=>this.go('works'))));main.append(panel);
  }
  private records(main:HTMLElement):void{
    this.heading(main,'填写任务记录','查看等待填写、正在填写和需要核对的任务。填写完成后，请到小红书编辑器核对；不会自动发布或重试。',el('div','sp-actions',button('取消待填写任务',()=>this.run(async()=>{for(const record of this.host.records().filter(r=>r.status==='已准备'))await this.host.cancel(record.id);}), '',!this.host.records().some(r=>r.status==='已准备')),button('刷新',()=>this.reload()),button('浏览器连接',()=>this.go('settings'))));
    const records=this.host.records();const panel=el('section','sp-panel');
    if(!records.length)panel.append(el('div','sp-empty',el('h2','','还没有填写任务'),el('p','sp-muted','选择作品并核对完整预览，再创建填写任务。'),button('前往作品',()=>this.go('works'),'sp-primary')));
    for(const record of records){const row=el('article','sp-record');const header=el('div','sp-record-head',el('div','sp-grow',el('h2','',record.title),el('p','sp-muted',`${record.account||'未指定账号'} · ${record.imageCount} 张 · ${new Date(record.createdAt).toLocaleString('zh-CN')}`)),badge(record.status));row.append(header,el('p','',record.detail));const actions=el('div','sp-actions',button('打开原笔记',()=>this.host.openNote(record.path),'sp-text'));
      if(['已准备','需重新准备'].includes(record.status))actions.append(button('取消填写任务',()=>this.run(()=>this.host.cancel(record.id))));
      if(!record.closed&&['待人工确认','结果待核实','失败'].includes(record.status))actions.append(button('已核对当前页面，允许下一篇',()=>{this.host.acknowledge(record.id);this.host.notify('已允许填写下一篇。请在浏览器扩展中手动选择并开始。');}),button('结束此任务',()=>this.run(()=>this.host.cancel(record.id)),'sp-text'));
      row.append(actions);panel.append(row);
    }
    main.append(panel,el('p','sp-muted','浏览器辅助填写为实验功能。完成填写不等于保存草稿或发布成功；平台草稿与直接发布尚未开放。'));
  }
  private settings(main:HTMLElement):void{
    this.heading(main,'设置','内容留在知识库，发布动作由你确认。');const layout=el('div','sp-settings-grid');const local=el('section','sp-panel');local.append(el('h2','','本地内容'));
    let roots=this.host.settings.roots.join('\n');let account=this.host.settings.defaultAccount;let port=this.host.settings.port;
    const dirs=el('textarea','sp-input');dirs.value=roots;dirs.rows=4;dirs.setAttribute('aria-label','内容目录');dirs.oninput=()=>roots=dirs.value;
    local.append(field('内容目录（每行一个）',dirs,'相对于当前知识库。新增目录后保存，已有笔记保持原位。'),field('默认账号',input(account,'默认账号',value=>account=value),'本地核对标识，不保存登录信息。'),field('本地连接端口',input(String(port),'本地连接端口',value=>port=Number(value),'number')),button('保存设置',()=>this.run(async()=>{await this.host.saveSettings({...this.host.settings,roots:roots.split('\n').map(s=>s.trim()).filter(Boolean),defaultAccount:account,port});await this.reload(false);this.host.notify('设置已保存。');}),'sp-primary'));
    const connection=this.host.connection();const browser=el('section','sp-panel');browser.append(el('h2','','浏览器辅助填写'),badge(connection.running?(connection.paired?'扩展已配对':'等待配对'):'未连接'),el('p','sp-muted','手动开启本地连接后，在配套扩展中输入端口和本次配对码。只传递已确认的作品。'));
    if(connection.running){const token=input(connection.token,'本次配对码',()=>{},'password');token.readOnly=true;token.autocomplete='off';browser.append(field('本次配对码',token,'关闭连接或重启后失效。'),el('div','sp-actions',button('复制配对码',()=>this.copy(connection.token)),button('关闭连接',()=>this.run(()=>this.host.disconnect()))));}
    else browser.append(button('开启本地连接',()=>this.run(()=>this.host.connect()),'sp-primary',!!this.host.demo));
    browser.append(el('hr'),el('h3','','当前能力'),el('ul','sp-capabilities',el('li','','编辑图文、核对预览、创建填写任务'),el('li','','实验：官方图文编辑页辅助填写'),el('li','','平台草稿、直接发布：尚未开放')),el('p','sp-note','使用配套扩展时，先手动打开小红书官方图文编辑页。核对账号和空白编辑器后，再选择一篇任务。'));
    layout.append(local,browser);main.append(layout);
  }
}
