# 安装与发行

仓库：https://github.com/zhangxun-ai/obsidian-social-publisher

## 通过 GitHub 安装

项目 README 的安装按钮打开 [HTTPS 安装页](https://zhangxun-ai.github.io/obsidian-social-publisher/)，页内使用 `obsidian://brat?plugin=zhangxun-ai%2Fobsidian-social-publisher`。首次需在目标知识库安装并启用 BRAT；点击链接后 BRAT 打开安装确认窗，用户确认后下载 GitHub Release 中的 `main.js`、`manifest.json` 和 `styles.css`。链接本身不会绕过确认或安装 BRAT。

HTTPS 页面避免 GitHub README 拦截 `obsidian://` 链接。若浏览器仍没有打开 Obsidian，可在 BRAT 设置选择 **Add a beta plugin**，输入 `zhangxun-ai/obsidian-social-publisher` 后确认。始终使用正式的 BRAT/GitHub 安装流程，无需复制插件文件。后续版本在 BRAT 检查更新，自动更新遵从用户的 BRAT 设置。

Obsidian 1.14.4 的独立设置窗口可能承载 BRAT 安装弹窗，但外部链接只唤起主窗口。用户手动点击安装链接后确认发生过此情况：打开设置才看到添加插件窗口。网页现在会在点击时立即显示确认引导和设置快捷键，并始终说明网页无法检测安装结果。BRAT 当前 URI 处理器只创建并打开 Modal，没有将设置窗口置前的处理，也没有提供控制此行为的参数；不通过多次协议跳转或定时重试伪装为已解决原生窗口焦点问题。

插件 ID 为 `social-publisher`，仓库名称保留 `obsidian-social-publisher`。插件 ID 在公开后保持稳定，避免安装出两份插件。旧本地开发包未公开分发，不作自动迁移或删除。

## 社区市场

当前尚未上架社区市场，不能在插件搜索里找到 Social Publisher。官方流程为：

1. 在 [Obsidian 社区目录](https://community.obsidian.md) 登录 Obsidian 账号并连接 GitHub 账号。
2. 进入 Plugins → New plugin，提交仓库 `https://github.com/zhangxun-ai/obsidian-social-publisher`。
3. 根据自动审查和官方审核反馈修复；通过后用户才可从 Obsidian 社区插件中直接安装。

首次提交资料已准备：根目录 README、MIT LICENSE、合法 manifest、versions.json，以及匹配版本的 Release 独立附件。独立测试库的原生加载和 BRAT 仓库安装已验证，不将实测通过视为市场审核通过。账号登录与连接由账号持有人完成。

## 维护者发布步骤

修改 `manifest.json` 与 `package.json` 到同一 `x.y.z` 版本；同步锁文件和 `versions.json`，新增对应 `docs/releases/x.y.z.md`。在项目根运行 `npm ci`、`npm run check`。通过后提交推送，并推送相同版本的 tag（不带 `v`）。Release 工作流会重新安装依赖、运行检查，再上传三个安装附件。main 分支和 PR 的 Check 工作流也会执行完整检查。

Release 不包含个人知识库、插件 data.json、本地测试库、截图会话或缓存。浏览器配套扩展目前仍需在 Chrome 加载 extension 目录；Obsidian 的安装入口只安装 Obsidian 插件。

HTTPS 安装页由 GitHub Pages 从 main 分支的 /docs 发布；更新 docs/index.html 并推送后自动重新部署。原生验证使用 BRAT 的“添加 Beta 插件”流程，最后的版本选择与安装确认由用户完成；自动化浏览器对 obsidian:// 的跳转拦截未绕过。

来源：[官方提交要求](https://docs.obsidian.md/plugins/releasing/submit-plugin)、[Manifest](https://docs.obsidian.md/Reference/Manifest)、[BRAT 开发者指南](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)、[BRAT URI 处理实现](https://github.com/TfTHacker/obsidian42-brat/blob/main/src/main.ts)。

## 0.1.2 之后的更新入口

工作台「平台与账号」和「设置」显示当前版本，点击「检查更新」执行已核实的 BRAT `obsidian42-brat:updateOnePlugin` 单插件选择命令。用户选择本仓库和最新版本；不会更新其他 Beta 插件，也不会把打开选择窗口显示为更新成功。未启用 BRAT 时明确提示恢复方式。旧版用户仍可从命令面板调用该命令，或在 BRAT 中将本仓库设置为 `latest` 后更新，无需卸载。

账号绑定是插件本地设置，卸载插件可能丢失此记录；正文与素材仍是知识库文件。配套 Chrome 扩展需单独同步 extension 文件并重新加载，BRAT 不更新 Chrome 扩展。
