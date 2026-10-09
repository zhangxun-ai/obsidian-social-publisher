# 商店图片

- 图标：`../../extension/icons/icon-128.png`，另有 16、32、48 像素版本。矢量源为 `icon.svg`，采用项目现有紫色与文档上传图形，没有使用平台商标。
- 小型宣传图：`promo-440x280.png`，440×280。
- 界面截图：`workspace-1280x800.png`，1280×800。来自实际加载的 MV3 扩展工作台，账号与页面内容全部为合成样例，配对码区域遮蔽。不是设计稿，也不证明真实平台上传或发布通过。
- 0.1.6 更新截图：`workspace-0.1.6-1280x800.png`，1280×800。来自加载实际工作台 HTML/CSS/JS 的本地合成夹具，展示自动连接后的账号与作品选择；Chrome API、连接服务和账号响应均为模拟，不作为真实 MV3 配对或平台验收证据。

重新捕获截图：在仓库根目录设置 `PUBLISHER_CHROMIUM_EXECUTABLE` 为已安装的独立 Chromium 可执行文件，运行 `PUBLISHER_CAPTURE_STORE_ASSETS=1 node scripts/smoke-extension.mjs`。此脚本仅使用独立临时浏览器与合成服务，不使用个人浏览器或知识库；临时测试目录会保留供诊断。
