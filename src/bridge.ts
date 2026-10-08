import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface AccountDetectionRequest {
  requestId: string;
  platform: 'xiaohongshu';
  expiresAt: number;
}
export interface AccountDetectionReport {
  requestId: string;
  status: 'recognized' | 'logged-out' | 'unknown';
  accountId?: string;
  nickname?: string;
}

export type BridgeResultStatus = '待人工确认' | '失败' | '结果待核实';

export interface BridgeJobSummary {
  id: string;
  title: string;
  account: string;
  accountId: string;
  imageCount: number;
}

export interface BridgeJob {
  id: string;
  title: string;
  text: string;
  account: string;
  accountId: string;
  originality: string;
  topics: string[];
  images: { name: string; mime: string; data: Buffer }[];
}

export interface BridgeProvider {
  listJobs(): BridgeJobSummary[] | Promise<BridgeJobSummary[]>;
  claimJob(id: string, accountId: string): BridgeJob | Promise<BridgeJob>;
  validateAccount(id: string, accountId: string): void | Promise<void>;
  requestAccountDetection?(): void | Promise<void>;
  accountRequest?(): AccountDetectionRequest | null;
  reportAccount?(report: AccountDetectionReport): void;
  connectionChanged?(): void;
  /** Throw if the confirmed source, selected images, or their bytes have changed. */
  validateJob(id: string): void | Promise<void>;
  report(id: string, status: BridgeResultStatus, detail: string): void | Promise<void>;
}

