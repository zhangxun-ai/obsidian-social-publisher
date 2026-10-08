# Social Publisher

在 Obsidian 中整理图文、关联本地素材、核对实际填写内容，再辅助填写小红书官方图文编辑页。

当前版本：0.1.4，本地 MVP 已实现，MIT 开源。界面沿用已确认的 [GPT Image 设计稿](UI/index.html)。仅支持桌面 Obsidian 1.14.4 及以上；浏览器配套扩展为实验功能，平台草稿与直接发布尚未开放。

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
4. 在 **平台与账号** 按首次连接说明配对扩展，打开小红书官方页面，登录并检测。核对昵称与公开账号标识，点击 **确认并绑定此账号**。登录凭据由浏览器保存；插件只保存公开账号信息。
5. 新建作品或点击“使用已有笔记”，选择要发布的正文范围、标题、账号、话题及图片。“可添加的图片”需手动添加；首图为封面，排序与预览一致。
6. 保存后打开完整预览，修复检查问题，点击 **确认此版本**。批量准备时，每篇都需核对此次版本。
7. 选择当前列表中的作品，进入任务确认，创建填写任务。此时没有平台写入。

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

界面术语：**使用已有笔记**选择现有文件；**将已有笔记用于发布**设置其中要发布的正文和图片，保存会写回原笔记；**可添加的图片**尚未加入发布图片；**创建填写任务**保留已确认的内容，供扩展填写官方编辑器，此步骤不会上传或发布；**填写任务记录**展示任务进度及待核对结果。历史文件属性和内部状态值沿用原格式。

## 浏览器辅助填写（实验）

