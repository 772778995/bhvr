---
name: notebooklm-frontend-direction
description: Use when adding or changing Vue UI in the notebooklm project, especially when choosing component primitives, typography, or visual direction, and when the work should follow the paper-folio research aesthetic while avoiding Element-like or generic AI-product styling.
---

# NotebookLM Frontend Direction

## 概述

这个项目的前端不应该长成 Element 后台，也不应该长成常见的 AI 产品模板。

核心原则：**行为层尽量复用成熟 headless primitive，视觉层必须保留项目自己的辨识度。**

## 何时使用

- 新增或修改 Vue 页面、布局、表单、工作台面板
- 需要为对话、来源列表、研究面板选择组件模式
- 需要决定是否引入新的前端组件库或复杂交互 primitive
- 需要避免明显的模板味、Electron 套壳味、AI 紫色产品味

**不用于：**

- 纯后端、数据库、NotebookLM API、队列逻辑
- 与视觉层无关的工具链改动

## 当前项目约束

- 当前仓库前端样式栈已经是 `UnoCSS`
- 优先复用现有 utility 结构与局部 token，不要顺手再引入新的强视觉组件体系
- 如果需要复杂无样式 primitive，再按需评估 `Reka UI`

## 组件与依赖选择

### 默认立场

- 不要引入 `Element Plus`
- 不要引入 `Ant Design Vue`
- 不要把 `shadcn-vue` 当成默认 UI 方向
- 不要为了省事塞一个有强视觉烙印的大而全组件库

### 推荐方向

- 复杂但需要无障碍和交互行为保证的 primitive：优先 `Reka UI`
- 富文本编辑器：优先 `Tiptap`
- 普通表单、卡片、列表、空状态、工具栏：优先本地 Vue 组件 + 项目自己的 utility classes

### 何时不引库

- 如果只是按钮、面板、表格外壳、简单弹层，不要为了“统一”引入整套 UI 库
- 如果用几个本地组件就能完成，不要制造 `ui/button`、`ui/card`、`ui/sheet` 这种模板式目录蔓延

## 视觉约束

### 明确避免

- 大圆角 + 大阴影 + 浮层卡片到处都是
- 紫色、靛蓝、霓虹渐变作为默认主视觉
- 毛玻璃、发光描边、悬浮面板堆叠
- 典型 AI 模板首页那种稀疏、松散、装饰比信息更重的布局
- Element 风格的浅灰后台壳、通用主蓝、强烈“套件感”控件

### 默认偏好

- 更克制的配色，避免高饱和主色泛滥
- 更清晰的排版层级，而不是靠色块取胜
- 更紧凑但不压抑的空间节奏
- 圆角保守使用，优先小圆角或局部直角
- 阴影少用，多用边界、分区和表面层次建立结构
- 让界面看起来像“研究工具”而不是“AI 玩具”

### 当前已确定的优先风格

- 默认朝“仿书页 / 档案页 / 研究手稿 / 编目页”靠拢
- 背景优先暖纸色、旧纸色、册页色，不要默认纯白或深色控制台
- 文字优先墨色、褐黑、灰棕等阅读型颜色
- 标题允许更有书卷气的衬线表达，正文必须耐读
- 页眉、栏目名、计数、注记更像编目和版心语言，而不是产品控制条

### 排版与字号规则

- 中文阅读型内容优先可读性，不要照搬无衬线 SaaS 模板里的偏小字号
- 长期可见的正文、来源标题、消息正文、输入框、按钮正文默认至少 `text-base`
- `text-sm` 用于辅助信息、说明、时间、状态
- `text-xs` 只保留给很短的眉题、标签或计数，不得承载主体信息
- 使用衬线标题或中文书卷气字体时，正文和说明要同步增加 `line-height`

## AI 写代码时的约束

- 先复用现有页面的结构和密度，不要突然切成模板化 marketing UI
- 变体数量保持小，优先少量明确的状态而不是一堆抽象 variant
- 一个组件先把真实需求做对，不要顺手抽象成通用 design system
- 需要新增样式模式时，优先在当前组件附近形成可复制模式
- 如果引入 `Reka UI`，只引入当前任务需要的 primitive，不要先铺一整套

## 快速决策

| 场景 | 默认选择 |
|------|----------|
| Dialog / Popover / Tooltip / Tabs / Accordion / Switch | `Reka UI` 或本地无样式组合 |
| Date / Calendar 类组件 | 先看 `Reka UI` 组合是否够用；不够再单独评估 |
| Rich text | `Tiptap` |
| 普通业务表单 | 本地 Vue 组件 + utility classes |
| 简单卡片/面板/工具栏 | 本地实现，不引大库 |

## 常见错误

**为了快直接上大套件**

- 问题：交付快一时，后续视觉统一和辨识度全丢
- 修复：行为层用 headless，样式层自己掌控

**把“AI 友好”理解成“照搬 AI 常见模板”**

- 问题：结果就是一眼看出是套模板
- 修复：AI 只负责遵守你的视觉约束，不负责决定审美方向

**沿用了书卷气字体，但字号还停留在模板默认值**

- 问题：整体会发灰、发紧、阅读吃力
- 修复：优先抬高基础字号，让正文、列表和表单至少达到稳定可读级别

**借改一个页面顺手迁移整个样式栈**

- 问题：任务失焦，风险扩大
- 修复：把 `UnoCSS` 迁移当成独立任务，单独规划