const RESULT_STATUSES = new Set<BridgeResultStatus>(['待人工确认', '失败', '结果待核实']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
const MAX_BODY_BYTES = 4096;
const MAX_JOB_BYTES = 100 * 1024 * 1024;

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** A manually started, token-paired bridge. It never reads files itself. */
export class LocalBridge {
  private server: Server | null = null;
  private sessionToken = '';
  private listenPort: number | null = null;
  private extensionId: string | null = null;
  private currentTaskId: string | null = null;
  private currentJob: BridgeJob | null = null;
  private readonly claimed = new Set<string>();
  private resultRecorded = false;
  private resultInFlight = false;
  private claimInFlight = false;
  private session = 0;

  constructor(private readonly provider: BridgeProvider) {}

  get token(): string { return this.sessionToken; }
  get running(): boolean { return this.server?.listening ?? false; }
  get port(): number | null { return this.listenPort; }
  get pairedExtensionId(): string | null { return this.extensionId; }

  async start(port = 27123): Promise<number> {
    if (this.server) throw new Error('浏览器桥接已经启动。');
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('无效的桥接端口。');
    const server = createServer((request, response) => { void this.handle(request, response); });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 1_000;
    this.server = server;
    this.sessionToken = randomBytes(32).toString('base64url');
    this.extensionId = null;
    this.session += 1;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string') return reject(new Error('桥接地址不可用。'));
          this.listenPort = address.port;
          resolve();
        });
      });
      this.provider.connectionChanged?.();
      return this.listenPort!;
    } catch (error) {
      this.server = null;
      this.sessionToken = '';
      this.listenPort = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.sessionToken = '';
    this.extensionId = null;
    this.listenPort = null;
    this.currentJob = null;
    this.session += 1;
    this.provider.connectionChanged?.();
    // Keep the serial lock and claimed IDs: restarting is never a retry.
    if (server) {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  }

  /** Call only after a user has dealt with the current official-page editor. */
  acknowledge(taskId: string): boolean {
    if (this.currentTaskId !== taskId || this.resultInFlight || this.claimInFlight) return false;
    this.currentTaskId = null;
    this.currentJob = null;
    this.resultRecorded = false;
    return true;
  }

  private json(response: ServerResponse, status: number, data: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  }

  private authorize(request: IncomingMessage, origin: string, paired = true): void {
    const supplied = request.headers.authorization;
    const expected = `Bearer ${this.sessionToken}`;
    if (!this.sessionToken || typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      throw new RequestError(401, '配对码无效或已过期。');
    }
    const id = EXTENSION_ORIGIN.exec(origin)![1];
    if (paired && this.extensionId !== id) throw new RequestError(403, '请先在扩展中手动配对。');
    if (this.extensionId && this.extensionId !== id) throw new RequestError(403, '本次会话已绑定其他扩展。');
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      throw new RequestError(415, '请求必须使用 JSON。');
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      throw new RequestError(413, '请求过大。');
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) throw new RequestError(413, '请求过大。');
      chunks.push(Buffer.from(chunk));
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
      return parsed as Record<string, unknown>;
    } catch { throw new RequestError(400, 'JSON 请求无效。'); }
  }

  private taskId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      throw new RequestError(400, '任务 ID 无效。');
    }
    return value;
  }

  private async validate(id: string): Promise<void> {
    try { await this.provider.validateJob(id); }
    catch { throw new RequestError(409, '准备内容已变化或不可用，请回到 Obsidian 重新预览。'); }
  }

  private async validateAccount(id: string, accountId: string): Promise<void> {
    try { await this.provider.validateAccount(id, accountId); }
    catch { throw new RequestError(409, '当前网页账号与绑定账号不一致或尚未核对，请回到平台与账号重新检测。'); }
  }

  private copyJob(job: BridgeJob, taskId: string, accountId: string): BridgeJob {
    if (job.id !== taskId || typeof job.title !== 'string' || typeof job.text !== 'string' ||
      typeof job.account !== 'string' || job.accountId !== accountId || typeof job.originality !== 'string' ||
      !Array.isArray(job.topics) || !job.topics.every((topic) => typeof topic === 'string') ||
      !Array.isArray(job.images) || job.images.length === 0 || job.images.length > 100 ||
      job.images.some((img) => !img || typeof img.name !== 'string' || img.name.length > 255 || /[\\/\u0000-\u001f]/.test(img.name) || !IMAGE_MIMES.has(img.mime) ||
        !Buffer.isBuffer(img.data) || img.data.length === 0) ||
      job.images.reduce((total, img) => total + img.data.length, 0) > MAX_JOB_BYTES) {
      throw new RequestError(409, '已准备任务的内容或图片无效，请重新准备。');
    }
    return { id: job.id, title: job.title, text: job.text, account: job.account, accountId: job.accountId,
      originality: job.originality, topics: [...job.topics],
      images: job.images.map(({ name, mime, data }) => ({ name, mime, data: Buffer.from(data) })) };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.session;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!this.running || request.socket.remoteAddress !== '127.0.0.1' ||
        request.headers.host !== `127.0.0.1:${this.listenPort}`) {
        throw new RequestError(403, '只接受本机回环地址。');
      }
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !EXTENSION_ORIGIN.test(origin)) {
        throw new RequestError(403, '只接受配套浏览器扩展。');
      }
      if (this.extensionId && EXTENSION_ORIGIN.exec(origin)![1] !== this.extensionId) {
        throw new RequestError(403, '本次会话已绑定其他扩展。');
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new RequestError(400, '路径无效。');
      const url = new URL(request.url, `http://127.0.0.1:${this.listenPort}`);
      if (url.search) throw new RequestError(400, '接口不接受查询参数。');
      const path = url.pathname;
      const known = ['/pair', '/status', '/jobs', '/claim', '/result', '/account-detect', '/account-request', '/account-result'].includes(path) || /^\/media\/[^/]+\/\d+$/.test(path);
      if (!known) throw new RequestError(404, '没有此接口。');
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map((v) => v.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(String(method)) || headers.some((h) => !['authorization', 'content-type'].includes(h))) {
          throw new RequestError(403, '不支持的跨域请求。');
        }
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '60' });
        response.end();
        return;
      }
      this.authorize(request, origin, path !== '/pair');
      // Chrome MV3 omits Origin on extension GETs. POST reads preserve its browser-generated
      // extension Origin, allowing the same strict source checks without a claimed-origin header.
      if (request.method === 'POST' && (path === '/status' || path === '/jobs' || path === '/account-detect' || path === '/account-request' || path.startsWith('/media/'))) {
        const body = await this.body(request);
        if (Object.keys(body).length) throw new RequestError(400, '读取请求不接受其他数据。');
        if (session !== this.session) return;
      }
      if (path === '/pair' && request.method === 'POST') {
        const body = await this.body(request);
        if (Object.keys(body).length) throw new RequestError(400, '配对请求不接受其他数据。');
        if (session !== this.session) return;
        this.authorize(request, origin, false);
        this.extensionId = EXTENSION_ORIGIN.exec(origin)![1];
        this.provider.connectionChanged?.();
        await this.provider.requestAccountDetection?.();
        if (session !== this.session) return;
        this.json(response, 200, { paired: true });
      } else if (path === '/status' && ['GET', 'POST'].includes(request.method ?? '')) {
        this.json(response, 200, { paired: true, activeTaskId: this.currentTaskId, awaitingResult: !!this.currentTaskId && !this.resultRecorded });
      } else if (path === '/account-detect' && request.method === 'POST') {
        if (!this.provider.requestAccountDetection) throw new RequestError(409, '当前插件不支持账号检测，请更新插件。');
        await this.provider.requestAccountDetection();
        if (session !== this.session) return;
        this.json(response, 200, {requested: true});
      } else if (path === '/account-request' && request.method === 'POST') {
        const detectionRequest = this.provider.accountRequest?.() ?? null;
        this.json(response, 200, {request: detectionRequest});
      } else if (path === '/account-result' && request.method === 'POST') {
        const body = await this.body(request);
        if (session !== this.session) return;
        const requestId = this.taskId(body.requestId);
        if (!['recognized', 'logged-out', 'unknown'].includes(String(body.status)) ||
          Object.keys(body).some(key => !['requestId', 'status', 'accountId', 'nickname'].includes(key))) {
          throw new RequestError(400, '账号检测结果无效。');
        }
        if (body.status === 'recognized') {
          if (typeof body.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.accountId) ||
            typeof body.nickname !== 'string' || !body.nickname.trim() || body.nickname.length > 100 || /[\u0000-\u001f\u007f]/.test(body.nickname)) {
            throw new RequestError(400, '只能传送公开账号标识和昵称。');
          }
        } else if ('accountId' in body || 'nickname' in body) {
          throw new RequestError(400, '未识别账号时不能传送账号信息。');
        }
        const pending = this.provider.accountRequest?.();
        if (!pending || pending.requestId !== requestId || pending.expiresAt < Date.now() || !this.provider.reportAccount) {
          throw new RequestError(409, '账号检测已过期，请重新检测。');
        }
        this.provider.reportAccount({requestId, status: body.status as AccountDetectionReport['status'],
          ...(body.status === 'recognized' ? {accountId: body.accountId as string, nickname: (body.nickname as string).trim()} : {})});
        this.json(response, 200, {recorded: true});
      } else if (path === '/jobs' && ['GET', 'POST'].includes(request.method ?? '')) {
        const jobs = await this.provider.listJobs();
        if (session !== this.session) return;
        this.json(response, 200, { jobs: jobs.filter((job) => !this.claimed.has(job.id)).map((job) => ({
          id: job.id, title: job.title, account: job.account, accountId: job.accountId, imageCount: job.imageCount,
        })), activeTaskId: this.currentTaskId });
      } else if (path === '/claim' && request.method === 'POST') {
        const body = await this.body(request);
        const id = this.taskId(body.taskId);
        if (typeof body.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.accountId) ||
          Object.keys(body).some((key) => !['taskId', 'accountId'].includes(key))) throw new RequestError(400, '领取请求需要任务 ID 与实际网页账号标识。');
        const accountId = body.accountId;
        if (session !== this.session) return;
        if (this.claimed.has(id)) throw new RequestError(409, '该任务已经领取，不能重复传送。');
        if (this.currentTaskId) throw new RequestError(409, '请先处理并在 Obsidian 确认当前网页任务。');
        await this.validateAccount(id, accountId);
        await this.validate(id);
        await this.validateAccount(id, accountId);
        if (session !== this.session) return;
        // Recheck after validation awaits, so competing claims cannot pass together.
        if (this.currentTaskId || this.claimed.has(id)) throw new RequestError(409, '已有任务正在处理。');
        this.currentTaskId = id;
        this.claimed.add(id);
        this.resultRecorded = false;
        this.claimInFlight = true;
        try {
          const source = await this.provider.claimJob(id, accountId);
          if (session !== this.session) return;
          this.currentJob = this.copyJob(source, id, accountId);
          await this.validate(id);
          await this.validateAccount(id, accountId);
          if (session !== this.session) return;
          const job = this.currentJob;
          this.json(response, 200, { id: job.id, title: job.title, text: job.text, account: job.account, accountId: job.accountId,
            originality: job.originality, topics: job.topics, images: job.images.map((img, index) => ({
              name: img.name, mime: img.mime, url: `/media/${encodeURIComponent(id)}/${index}`,
            })) });
        } catch { throw new RequestError(409, '本次领取未完成，请回到 Obsidian 核实；不会自动重发。'); }
        finally { this.claimInFlight = false; }
      } else if (path.startsWith('/media/') && ['GET', 'POST'].includes(request.method ?? '')) {
        const [, , rawId, rawIndex] = path.split('/');
        const id = this.taskId(rawId);
        const index = Number(rawIndex);
        if (id !== this.currentTaskId || !this.currentJob || this.resultRecorded || !Number.isSafeInteger(index)) {
          throw new RequestError(409, '图片只提供给本次正在填写的任务。');
        }
        const job = this.currentJob;
        const img = job.images[index];
        if (!img) throw new RequestError(404, '没有此图片。');
        await this.validateAccount(id, job.accountId);
        await this.validate(id);
        await this.validateAccount(id, job.accountId);
        if (session !== this.session) return;
        if (id !== this.currentTaskId || this.resultRecorded) throw new RequestError(409, '当前任务已结束。');
        response.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.data.length });
        response.end(img.data);
      } else if (path === '/result' && request.method === 'POST') {
        const body = await this.body(request);
        const id = this.taskId(body.taskId);
        if (session !== this.session) return;
        if (id !== this.currentTaskId || this.resultRecorded || this.resultInFlight) throw new RequestError(409, '没有可上报的当前任务。');
        if (typeof body.status !== 'string' || !RESULT_STATUSES.has(body.status as BridgeResultStatus) ||
          typeof body.detail !== 'string' || body.detail.length > 1000 || Object.keys(body).some((key) => !['taskId', 'status', 'detail'].includes(key))) {
          throw new RequestError(400, '仅允许待人工确认、失败或结果待核实。');
        }
        this.resultInFlight = true;
        try {
          await this.provider.report(id, body.status as BridgeResultStatus, body.detail);
          if (session === this.session && id === this.currentTaskId) {
            this.resultRecorded = true;
            // Release frozen image bytes, but preserve the lock until manual acknowledgement.
            this.currentJob = null;
          }
        } finally { this.resultInFlight = false; }
        if (session !== this.session) return;
        this.json(response, 200, { recorded: true, requiresAcknowledgement: true });
      } else { throw new RequestError(405, '请求方法不支持。'); }
    } catch (error) {
      if (session !== this.session) return;
      this.json(response, error instanceof RequestError ? error.status : 500,
        { error: error instanceof RequestError ? error.message : '本地桥接处理失败，请回到 Obsidian 核实。' });
    }
  }
}