浏览器扩展 0.1.4 已通过 Chrome 网上应用店审核并发布；2026-10-09 已在真实商店页面核实“添加至 Dia”按钮可用。[安装首页](https://zhangxun-ai.github.io/obsidian-social-publisher/)和[浏览器安装页](https://zhangxun-ai.github.io/obsidian-social-publisher/browser-extension.html)均提供“添加到浏览器”入口，在要使用的 Dia 或 Chrome 中打开，进入官方商店确认添加，无需下载解压。初次发布为 Unlisted（不公开，知道链接即可安装）；2026-10-09 已提交改为 Public（公开）的更改，等待 Google 审核，通过后自动发布。商店实际安装、配对及账号绑定仍需分别验收。

开发者测试仍可在 Chrome 116 及以上的扩展管理页加载本项目 `extension/` 目录，这不是面向普通用户的一键安装方式。完整步骤与边界见 [扩展说明](extension/README.md)。

1. 在插件「平台与账号」点击「开启本地连接」，按默认展开的连接说明安装配套扩展并复制配对码。
2. 点击 Chrome 扩展图标打开浏览器工作台标签页，输入端口和配对码完成配对。保持该标签页打开。
3. 在安装扩展的同一个 Chrome 中登录小红书官方页面，已登录可跳过；登录页按钮使用系统默认浏览器，若不同请手动在 Chrome 打开 creator.xiaohongshu.com。有多个官方标签页时，在浏览器工作台明确选择本次页面。回 Obsidian 点击「检测登录状态」，核对公开账号信息后绑定。
4. 编辑作品时选择此绑定账号。准备任务后打开官方空白图文编辑页，在扩展工作台中选择这一页面及任务，再开始辅助填写。填写前和上传后再次核对实际账号，账号不同或无法识别时停止。它只上传本次已确认图片、填写准确标题正文，不点击发布、存草稿或原创声明。
5. 核对官方页面的图片数量顺序、正文、话题及其他设置。回插件填写任务记录确认当前页面已处理后，才能继续下一篇。

真实小红书页面的上传完整性尚未验证，扩展结果只记为“结果待核实”。填写不代表平台草稿或发布成功。中断后不会自动重发；确认前不要再次领取或覆盖已有内容。

连接只监听 `127.0.0.1`；配对码每次开启重新生成，关闭后失效。只向配对扩展提供已确认任务，不提供任意文件读取。配对码不要放入截图、日志或 Git。不会读取账号 Cookie 或密码。

## 更新，无需卸载

0.1.2 起，在 **平台与账号 → 插件更新 → 检查更新** 打开 BRAT 的单插件更新入口，选择 `zhangxun-ai/obsidian-social-publisher` 并确认最新版本。也可用命令面板搜索 BRAT 的 `Plugins: Choose a single plugin version to update`。若仓库未显示，在 BRAT 设置中将本仓库版本改为 `latest`；不要卸载插件，卸载会丢失插件本地设置与绑定记录。

配套 Chrome 扩展需同步更新本仓库 `extension/` 文件，并在 Chrome 扩展管理页重新加载。Obsidian 的 BRAT 更新不会更新 Chrome 扩展。当前只有小红书接入；微信公众号和 X 留待后续实现。

## 开发与独立验证

在项目目录使用 Node.js 22：

```sh
npm ci
npm run check       # 类型检查、回归测试、插件构建
npm run preview     # 浏览器交互预览；全部为合成数据
npm run test-vault  # 创建独立 .dev-vault-social-publisher，并同步构建好的插件
```

预览默认端口 4173；如已占用，可使用 `PUBLISHER_PREVIEW_PORT=4179 npm run preview`。预览与正式插件共享 `src/ui.ts`，使用合成存储，不访问真实知识库，也不连接发布平台。

可选的真实 MV3 烟测位于 `scripts/smoke-extension.mjs`，需已有 Playwright CLI 和 Chromium。设置 `PUBLISHER_CHROMIUM_EXECUTABLE` 指向本机 Chromium；`PUBLISHER_PLAYWRIGHT_CLI` 可指定已有 CLI 包装器，然后在项目根执行 `node scripts/smoke-extension.mjs`。它使用独立临时浏览器、合成官方页面与内存知识库，不使用个人登录或真实发帖；成功时输出配对、显式绑定、精确填写和结果回传摘要。

在 Obsidian 中选择 **打开本地仓库 → 打开文件夹**，选择本项目 `.dev-vault-social-publisher`。首次检查社区插件启用状态，然后打开工作台。测试库含三篇多图稿和一篇带私人研究/复盘的旧稿样例；不复制个人知识库内容。重复运行创建脚本只更新插件包，不覆盖已编辑的测试笔记。构建输出为 `dist/social-publisher/`，目录名与插件 ID 一致。

## 数据约定

- Markdown 属性复用 `ip_kind: publication`、`id`、`状态`、`账号`、`选题`，新增 `发布标题`、`正文来源`、`正文章节`、`图片`、`封面`、`小红书话题`、`原创声明`、`平台账号ID`。原有账号名保留为备注，不能当作已登录账号。话题与 Obsidian tags 分开。
- 图片属性为有序 `[[知识库相对路径]]` 列表，封面与首图相同。支持 PNG、JPEG、WebP；不自动收集整个目录。
- 当前实现阻断无法可靠转换的内部链接、非图片嵌入、HTML、表格、代码和动态查询，避免将私人内容或残缺文案传出。图片嵌入从纯文本移除并提示，实际上传以显式图片列表为准。
- SHA-256 确认指纹覆盖实际文案字段、话题、账号及绑定标识、原创选择、图序及每图字节；同路径替换图片也会失效。准备和浏览器读取时复验。
- 本地传输上限每图 20 MB、单篇 100 MB、单批 200 MB，是本工具保护值，不冒充平台限制。平台字数与图片规则由官方编辑器最终检查。
- 处理记录保存在插件本地 `data.json`，不包含正文或图像字节；待执行快照仅驻留内存。重启需重新准备，中断任务保留为待核实。记录不会自动把笔记状态改成“已发布”。
- 无选择禁用准备，全选仅作用当前筛选结果，切换筛选清空旧选择。

## 验证边界

截至 2026-10-08，自动检查、独立内存 Vault 回归、浏览器界面操作、干净 Chromium 扩展桥接烟测，以及 Obsidian 1.14.4 独立测试库原生加载、预览和本地准备通过。BRAT 仓库安装已验证，安装文件与线上 Release 一致。详细证据见 [实施验收记录](docs/verification.md)。

日常知识库完整流程、真实小红书页面上传、草稿重新打开和公开发布均未验证。安装按钮的外部协议唤醒受到自动化浏览器策略阻止，未绕过；后续用户手动验证链接能唤起 Obsidian 并创建 BRAT 弹窗，但弹窗可能在独立设置窗口里。安装页已增加即时引导；BRAT 内添加仓库的备用路径已实际验证。

## 代码入口

- `src/core.ts`：正文范围、纯文本转换、路径与内容校验、版本指纹。
- `src/storage.ts`、`src/service.ts`：保留式 Markdown 写入、Obsidian 文件读取、本地快照与处理记录。
- `src/ui.ts`、`styles.css`：作品、编辑、预览、批次确认、记录、平台与账号、更新入口、设置和首次配置。
- `src/bridge.ts`、`extension/`：配对的回环桥接与限定官方页面的实验辅助填写。

独立实现，按 [MIT License](LICENSE) 开源，未复制 MultiPost 或其他发布器代码。依赖 `yaml` 保留其 ISC 许可；Obsidian 类型包、esbuild 等为开发依赖。官方依据：[Obsidian Vault API](https://docs.obsidian.md/Reference/TypeScript%2BAPI/Vault)、[官方插件示例](https://github.com/obsidianmd/obsidian-sample-plugin)、[Bases 语法](https://obsidian.md/help/bases/syntax)、[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session)。

## 浏览器商店发行

`npm run build` 同时生成 `dist/social-publisher-browser-版本.zip`，固定包含 12 个运行文件、图标与许可证，不包含个人知识库或配置。商店上传材料见 [store-listing](docs/store-listing.md)，图片见 [store-assets](docs/store-assets/README.md)，隐私政策公开在 [privacy](https://zhangxun-ai.github.io/obsidian-social-publisher/privacy.html)。

实际提交后才将 `docs/browser-extension-release.json` 设为 `in_review`；审核通过并确认可安装的商店页面后，填写真实 `itemId` 并设为 `published`。ID 必须是 32 位 a–p 字符；安装页不会展示草稿、待审、无效 ID 或失败请求的安装按钮。安装仍需浏览器确认，不跨浏览器静默安装。
