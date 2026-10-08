# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Obsidian macOS 桌面插件界面；已开始实施桌面插件与配套实验浏览器扩展，浏览器共享 UI 可交互预览。不是独立网站或移动应用。

## Users

在 Obsidian 创作图文、通过小红书官方编辑器发布的作者。

## Product Purpose

减少多篇作品的文案、封面、图片排序与上传填写中的重复操作，保留人的预览和最终判断。

## Capabilities and Constraints

产品事实以 [PRD.md](PRD.md) 的已确认需求为准。本文件仅作为设计技能的导航，不形成第二套需求。

当前授权：用户于 2026-10-08 满意确认 UI/index.html 视觉稿并明确“可以实施”。按已确认布局实现本地插件和辅助填写；不扩展到真实平台发帖。

用户随后明确授权同步 GitHub 与便捷安装。采用 MIT 公开仓库、GitHub Release 与 BRAT 安装入口；社区市场仍需账号持有人提交及官方审核。

首版按本地准备、官方网页辅助填写分阶段推进；平台草稿与直接发布待单独验证。首选 macOS 桌面 Obsidian + Chrome，其他环境尚未验证。

## Evidence on Hand

已实现本地插件与配套扩展，58 项回归及合成界面流程、干净 Chromium 桥接烟测通过。原生 Obsidian 加载因 Mac 锁屏未验证，真实平台上传未验证。视觉和独立测试只使用合成样例。

## Product Principles

- 预览表达本次准确内容；图片关联与顺序显式确认。
- 只处理本次明确选择，修改后重新预览，不自动重发不明任务。
- 本地草稿、准备、填写、平台草稿、提交及发布结果分别表达。
- 保留既有知识库结构和原始文件。
