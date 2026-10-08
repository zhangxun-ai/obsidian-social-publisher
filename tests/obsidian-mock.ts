import type { App, Plugin } from 'obsidian';

/** Synthetic, memory-only Obsidian runtime. It cannot access a user's filesystem. */
export class TFolder {
  readonly name: string;
  children: Array<TFolder | TFile> = [];
  parent: TFolder | null = null;
  constructor(public path: string) { this.name = path.split('/').pop() || ''; }
}

export class TFile {
  readonly name: string;
  readonly basename: string;
  readonly extension: string;
  parent: TFolder | null = null;
  stat: { ctime: number; mtime: number; size: number };
  constructor(public path: string, size: number, time: number) {
    this.name = path.split('/').pop()!;
    const dot = this.name.lastIndexOf('.');
    this.basename = dot < 0 ? this.name : this.name.slice(0, dot);
    this.extension = dot < 0 ? '' : this.name.slice(dot + 1);
    this.stat = { ctime: time, mtime: time, size };
  }
}

type Stored = { file: TFile; bytes: Uint8Array };
export class MockVault {
  readonly adapter = {};
  readonly files = new Map<string, Stored>();
  readonly folders = new Map<string, TFolder>([['', new TFolder('')]]);
  readonly reads: string[] = [];
  readonly binaryReads: string[] = [];
  readonly writes: string[] = [];
  beforeRead?: (path: string) => void | Promise<void>;
  beforeReadBinary?: (path: string) => void | Promise<void>;
  private time = 1_000;

  private attach(entry: TFolder | TFile): void {
    const index = entry.path.lastIndexOf('/');
    const parentPath = index < 0 ? '' : entry.path.slice(0, index);
    const parent = this.folders.get(parentPath);
    if (!parent) throw new Error(`Mock parent folder missing: ${parentPath}`);
    entry.parent = parent;
    parent.children.push(entry);
  }
  seedFolder(path: string): TFolder {
    let result = this.folders.get('')!;
    let prefix = '';
    for (const part of path.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (this.files.has(prefix)) throw new Error('Mock folder conflicts with a file.');
      const existing = this.folders.get(prefix);
      if (existing) result = existing;
      else {
        result = new TFolder(prefix);
        this.folders.set(prefix, result);
        this.attach(result);
      }
    }
    return result;
  }
  seedBytes(path: string, bytes: Uint8Array): TFile {
    const slash = path.lastIndexOf('/');
    this.seedFolder(slash < 0 ? '' : path.slice(0, slash));
    const stored = this.files.get(path);
    if (stored) {
      stored.bytes = new Uint8Array(bytes);
      stored.file.stat.mtime = ++this.time;
      stored.file.stat.size = bytes.length;
      return stored.file;
    }
    const file = new TFile(path, bytes.length, ++this.time);
    this.files.set(path, { file, bytes: new Uint8Array(bytes) });
    this.attach(file);
    return file;
  }
  seedText(path: string, text: string): TFile { return this.seedBytes(path, new TextEncoder().encode(text)); }
  text(path: string): string {
    const stored = this.files.get(path);
    if (!stored) throw new Error(`Mock file missing: ${path}`);
    return new TextDecoder().decode(stored.bytes);
  }
  bytes(path: string): Uint8Array {
    const stored = this.files.get(path);
    if (!stored) throw new Error(`Mock file missing: ${path}`);
    return new Uint8Array(stored.bytes);
  }
  getAbstractFileByPath(path: string): TFile | TFolder | null { return this.files.get(path)?.file ?? this.folders.get(path) ?? null; }
  getFiles(): TFile[] { return [...this.files.values()].map((stored) => stored.file); }
  getMarkdownFiles(): TFile[] { return this.getFiles().filter((file) => file.extension === 'md'); }
  async read(file: TFile): Promise<string> {
    this.reads.push(file.path);
    await this.beforeRead?.(file.path);
    return this.text(file.path);
  }
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    this.binaryReads.push(file.path);
    await this.beforeReadBinary?.(file.path);
    return this.bytes(file.path).buffer as ArrayBuffer;
  }
  async createFolder(path: string): Promise<void> {
    if (this.getAbstractFileByPath(path)) throw new Error('Mock target already exists.');
    const folder = new TFolder(path);
    this.attach(folder);
    this.folders.set(path, folder);
  }
  async create(path: string, text: string): Promise<TFile> {
    if (this.getAbstractFileByPath(path)) throw new Error('Mock target already exists.');
    const slash = path.lastIndexOf('/');
    if (!this.folders.has(slash < 0 ? '' : path.slice(0, slash))) throw new Error('Mock parent missing.');
    this.writes.push(path);
    return this.seedText(path, text);
  }
  async process(file: TFile, transform: (current: string) => string): Promise<string> {
    // Transform and replacement are synchronous, matching Vault.process's atomic callback.
    const next = transform(this.text(file.path));
    this.seedText(file.path, next);
    this.writes.push(file.path);
    return next;
  }
  getResourcePath(file: TFile): string { return `mock-resource://${encodeURIComponent(file.path)}`; }
}

export class MockPlugin {
  data: { settings?: unknown; boundAccount?: unknown; records?: unknown[] } | null = null;
  readonly saves: unknown[] = [];
  async loadData(): Promise<unknown> { return structuredClone(this.data); }
  async saveData(data: { settings?: unknown; boundAccount?: unknown; records?: unknown[] }): Promise<void> {
    this.data = structuredClone(data);
    this.saves.push(structuredClone(data));
  }
}

export function createMockEnvironment() {
  const vault = new MockVault();
  const plugin = new MockPlugin();
  const notices: string[] = [];
  const opened: string[] = [];
  const app = { vault, workspace: { openLinkText: async (path: string) => { opened.push(path); } } };
  return { vault, plugin, app: app as unknown as App, pluginApi: plugin as unknown as Plugin, notices, opened, notice: (message: string) => notices.push(message) };
}
