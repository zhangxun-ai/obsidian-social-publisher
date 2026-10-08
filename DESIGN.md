---
name: Obsidian Social Publisher
description: 继承 Obsidian 宿主主题的紧凑图文准备工作台
colors:
  primary: "var(--interactive-accent, #7654d5)"
  background: "var(--background-primary, #fff)"
  background-subtle: "var(--background-secondary, #f7f7fa)"
  ink: "var(--text-normal, #22222a)"
  muted: "var(--text-muted, #646472)"
  line: "var(--background-modifier-border, #e4e4eb)"
  tint: "color-mix(in srgb, var(--sp-accent) 9%, var(--sp-bg))"
  warning: "#9e4d00"
  warning-background: "#fff1dd"
  warning-dark: "#ffc586"
  warning-background-dark: "#4a331b"
  issue-error: "#b14326"
  issue-error-dark: "#ffad93"
  error: "#a3321b"
  error-background: "#fff0ec"
  error-line: "#edc7bd"
  error-dark: "#ffb3a1"
  error-background-dark: "#432923"
  error-line-dark: "#7d4436"
typography:
  headline:
    fontFamily: 'var(--font-interface, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)'
    fontSize: "27px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.45
  item-title:
    fontSize: "15px"
    fontWeight: 650
  body:
    fontFamily: 'var(--font-interface, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontSize: "14px"
    fontWeight: 600
  metadata:
    fontSize: "12px"
    lineHeight: 1.55
  excerpt:
    fontSize: "13px"
    lineHeight: 1.7
rounded:
  thumbnail: "2px"
  list-cover: "3px"
  preview-cover: "4px"
  control: "5px"
  panel: "6px"
  dialog: "8px"
  topic: "15px"
  badge: "20px"
spacing:
  tight: "4px"
  thumbnail-gap: "6px"
  field-gap: "8px"
  action-gap: "10px"
  cell: "12px"
  column-gap: "16px"
  rail: "18px"
  panel: "20px"
  canvas: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "8px 5px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  panel:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  badge-neutral:
    backgroundColor: "{colors.background-subtle}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "2px 9px"
  badge-accent:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.primary}"
    rounded: "{rounded.badge}"
    padding: "2px 9px"
  topic:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.primary}"
    rounded: "{rounded.topic}"
    padding: "2px 8px"
---

# Design System: Obsidian Social Publisher

## Overview

**Creative North Star: "Obsidian 图文准备工作台"**

现有界面是一块桌面 Obsidian 工作面：继承宿主的浅色或深色主题、界面字体和强调色，以紧凑表格、左右并列面板和细分隔线组织内容。默认回退强调色为紫色；它集中用于当前导航、明确选择和主要动作，不形成独立于宿主的品牌配色。

此记录提取自 `src/ui.ts`、`styles.css`，并对照已确认的 `UI/02-workspace.png`、`UI/03-editor.png`、`UI/11-xiaohongshu-account-v2.png` 以及 `.impeccable/review/` 的桌面、编辑、账号页和窄容器截图。实现值以样式源码为准。截图中的 macOS 标题栏、知识库侧栏、Obsidian 标签栏是合成宿主外围，不属于插件组件。账号页复用既有 token，没有新增配色、字体或组件圆角。

记录范围为已实现的本地 MVP UI。参考稿和测试截图中的封面均为合成资产，没有新增上线图片。窄容器截图证明容器降级样式的呈现，不代表已支持手机；原生加载及平台验收边界见 docs/verification.md。真实小红书账号只读检测已通过，图片上传、平台草稿保存与公开发布仍未验收；这些结果不扩大本文件的 UI 审查范围。

**Key Characteristics:**
- 宿主主题驱动的中性底色、正文与细线。
- 顶部四个导航，内容区域以表格和并列面板为主。
- 少量强调色表达选中、当前步骤和主要动作。
- 图像按真实内容展示，封面、序号和关联状态可直接核对。
- 容器缩窄时逐级减少次要列并改为纵向排列。

## Colors

颜色首先来自 Obsidian 语义变量；frontmatter 中的回退值仅供无宿主变量的预览使用。局部变量在插件根容器内解析，浅色与深色不能靠替换固定白底实现。sidecar 中的八级色阶是按回退色生成的设计面板示意，不是实现中的额外主题 token。

### Primary

- **宿主强调色**：用于主要按钮、当前导航下划线、选中筛选、图片序号、文字动作和复选框。
- **轻强调底色**：由强调色与当前背景混合，用于已选表格行、强调状态、话题和正文来源选项。

### Neutral

- **工作底色**：承载主界面、表单与面板。
- **次级底色**：区分表头、说明块、无图占位和中性状态。
- **正文色**：用于标题、正文和主要操作名称。
- **辅助文字色**：用于路径、账号、日期、字段说明和状态补充。
- **分隔线色**：用于面板、控件、表格行和局部分组边界。

