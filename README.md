# Social Publisher

在 Obsidian 中整理图文、关联本地素材、核对实际填写内容，再辅助填写小红书官方图文编辑页。

当前版本：0.1.0，本地 MVP 已实现，MIT 开源。界面沿用已确认的 [GPT Image 设计稿](UI/index.html)。仅支持桌面 Obsidian 1.14.4 及以上；浏览器配套扩展为实验功能，平台草稿与直接发布尚未开放。

已实现的主题、组件和容器布局约定见 [设计系统](DESIGN.md)。

## 安装

**[安装到 Obsidian（BRAT）](https://zhangxun-ai.github.io/obsidian-social-publisher/)** · [GitHub Release](https://github.com/zhangxun-ai/obsidian-social-publisher/releases/latest)

1. 首次使用，在目标知识库的社区插件中搜索 **BRAT**，安装并启用。
2. 打开上面的安装入口，点击 **安装 Social Publisher**，网页会立即显示确认引导。在 Obsidian 的 BRAT 窗口选择最新版本并确认安装；若只看到主窗口，按 **⌘,**（Mac）或 **Ctrl+,**（Windows / Linux）打开设置，安装弹窗可能在独立设置窗口中。确认后插件文件才会自动下载，后续可通过 BRAT 更新。
3. 若浏览器没有打开 Obsidian，在 BRAT 设置中点击 **Add a beta plugin**，输入 `zhangxun-ai/obsidian-social-publisher` 并确认。

当前尚未上架 Obsidian 社区市场。BRAT 只需首次安装一次，详情及市场提交流程见 [安装与发行](docs/distribution.md)。此入口安装 Obsidian 插件；配套 Chrome 扩展的安装见下文。

## 使用

1. 通过上方安装入口安装并启用 Social Publisher。
2. 点击左侧发送图标，或通过命令面板执行 **Social Publisher: 打开图文发布工作台**。
3. 配置发布目录。路径相对于知识库，默认 `02-项目/内容IP变现/03-平台与发布/发布`。只发现指定目录中的笔记。
4. 新建作品或登记旧稿，明确正文范围、标题、账号、话题及图片。候选素材需显式添加；首图为封面，排序与预览一致。
5. 保存后打开完整预览，修复检查问题，点击 **确认此版本**。批量准备时，每篇都需核对此次版本。
6. 选择当前列表中的作品，进入批次确认，创建本地准备任务。此时没有平台写入。

新建目录按现有最大编号递增，目录名只方便定位，稳定 ID 独立保存：

```text
02-项目/内容IP变现/
├── 02-选题与作品/             # 选题、论证、研究过程
└── 03-平台与发布/
    ├── 发布管理.base           # 基于相同 Markdown 属性的视图
    └── 发布/
        └── P001-作品主题/
            ├── 小红书.md      # 发布属性 + 对外正文
            └── 图片/
                ├── 封面.png
                ├── 01.png
                └── 02.png
```

也支持 `小红书标题.md` 和已有图片名。共享图片可以通过知识库完整路径关联，不必复制。正文与图片仍是普通本地文件。

旧稿保持原位置。明确采用整篇纯正文或指定章节后，保存仅更新发布属性和所选正文；保留未知属性、注释及其他章节。编辑期间源文件变化会阻止覆盖，需重新打开后保存。

## 浏览器辅助填写（实验）

在 Chrome 扩展管理页开启开发者模式，加载本项目 `extension/` 目录。完整步骤与边界见 [扩展说明](extension/README.md)。

1. 插件设置中手动开启本地连接，复制本次配对码。
2. 在扩展中输入端口和配对码完成配对。
3. 手动打开小红书官方图文编辑页，确认账号和编辑器为空白。
4. 扩展中选择一篇已准备任务，开始辅助填写。它只上传本次已确认图片、填写准确标题正文，不点击发布、存草稿或原创声明。
5. 核对官方页面的图片数量顺序、正文、话题及其他设置。回插件处理记录确认当前页面已处理后，才能继续下一篇。

真实小红书页面的上传完整性尚未验证，扩展结果只记为“结果待核实”。填写不代表平台草稿或发布成功。中断后不会自动重发；确认前不要再次领取或覆盖已有内容。

连接只监听 `127.0.0.1`；配对码每次开启重新生成，关闭后失效。只向配对扩展提供已确认任务，不提供任意文件读取。配对码不要放入截图、日志或 Git。不会读取账号 Cookie 或密码。

## 开发与独立验证

在项目目录使用 Node.js 22：

```sh
npm ci
npm run check       # 类型检查、回归测试、插件构建
npm run preview     # 浏览器交互预览；全部为合成数据
npm run test-vault  # 创建独立 .dev-vault-social-publisher，并同步构建好的插件
```

预览默认端口 4173；如已占用，可使用 `PUBLISHER_PREVIEW_PORT=4179 npm run preview`。预览与正式插件共享 `src/ui.ts`，使用合成存储，不访问真实知识库，也不连接发布平台。

在 Obsidian 中选择 **打开本地仓库 → 打开文件夹**，选择本项目 `.dev-vault-social-publisher`。首次检查社区插件启用状态，然后打开工作台。测试库含三篇多图稿和一篇带私人研究/复盘的旧稿样例；不复制个人知识库内容。重复运行创建脚本只更新插件包，不覆盖已编辑的测试笔记。构建输出为 `dist/social-publisher/`，目录名与插件 ID 一致。

## 数据约定

- Markdown 属性复用 `ip_kind: publication`、`id`、`状态`、`账号`、`选题`，新增 `发布标题`、`正文来源`、`正文章节`、`图片`、`封面`、`小红书话题`、`原创声明`。话题与 Obsidian tags 分开。
- 图片属性为有序 `[[知识库相对路径]]` 列表，封面与首图相同。支持 PNG、JPEG、WebP；不自动收集整个目录。
- 当前实现阻断无法可靠转换的内部链接、非图片嵌入、HTML、表格、代码和动态查询，避免将私人内容或残缺文案传出。图片嵌入从纯文本移除并提示，实际上传以显式图片列表为准。
- SHA-256 确认指纹覆盖实际文案字段、话题、账号、原创选择、图序及每图字节；同路径替换图片也会失效。准备和浏览器读取时复验。
- 本地传输上限每图 20 MB、单篇 100 MB、单批 200 MB，是本工具保护值，不冒充平台限制。平台字数与图片规则由官方编辑器最终检查。
- 处理记录保存在插件本地 `data.json`，不包含正文或图像字节；待执行快照仅驻留内存。重启需重新准备，中断任务保留为待核实。记录不会自动把笔记状态改成“已发布”。
- 无选择禁用准备，全选仅作用当前筛选结果，切换筛选清空旧选择。

## 验证边界

截至 2026-10-08，自动检查、独立内存 Vault 回归、浏览器界面操作、干净 Chromium 扩展桥接烟测，以及 Obsidian 1.14.4 独立测试库原生加载、预览和本地准备通过。BRAT 仓库安装已验证，安装文件与线上 Release 一致。详细证据见 [实施验收记录](docs/verification.md)。

日常知识库完整流程、真实小红书页面上传、草稿重新打开和公开发布均未验证。安装按钮的外部协议唤醒受到自动化浏览器策略阻止，未绕过；后续用户手动验证链接能唤起 Obsidian 并创建 BRAT 弹窗，但弹窗可能在独立设置窗口里。安装页已增加即时引导；BRAT 内添加仓库的备用路径已实际验证。

## 代码入口

- `src/core.ts`：正文范围、纯文本转换、路径与内容校验、版本指纹。
- `src/storage.ts`、`src/service.ts`：保留式 Markdown 写入、Obsidian 文件读取、本地快照与处理记录。
- `src/ui.ts`、`styles.css`：作品、编辑、预览、批次确认、记录、设置和首次配置。
- `src/bridge.ts`、`extension/`：配对的回环桥接与限定官方页面的实验辅助填写。

独立实现，按 [MIT License](LICENSE) 开源，未复制 MultiPost 或其他发布器代码。依赖 `yaml` 保留其 ISC 许可；Obsidian 类型包、esbuild 等为开发依赖。官方依据：[Obsidian Vault API](https://docs.obsidian.md/Reference/TypeScript%2BAPI/Vault)、[官方插件示例](https://github.com/obsidianmd/obsidian-sample-plugin)、[Bases 语法](https://obsidian.md/help/bases/syntax)、[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session)。
