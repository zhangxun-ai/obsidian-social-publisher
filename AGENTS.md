# Obsidian Social Publisher

桌面 Obsidian 插件，配合官方网页辅助填写小红书图文。产品约定见 PRD.md，已确认的视觉基准见 UI/index.html 和 UI/README.md。

- TypeScript + Obsidian API；界面继承宿主主题，以已确认的紧凑表格、左右编辑和预览布局为准。
- 界面名称说明动作与结果：已有笔记“用于发布”、选择“发布正文范围”、创建“填写任务”。避免“登记旧稿”“原位登记”“桥接”等内部说法；术语约定见 README。持久化字段和任务状态保持兼容，展示名称可单独优化。
- 只扫描配置目录。旧稿先明确正文范围；不迁移、删除原稿或图片。Markdown 属性复用 `ip_kind`、`id`、`状态`、`账号` 等；保存必须保留未知属性和未选章节。
- 首图为封面。仅显式选择的图片进入准备版本；同路径图片字节变化也使确认失效。
- 当前筛选结果限定执行范围；无选择不执行。平台草稿、公开发布没有验证前不开放，不将填写成功记为发布成功。
- 浏览器衔接只传用户确认的快照，监听地址限回环，需配对授权；不读取 Cookie、密码或任意文件。
- 开发与验收命令以 package.json、README.md 为准。测试使用合成内容和独立测试库，日常知识库不作自动化测试场地。
- 提交、推送与代码发行按当前任务授权执行；真实平台发帖需单独授权。发行约定、BRAT 入口和社区市场状态见 docs/distribution.md。

实测命令（项目根、Node.js 22）：`npm run check` 完成类型检查、回归和构建；`npm run preview` 启动合成界面，端口冲突使用 `PUBLISHER_PREVIEW_PORT=4179`；`npm run test-vault` 创建/更新独立测试库。原生与平台验证边界见 docs/verification.md。

插件 ID 固定为 `social-publisher`，仓库名称为 `obsidian-social-publisher`。发行 tag 与 manifest/package 版本必须一致且不带 v；`npm run check:release` 检查发行附件与版本，Release 工作流从 dist/social-publisher 上传三份独立文件。测试库是 .dev-vault-social-publisher，禁止提交个人知识库、data.json 或本地会话产物。