### Semantic Feedback

需处理状态使用暖橙色胶囊；阻断问题使用暖红色文本，错误横幅同时具有浅底和边框。深色宿主通过 `.theme-dark` 使用已定义的对应反馈色。状态始终保留文字，不能只靠颜色表达。

**The Host Theme Rule.** 先使用宿主语义变量，紫色仅为未提供宿主强调色时的回退。

## Typography

所有界面使用宿主 `--font-interface`；缺省时回退到系统中西文字体栈。没有展示字体、品牌字体或独立等宽字体。

### Hierarchy

- **Headline**：页面标题，紧凑字距；容器不超过窄布局断点时缩小到（24px）。
- **Title**：面板与分组标题。
- **Item title**：预览中的作品标题；表格作品标题沿用正文尺寸并加粗（600）。
- **Body**：表单、按钮、表格主体和普通说明的基准。
- **Label**：字段名，字重与控件内容拉开一级。
- **Metadata**：路径、账号、计数、状态和说明。表头与筛选也使用小字号（12px）。
- **Excerpt**：侧栏正文摘要最多四行；完整正文保留换行，行高（1.85），编辑正文行高（1.75）。

路径和图片文件名采用单行省略，作品标题允许换行；完整预览正文允许长词折行。统计数字使用等宽数字特性，未采用等宽字体。

## Layout

插件根容器以自身宽度建立 CSS container query；断点针对可用工作区，不针对设备型号。根容器可纵向滚动。

- **顶部导航**：最小高度（61px），品牌、作品、填写任务记录、平台与账号、设置横向排列；右侧显示工作区说明。当前导航以细下划线和强调文字表达。
- **工作台**：主内容内边距使用 canvas 间距。左侧自适应作品表格，右侧预览宽（340px），列间距使用 column-gap。预览侧栏为 sticky，距滚动顶部（15px）。
- **作品表格**：固定布局、横向细线，复选框列宽（44px）；状态列宽（85px）、图片列宽（170px）、更新列宽（64px）。行内封面（54×72px），图片条缩略图（30×41px）。表格底部的选择栏与表格共用连续边框。
- **编辑器**：左表单、右图序面板，列比例（1.12:1），列间距使用 column-gap；账号与原创声明并列。图片和候选素材默认三列。
- **完整预览**：图片内容与检查面板并排，列间距（36px），内容最大宽度（1050px）；左列范围（280–420px）。
- **次级表单**：引导与新建表单最大宽度（680px）；设置为两列、最大宽度（1100px）。
- **平台与账号**：标题下先显示平台、当前绑定账号、登录状态和登录动作的状态行；下方左侧登录与绑定、右侧发布账号选择，列比例（1.15:1），间距（20px）。底部版本与更新操作通过顶部分隔线单独成行，与账号面板保持清晰间隔。

### Narrow Container Degradation

| 容器宽度 | 已实现变化 |
| --- | --- |
| ≤1050px | 预览侧栏缩至 270px；隐藏表格图片列；主内容内边距降至 20px。 |
| ≤780px | 工作台、编辑器、完整预览、设置和账号面板改为单列；账号状态行改为两列；侧栏取消 sticky、预览图限高 360px；隐藏顶部说明；品牌与导航可分行，标题与动作可换行，主内容内边距降至 16px。 |
| ≤480px | 隐藏表格更新列；状态列缩至 70px，行内封面缩至 38×52px；四个导航占满一行并均匀排列；选择栏与确认行可换行；并列字段和正文来源改为单列，图片与候选素材降至两列。账号名称独占状态行的第二行，登录按钮独占后续行；版本更新行可换行，保留检查更新动作。 |

**The Container Rule.** 先按插件工作区实际宽度保留可读内容，再逐级减少次要信息；窄容器测试不能作为移动平台支持声明。

## Elevation & Depth

界面默认平面化，没有卡片投影。层级由中性底色、细边框、留白和轻强调底色建立；按钮和输入框显式取消阴影。对话框具有半透明黑色遮罩（`#0006`），忙碌提示固定在右下角并使用正文与背景反转。两者未增加投影层级。

键盘焦点使用强调色外轮廓（2px），向外偏移（3px）。按钮只有背景色短过渡（0.12s ease-out），且仅在用户未请求减少动态效果时启用；没有页面进入或图片排序动画。

## Shapes

形状以轻微圆角和细边框为主：控件、面板、对话框按 frontmatter 的不同圆角区分；媒体缩略图与预览图使用更小圆角。话题和状态胶囊使用较大圆角，不把普通按钮做成胶囊。常规边框为（1px）；当前导航下划线为（2px）。

主要图片预览使用（3:4）框和 `contain`，保证当前图像完整可见；表格及编辑缩略图使用 `cover` 以保持紧凑排列。缩略裁剪不代表最终图片裁剪。空关联与读取失败以带文字的中性占位表达。

