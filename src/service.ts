import { TFile, TFolder, type App, type Plugin } from 'obsidian';
import { randomUUID } from 'node:crypto';
import { basename, dirname, posix, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { parsePublication, normalizeImageReference, normalizeVaultPath, withinScope, validatePublication, toPlatformText, fingerprint, hashBytes } from './core';
import type { Publication, Issue, ImageVersion } from './types';
import { readFrontmatter, writePublication } from './storage';
import { LocalBridge, type BridgeJob, type AccountDetectionReport, type AccountDetectionRequest } from './bridge';
import { DEFAULT_SETTINGS, type PublisherHost, type PublisherSettings, type Preview, type RunRecord, type PlatformAccount, type AccountDetection, type AccountState } from './host';

const ACCOUNT_DETECTION_TTL = 120_000;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
type Snapshot = { record: RunRecord; job: BridgeJob };

export class PublisherService implements PublisherHost {
  settings = structuredClone(DEFAULT_SETTINGS);
  private history: RunRecord[] = [];
  private snapshots = new Map<string, Snapshot>();
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private preparing = false;
  private binding: PlatformAccount | null = null;
  private detection: AccountDetection | null = null;
  private detectionExpiresAt = 0;
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;
  readonly bridge: LocalBridge;

  constructor(private app: App, private plugin: Plugin, private notice: (text: string) => void) {
    this.bridge = new LocalBridge({
      listJobs: () => [...this.snapshots.values()].filter(s => s.record.status === '已准备').map(s => ({id: s.record.id, title: s.job.title, account: s.job.account, accountId: s.job.accountId, imageCount: s.job.images.length})),
      validateJob: id => this.validateSnapshot(id),
      validateAccount: (id, accountId) => this.validateAccount(id, accountId),
      connectionChanged: () => {
        if (!this.bridge.running || !this.bridge.pairedExtensionId) this.clearDetection();
        this.emit();
      },
      accountRequest: () => this.accountRequest(),
      reportAccount: report => this.reportAccount(report),
      claimJob: async (id, accountId) => {
        this.validateAccount(id, accountId);
        await this.validateSnapshot(id);
        this.validateAccount(id, accountId);
        const snapshot = this.snapshots.get(id)!;
        snapshot.record.status = '正在填写';
        snapshot.record.detail = '浏览器已领取；等待官方页面填写结果。';
        snapshot.record.updatedAt = Date.now();
        await this.persist(); this.emit();
        return snapshot.job;
      },
      report: async (id, status, detail) => {
        const snapshot = this.snapshots.get(id);
        if (!snapshot) throw new Error('任务不存在。');
        snapshot.record.status = status;
        snapshot.record.detail = detail.slice(0, 500);
        snapshot.record.updatedAt = Date.now();
        await this.persist(); this.emit();
      }
    });
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data) {
      this.binding = this.publicAccount(data.boundAccount);
      this.settings = {...DEFAULT_SETTINGS, ...data.settings};
      this.settings.roots = this.settings.roots.map((root: string) => normalizeVaultPath(root));
      this.history = Array.isArray(data.records) ? data.records.slice(-300) : [];
      for (const record of this.history) {
        if (record.status === '已准备') { record.status = '需重新准备'; record.detail = '插件重新启动，请重新预览和准备此版本。'; }
        if (record.status === '正在填写') { record.status = '结果待核实'; record.detail = '填写期间插件已关闭，请先核对官方页面，系统不会自动重试。'; }
      }
    }
  }
  private persist(): Promise<void> {
    this.writes = this.writes.catch(() => {}).then(() => this.plugin.saveData({settings: this.settings, boundAccount: this.binding, records: this.history.slice(-300)}));
    return this.writes;
  }
  private emit(): void { for (const listener of this.listeners) listener(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(message: string): void { this.notice(message); }
  private publicAccount(value: unknown): PlatformAccount | null {
    if (!value || typeof value !== 'object') return null;
    const account = value as Partial<PlatformAccount>;
    if (account.platform !== 'xiaohongshu' || typeof account.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(account.accountId) ||
      typeof account.nickname !== 'string' || !account.nickname.trim() || account.nickname.length > 100 || /[\u0000-\u001f\u007f]/.test(account.nickname) ||
      typeof account.checkedAt !== 'number' || !Number.isFinite(account.checkedAt) || account.checkedAt <= 0) return null;
    return {platform: 'xiaohongshu', accountId: account.accountId, nickname: account.nickname.trim(), checkedAt: account.checkedAt};
  }
  accountState(): AccountState {
    const detection = this.detection ? structuredClone(this.detection) : null;
    if (detection && Date.now() > this.detectionExpiresAt) { detection.status = 'unknown'; delete detection.account; }
    return {binding: this.binding ? {...this.binding} : null, detection, connected: this.bridge.running, paired: !!this.bridge.pairedExtensionId};
  }
  private accountRequest(): AccountDetectionRequest | null {
    if (!this.detection || this.detection.status !== 'waiting' || Date.now() > this.detectionExpiresAt) return null;
    return {requestId: this.detection.requestId, platform: 'xiaohongshu', expiresAt: this.detectionExpiresAt};
  }
  private clearDetection(): void {
    this.detection = null; this.detectionExpiresAt = 0;
    if (this.detectionTimer) clearTimeout(this.detectionTimer);
    this.detectionTimer = null;
  }
  private scheduleDetectionExpiry(): void {
    if (this.detectionTimer) clearTimeout(this.detectionTimer);
    this.detectionTimer = setTimeout(() => {
      this.detectionTimer = null;
      if (this.detection) { this.detection.status = 'unknown'; delete this.detection.account; this.emit(); }
    }, Math.max(1, this.detectionExpiresAt - Date.now() + 1));
    this.detectionTimer.unref?.();
  }
  async requestAccountDetection(): Promise<void> {
    if (!this.bridge.running || !this.bridge.pairedExtensionId) throw new Error('请先连接配套浏览器扩展，并保持扩展面板打开。');
    this.detection = {requestId: randomUUID(), status: 'waiting', checkedAt: Date.now()};
    this.detectionExpiresAt = Date.now() + ACCOUNT_DETECTION_TTL;
    this.scheduleDetectionExpiry(); this.emit();
  }
  private reportAccount(report: AccountDetectionReport): void {
    if (!this.accountRequest() || report.requestId !== this.detection?.requestId) throw new Error('账号检测请求已经失效。');
    const now = Date.now();
    const account = report.status === 'recognized' ? this.publicAccount({platform: 'xiaohongshu', accountId: report.accountId, nickname: report.nickname, checkedAt: now}) : null;
    if (report.status === 'recognized' && !account) throw new Error('账号公开信息不完整。');
    this.detection = {requestId: report.requestId, status: report.status, checkedAt: now, ...(account ? {account} : {})};
    this.detectionExpiresAt = now + ACCOUNT_DETECTION_TTL;
    this.scheduleDetectionExpiry(); this.emit();
  }
  async bindAccount(requestId: string): Promise<void> {
    const detection = this.detection;
    if (!this.bridge.running || !this.bridge.pairedExtensionId || !detection || detection.requestId !== requestId ||
      detection.status !== 'recognized' || !detection.account || Date.now() > this.detectionExpiresAt) {
      throw new Error('请重新检测账号，再核对并绑定。');
    }
    this.binding = {...detection.account};
    await this.persist(); this.emit();
  }
  async unbindAccount(): Promise<void> {
    this.binding = null;
    this.clearDetection();
    await this.persist(); this.emit();
  }
  private validateAccount(id: string, actualAccountId: string): void {
    const snapshot = this.snapshots.get(id);
    if (!snapshot || !this.binding || actualAccountId !== this.binding.accountId || snapshot.job.accountId !== this.binding.accountId) {
      throw new Error('网页账号与作品绑定账号不一致。');
    }
  }
  private allowed(path: string): boolean { return withinScope(path, this.settings.roots); }
  private file(path: string): TFile {
    const entry = this.app.vault.getAbstractFileByPath(normalizeVaultPath(path));
    if (!(entry instanceof TFile)) throw new Error(`文件不存在：${path}`);
    return entry;
  }
  private resolveImage(reference: string, source: string): string {
    const clean = normalizeImageReference(reference);
    const linked = this.app.metadataCache?.getFirstLinkpathDest(clean, source);
    if (linked instanceof TFile) return linked.path;
    // Match Obsidian source-relative references before any global basename fallback.
    for (const possible of [posix.join(dirname(source), clean), clean]) {
      try {
        const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(possible));
        if (file instanceof TFile) return file.path;
      } catch { /* unresolved references are shown as blocking issues */ }
    }
    const matches = this.app.vault.getFiles().filter(f => f.name === clean);
    if (matches.length === 1) return matches[0].path;
    return clean;
  }
  private async loadPublication(file: TFile): Promise<Publication> {
    await this.ensureInVault(file.path);
    const raw = await this.app.vault.read(file);
    const pub = parsePublication(file.path, raw, readFrontmatter(raw), file.stat.mtime);
    pub.images = [...new Set(pub.images.map(ref => this.resolveImage(ref, file.path)))];
    const folder = dirname(file.path);
    const local = this.app.vault.getFiles().filter(f => IMAGE_EXTENSIONS.has(f.extension.toLowerCase()) && (f.parent?.path === folder || f.parent?.path === `${folder}/图片`)).map(f => f.path);
    pub.candidates = [...new Set([...pub.candidates.map(ref => this.resolveImage(ref, file.path)), ...local])].filter(p => !pub.images.includes(p));
    return pub;
  }
  async list(): Promise<Publication[]> {
    const files = this.app.vault.getMarkdownFiles().filter(f => this.allowed(f.path));
    const publications: Publication[] = [];
    for (const file of files) {
      try { publications.push(await this.loadPublication(file)); }
      catch (error) {
        const fallback = parsePublication(file.path, '', {}, file.stat.mtime);
        fallback.issues.push({code: 'invalid_frontmatter', severity: 'error', message: (error as Error).message});
        publications.push(fallback);
      }
    }
    const counts = new Map<string, number>();
    for (const pub of publications) if (pub.id) counts.set(pub.id, (counts.get(pub.id) || 0) + 1);
    for (const pub of publications) {
      if (pub.id && (counts.get(pub.id) || 0) > 1) pub.issues.push({code: 'duplicate_id', severity: 'error', message: '稳定 ID 重复，请在原笔记中修正 id 后再准备。'});
      for (const path of pub.images) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) pub.issues.push({code: 'missing_image', severity: 'error', message: `找不到图片：${basename(path)}`});
        else if (!IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) pub.issues.push({code: 'image_format', severity: 'error', message: `请使用 PNG、JPEG 或 WebP：${file.name}`});
      }
    }
    return publications.sort((a, b) => b.mtime - a.mtime);
  }
  async save(publication: Publication): Promise<Publication> {
    if (!this.allowed(publication.path)) throw new Error('作品不在已配置目录内。');
    const pub = {...publication, id: publication.id || randomUUID(), registered: true};
    for (const path of pub.images) normalizeVaultPath(path);
    await this.app.vault.process(this.file(pub.path), current => writePublication(current, pub));
    const saved = await this.loadPublication(this.file(pub.path));
    this.emit(); return saved;
  }
  async create(title: string): Promise<Publication> {
    title = title.trim();
    if (!title) throw new Error('请填写作品主题。');
    const root = normalizeVaultPath(this.settings.roots[0] || '');
    const slug = title.replace(/[\\/:*?"<>|#\[\]^]/g, '-').replace(/\.+$/g, '').slice(0, 70).trim();
    if (!slug || slug === '.' || slug === '..') throw new Error('主题无法用作目录名，请换一个名称。');
    const entries = this.app.vault.getAllLoadedFiles?.() || this.app.vault.getFiles();
    const numbers = entries.filter(entry => entry.path.startsWith(root + '/')).map(entry => /^P(\d+)(?:-|$)/.exec(entry.path.slice(root.length + 1).split('/')[0])).filter((match): match is RegExpExecArray => !!match).map(match => Number(match[1]));
    const number = Math.max(0, ...numbers) + 1;
    const folder = `${root}/P${String(number).padStart(3, '0')}-${slug}`;
    if (this.app.vault.getAbstractFileByPath(folder)) throw new Error('作品目录已存在，请稍后重试。');
    await this.ensureFolder(`${folder}/图片`);
    const file = await this.app.vault.create(`${folder}/小红书.md`, '');
    const pub = parsePublication(file.path, '', {}, file.stat.mtime);
    pub.title = title; pub.id = randomUUID(); pub.bodySource = 'whole'; pub.body = '';
    pub.account = this.binding?.nickname || this.settings.defaultAccount; pub.accountId = this.binding?.accountId || ''; pub.status = '草稿';
    return this.save(pub);
  }
  private async ensureFolder(path: string): Promise<void> {
    let prefix = '';
    for (const part of normalizeVaultPath(path).split('/')) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const entry = this.app.vault.getAbstractFileByPath(prefix);
      if (!entry) await this.app.vault.createFolder(prefix);
      else if (!(entry instanceof TFolder)) throw new Error('同名文件阻止创建目录。');
    }
  }
  private async readImage(path: string): Promise<Buffer> {
    const file = this.file(path);
    if (!IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) throw new Error('不支持的图片格式。');
    if (file.stat.size > 20 * 1024 * 1024) throw new Error(`图片超过本地传输上限 20 MB：${file.name}`);
    await this.ensureInVault(path);
    const bytes = Buffer.from(await this.app.vault.readBinary(file));
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!png && !jpeg && !webp) throw new Error(`图片内容无法识别：${file.name}`);
    return bytes;
  }
  private async ensureInVault(path: string): Promise<void> {
    const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {getBasePath?: () => string};
    if (adapter.getBasePath) {
      const base = await realpath(adapter.getBasePath());
      const target = await realpath(resolve(base, path));
      if (!target.startsWith(base + sep)) throw new Error('文件链接超出当前知识库。');
    }
  }
  async inspect(path: string): Promise<Preview> {
    const publications = await this.list();
    const pub = publications.find(p => p.path === path);
    if (!pub) throw new Error('作品已移出配置目录，请刷新列表。');
    const converted = toPlatformText(pub.body);
    const issues: Issue[] = [...pub.issues, ...validatePublication(pub), ...converted.issues];
    if (!this.binding || !pub.accountId || pub.accountId !== this.binding.accountId) {
      issues.push({code: 'account-not-bound', severity: 'error', message: '请先在平台与账号中登录并绑定账号，再为作品选择该发布账号。'});
    }
    const images: ImageVersion[] = [];
    for (const path of pub.images) {
      try { images.push({path, hash: await hashBytes(await this.readImage(path))}); }
      catch (error) { images.push({path, hash: 'unreadable'}); issues.push({code: 'unreadable_image', severity: 'error', message: (error as Error).message}); }
    }
    if (pub.topics.length) issues.push({code: 'topics_manual', severity: 'warning', message: '话题为候选文字，请在官方编辑器确认话题关联。'});
    const text = [converted.text, pub.topics.map(t => `#${t.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n');
    return {publication: pub, text, issues: [...new Map(issues.map(i => [`${i.code}:${i.message}`, i])).values()], fingerprint: await fingerprint(pub, images)};
  }
  async prepare(approved: Array<{path: string; fingerprint: string}>): Promise<void> {
    if (this.preparing) throw new Error('另一批作品正在准备，请等待完成。');
    this.preparing = true;
    try {
    if (!approved.length) throw new Error('请选择作品。');
    if (new Set(approved.map(a => a.path)).size !== approved.length) throw new Error('选中作品重复。');
    const pending: Snapshot[] = [];
    const expectedSources = new Map<string, string>();
    let total = 0;
    for (const approval of approved) {
      const preview = await this.inspect(approval.path);
      if (preview.fingerprint !== approval.fingerprint) throw new Error('内容或图片已变化，请重新预览确认。');
      if (preview.issues.some(i => i.severity === 'error')) throw new Error('作品仍有阻断问题，请修复后重新准备。');
      if (this.history.some(r => r.path === approval.path && !r.closed && ['已准备', '正在填写', '待人工确认', '结果待核实'].includes(r.status))) throw new Error('此作品已有待处理任务。请先核对记录并完成或取消该任务。');
      const pub = preview.publication;
      expectedSources.set(pub.path, pub.raw);
      const images = [];
      let jobBytes = 0;
      const imageVersions: ImageVersion[] = [];
      for (const path of pub.images) {
        const data = await this.readImage(path); total += data.length;
        jobBytes += data.length;
        if (jobBytes > 100 * 1024 * 1024) throw new Error('单篇图片超过本地传输上限 100 MB，请减少图片。');
        if (total > 200 * 1024 * 1024) throw new Error('本次图片超过本地队列上限 200 MB，请减少所选作品。');
        imageVersions.push({path, hash: await hashBytes(data)});
        const ext = this.file(path).extension.toLowerCase();
        images.push({name: basename(path), mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', data});
      }
      if (await fingerprint(pub, imageVersions) !== approval.fingerprint) throw new Error('读取期间图片已变化，请重新预览。');
      const current = await this.inspect(pub.path);
      if (current.fingerprint !== approval.fingerprint || current.issues.some(i => i.severity === 'error')) throw new Error('准备期间源内容已变化，请重新预览。');
      const record: RunRecord = {id: randomUUID(), path: pub.path, title: pub.title, account: pub.account, accountId: pub.accountId!, imageCount: images.length, fingerprint: preview.fingerprint, createdAt: Date.now(), updatedAt: Date.now(), status: '已准备', detail: '本地快照已准备，尚未传入官方页面。'};
      pending.push({record, job: {id: record.id, title: pub.title, account: pub.account, accountId: pub.accountId!, text: preview.text, originality: pub.originality, topics: [...pub.topics], images}});
    }
    // Check every source after all asynchronous image reads, before committing any task.
    for (const [path, raw] of expectedSources) {
      if (await this.app.vault.read(this.file(path)) !== raw) throw new Error('准备期间源内容已变化，请重新预览。');
    }
    if (pending.some(snapshot => snapshot.job.accountId !== this.binding?.accountId)) throw new Error('准备期间绑定账号已变化，请重新预览。');
    for (const snapshot of pending) { this.history.push(snapshot.record); this.snapshots.set(snapshot.record.id, snapshot); }
    await this.persist(); this.emit();
    } finally { this.preparing = false; }
  }
  private async validateSnapshot(id: string): Promise<void> {
    const snapshot = this.snapshots.get(id);
    if (!snapshot || !['已准备', '正在填写', '待人工确认'].includes(snapshot.record.status)) throw new Error('任务不可传输，请重新准备。');
    const preview = await this.inspect(snapshot.record.path);
    if (preview.fingerprint !== snapshot.record.fingerprint || preview.issues.some(i => i.severity === 'error')) {
      snapshot.record.status = '结果待核实'; snapshot.record.detail = '源内容或图片已变化，传输已停止，请核对官方页面后重新准备。';
      await this.persist(); this.emit(); throw new Error('源内容或图片已变化，已停止传输。');
    }
  }
  records(): RunRecord[] { return [...this.history].reverse(); }
  async cancel(id: string): Promise<void> {
    const record = this.history.find(r => r.id === id);
    if (!record || record.status === '正在填写') throw new Error('当前作品正在填写。请在浏览器停止并核对结果。');
    if (record.status === '已准备' || record.status === '需重新准备') { record.status = '已取消'; record.detail = '停止本地任务，未进行平台提交。'; }
    else { record.status = '结果待核实'; record.detail = '已结束本地跟踪。请自行核对官方页面；此状态不代表撤回或发布成功。'; }
    record.closed = true;
    this.snapshots.delete(id); this.bridge.acknowledge(id); await this.persist(); this.emit();
  }
  acknowledge(id: string): void {
    const record = this.history.find(r => r.id === id);
    if (!record || record.status === '正在填写') return;
    this.bridge.acknowledge(id);
    record.closed = true;
    record.detail += ' 已人工核对当前页面并结束本地跟踪；未自动确认平台草稿或发布结果。';
    this.snapshots.delete(id);
    void this.persist().catch(() => this.notice('记录保存失败，请保留当前页面并重新核对。'));
    this.emit();
  }
  mediaUrl(path: string): string {
    try { return this.app.vault.getResourcePath(this.file(path)); } catch { return ''; }
  }
  searchImages(query: string): string[] {
    if (!query.trim()) return [];
    return this.app.vault.getFiles().filter(f => IMAGE_EXTENSIONS.has(f.extension.toLowerCase()) && f.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 80).map(f => f.path);
  }
  openNote(path: string): void { void this.app.workspace.openLinkText(path, '', true); }
  async saveSettings(settings: PublisherSettings): Promise<void> {
    if (!settings.roots.length) throw new Error('请至少配置一个内容目录。');
    const roots = [...new Set(settings.roots.map(p => normalizeVaultPath(p.trim())))];
    if (roots.some(p => !p || p.startsWith('.') || !(this.app.vault.getAbstractFileByPath(p) instanceof TFolder))) throw new Error('请先在知识库创建这些目录，再保存设置。');
    if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw new Error('端口须为 1024–65535 的整数。');
    if (this.bridge.running && settings.port !== this.settings.port) await this.disconnect();
    this.settings = {...settings, roots, configured: true}; await this.persist(); this.emit();
  }
  async connect(): Promise<void> { await this.bridge.start(this.settings.port); this.emit(); }
  async disconnect(): Promise<void> {
    await this.bridge.stop();
    this.clearDetection();
    for (const record of this.history) if (record.status === '正在填写') { record.status = '结果待核实'; record.detail = '本地连接已关闭，请核对官方页面，不会自动重发。'; }
    await this.persist(); this.emit();
  }
  connection() { return {running: this.bridge.running, port: this.bridge.port || this.settings.port, paired: !!this.bridge.pairedExtensionId, token: this.bridge.token}; }
  async dispose(): Promise<void> { await this.disconnect(); this.listeners.clear(); }
}