## Components

### Buttons

主要按钮用强调底、白字；次级按钮用工作底色和细边框；文字按钮用强调文字和透明边框。常规最小高度（36px），筛选和图片操作分别压缩尺寸。悬停使用次级底色，主要按钮悬停将强调色与黑色混合（86% 强调色）。禁用态不透明度（0.45），保持原标签。所有按钮沿用统一键盘焦点轮廓。

### Inputs / Fields

输入框使用工作底色、细边框与控件圆角，最小高度（38px）。占位文字使用辅助文字色，聚焦边框与插入点使用强调色。字段名、控件、说明纵向排列；正文文本区可垂直调整，初始最小高度（260px）。正文来源以两个带单选控件的边框选项表达，选中项具有强调边框和轻强调底色。

### Navigation

顶部四个导航：作品、填写任务记录、平台与账号、设置。编辑、预览及准备等子界面仍归属作品导航。导航为透明平面按钮，当前项加字重（600）、强调文字和底部细线，并带 `aria-current="page"`。缩窄时压缩间距与文字尺寸，未实现折叠菜单。

### Chips / Badges

本地状态为小型胶囊：中性状态使用次级底色，待发布等状态使用轻强调底色，需处理等状态使用暖橙反馈色。话题采用同一强调色系，但与状态使用不同的圆角和内边距。筛选属于按钮，选中时增加轻强调底色和混合色边框。

### Panels / Table / Selection Bar

面板为工作底色、细边框、轻圆角，无阴影。作品表格以分隔线维持行关系；已选择行用轻强调底色，仅聚焦的未选行使用更轻的强调混合底（3%）。复选框与封面在行内固定，作品标题、路径和账号构成三层文本。底部选择栏显示数量和操作，窄容器允许换行。

### Preview Rail

右侧预览按“本次内容标题、完整图像、上/下一张与计数、作品标题、四行正文摘要、话题、图片与状态信息、动作、底部说明”排列。图像和真实文字是主体，面板不复刻手机壳或社交平台界面。

### Ordered Images

编辑面板将已关联图片与候选素材分组，组间用细线和留白分隔。每张已关联图片依次显示封面或序号、缩略图、文件名以及设封面、前移、后移、移除操作；首图标为封面。现有排序支持拖动和按钮，文档不将参考稿中的装饰性拖动柄或更多菜单记为已实现控件。

### Account Status / Login / Updates

账号状态行沿用面板的细边框与轻圆角，辅助标签在上、值在下；长账号标识允许折行。连接说明前置，登录面板用强调色步骤序号表达“同浏览器登录（已登录可跳过）、检测账号、核对并绑定”的顺序。状态行主按钮按连接状态提供开启连接、查看配对步骤或检测账号。检测结果放在带边框的内嵌区域，以文字和 `role="status"` 表达等待、未登录、无法识别、待绑定及已核对；需要确认时，在该区域展示昵称、公开 ID、检测时间与绑定动作。

浏览器尚未配对时，连接说明默认展开并位于登录步骤之前；配对后默认折叠，使用原生可展开控件。未连接提示明确网页登录不等于账号绑定；默认浏览器打开登录页的限制在按钮旁说明。连接细节与登录步骤之间用分隔线区分。右侧发布账号选择复用已有字段与说明块，保持与作品编辑页相同的控件风格。底部插件更新为平面信息行，左侧版本和更新说明、右侧次级检查按钮，不引入新卡片或额外强调色。

### Dialog / Feedback

对话框为有边框的工作底色容器，宽度（`min(580px, 90vw)`），最大高度（85vh），动作置于底部右侧。图片搜索结果独立滚动，最大高度（320px）。错误横幅保留具体文字与关闭按钮，并使用 `role="alert"`；忙碌提示使用 `role="status"`，内容区域同时标识 `aria-busy`。

## Do's and Don'ts

### Do:

- **Do** 优先继承 Obsidian 主题、字体和强调色，保留已有回退值。
- **Do** 用细线、紧凑行、局部说明和左右面板组织桌面工作内容。
- **Do** 让选中、禁用、错误和键盘焦点具有明确且一致的可见状态。
- **Do** 保留真实图像比例、显式图序及封面标签，区分预览完整图与缩略裁剪。
- **Do** 按现有容器断点降级，允许标题和动作换行。

### Don't:

- **Don't** 把合成宿主的标题栏、知识库侧栏和标签栏实现为插件组件。
- **Don't** 把参考稿中的未实现控件、装饰或素材风格写成现有设计能力。
- **Don't** 引入大面积品牌色、展示字体、投影卡片或新动效替换现有宿主工具风格。
- **Don't** 只用颜色表达状态，或移除键盘焦点轮廓。
- **Don't** 将窄容器截图、合成资产或本地 UI 审查写成手机、原生加载或真实平台验证。
