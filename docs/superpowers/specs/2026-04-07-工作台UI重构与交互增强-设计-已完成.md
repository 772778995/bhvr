# 工作台 UI 重构与交互增强设计

**当前状态：** 已完成

## 设计结论

以"动画舒适感 + 信息密度降低 + 功能完整性补齐"为主轴，对工作台进行一次整体重构：清理顶部多余文案、修复三栏溢出滚动、新增 Toast 消息提示、启用 Markdown 渲染、加入克制动画，并将设计约束写入项目级 skill 文件。

---

## 范围

本次重构涵盖以下六个方面：

1. **动画系统** — 全局克制动画约定，加入书页翻阅感
2. **Toast 消息提示** — 顶部悬浮 + 自动消失，替换当前 inline banner
3. **顶部文案清理** — 删除全部多余装饰文案
4. **三栏溢出滚动修复** — 确保来源列表、对话列表、报告预览均可滚动
5. **Markdown 渲染** — AI 回复使用 marked + DOMPurify 渲染
6. **design skill 更新** — 将动画约定写入 `.opencode/skills/frontend-design/SKILL.md`

---

## 详细设计

### 1. 动画系统

**原则：** 功能性动画优先于装饰性动画。每个动画都服务于认知：要么帮助用户定位变化，要么给予操作反馈。

**约定：**
- 出现/入场：`ease-out`，时长 150–200ms
- 退出/离场：`ease-in`，时长 100–150ms
- 交互反馈（hover/active）：`ease-in-out`，时长 100–150ms
- 小惊喜（偶发）：scale 弹入 `scale-95 → scale-100`，或 translate-y 上滑 `translate-y-1 → translate-y-0`
- 禁止：旋转 360°、bounce 过强、长于 400ms 的动画、纯装饰闪烁

**具体落点：**
- TopBar 标题入场：`opacity-0 translate-y-[-4px] → opacity-100 translate-y-0`，200ms
- Toast 出现：从顶部 `translate-y-[-100%] → translate-y-0`，带 `scale-95 → scale-100`，200ms
- Toast 消失：`opacity-100 → opacity-0` + `translate-y-[-8px]`，150ms
- 对话气泡入场：最新一条消息 `opacity-0 translate-y-2 → opacity-100 translate-y-0`，180ms
- 来源列表项入场：`opacity-0 translate-x-[-4px] → opacity-100 translate-x-0`，150ms，stagger 50ms
- 按钮 hover：`scale-[1.02]`，100ms
- 按钮 active：`scale-[0.97]`，80ms
- 进度条填充：`transition-all duration-300 ease-out`（已有，保持）

**UnoCSS 实现：** 使用 `transition-*` utilities + Vue `<Transition>` / `<TransitionGroup>` 的 enter/leave class。

---

### 2. Toast 消息提示

**组件：** `client/src/components/ui/AppToast.vue`
**Composable：** `client/src/composables/useToast.ts`

**行为规范：**
- 出现位置：页面顶部居中，`fixed top-4 left-1/2 -translate-x-1/2 z-50`
- 类型：`info`（暖色）、`error`（红色），默认 `info`
- 自动消失：鼠标不悬浮时 3 秒后消失；鼠标悬浮时暂停计时，离开后重新倒计时
- 最多同时展示 1 条（新消息覆盖旧消息）
- 动画：见动画系统第 Toast 条

**风格（延续书页暖色调）：**
- info：`bg-[#f5ead1] border border-[#d7c29a] text-[#745a21]`
- error：`bg-[#f4ddd6] border border-[#c98e7e] text-[#7b3328]`
- 阴影：`shadow-md`

**接口：**
```ts
const { showToast } = useToast()
showToast('消息内容')           // 默认 info
showToast('操作失败', 'error')  // error 类型
```

**接入方式：** `App.vue` 或 `NotebookWorkbenchView.vue` 挂载 `<AppToast />` 一次；`pushNotice` 改为调用 `showToast`。

---

### 3. 顶部文案清理

**NotebookTopBar.vue 改动：**

删除：
- `<p class="text-[0.8rem] uppercase tracking-[0.24em]">Research Folio</p>`
- `<p class="mt-1 text-sm leading-relaxed text-[#776957]">NotebookLM 研究书页，用于整理来源、对话与报告草稿。</p>`
- 底部三格标签栏（来源编目 / 对话批注 / 报告成稿）整块 `<div class="mt-4 grid grid-cols-3 ...">`

**NotebookWorkbenchView.vue 改动：**

删除：
- `Annotated Research Sheet` 横幅整块 `<div class="mb-3 flex items-center justify-between ...">`

结果：顶栏只保留标题（`h1`）和分享/更多按钮，空间更紧凑，三栏获得更多垂直高度。

---

### 4. 三栏溢出滚动修复

**根因：** `NotebookWorkbenchView.vue` 中 grid 容器用了 `h-full`，但因为移除 `Annotated Research Sheet` 横幅后高度计算需调整，以及 `min-h-0` 的缺失导致 flex/grid 子项无法收缩。

**修复策略：**
- 外层 `<div class="min-h-0 flex-1 overflow-hidden p-3 ...">` 改为移除上方横幅后调整 padding
- grid 容器确保 `h-full min-h-0` 正确传递
- `ChatPanel`：消息列表区 `flex-1 min-h-0 overflow-y-auto`
- `SourcesPanel`：已有 `overflow-y-auto min-h-0 flex-1`，确认正确
- `StudioPanel`：报告预览区 `flex-1 min-h-0 overflow-y-auto`

---

### 5. Markdown 渲染

**位置：** `ChatPanel.vue` 中 AI 回复气泡

**实现：**
```ts
import { marked } from 'marked'
import DOMPurify from 'dompurify'

function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(marked.parse(content) as string)
}
```

**用法：**
```html
<!-- role === 'user' -->
<p class="whitespace-pre-wrap">{{ message.content }}</p>

<!-- role === 'assistant' / 'model' -->
<div class="prose-warm" v-html="renderMarkdown(message.content)" />
```

**样式（prose-warm）：** 在 `style.css` 中定义一个轻量 prose 变体，与书页暖色调一致：
- `h1~h3`：衬线字体，稍大
- `code`：`bg-[#f0e8d4] px-1 rounded text-[0.9em]`
- `a`：`text-[#7b4a1e] underline`
- `ul/ol`：正常缩进
- `p`：`margin-bottom: 0.6em`

---

### 6. design skill 更新

**文件：** `.opencode/skills/frontend-design/SKILL.md`

新增"动画约定"章节，要求：
- 所有过渡默认 `ease-out 150–200ms`
- 使用 Vue `<Transition>` 而非手写 JS 动画
- 禁止 `animation-duration > 400ms` 的纯装饰动画
- 书页翻阅感：优先 translate-y + opacity 组合，避免 scale 幅度 > 5%

---

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `client/src/components/ui/AppToast.vue` | 新建 |
| `client/src/composables/useToast.ts` | 新建 |
| `client/src/components/notebook-workbench/NotebookTopBar.vue` | 修改：删多余文案，加动画 |
| `client/src/components/notebook-workbench/ChatPanel.vue` | 修改：Markdown 渲染 + 气泡动画 |
| `client/src/components/notebook-workbench/SourcesPanel.vue` | 修改：列表项动画 + 确认溢出 |
| `client/src/components/notebook-workbench/StudioPanel.vue` | 修改：确认报告区溢出滚动 |
| `client/src/views/NotebookWorkbenchView.vue` | 修改：删横幅、接入 Toast、修复高度 |
| `client/src/style.css` | 修改：添加 `.prose-warm` |
| `.opencode/skills/frontend-design/SKILL.md` | 修改：添加动画约定 |

---

## 验证

```bash
npm run build --workspace client
```

构建通过即为合格。视觉验证：
1. 顶部不再出现 "Research Folio" 等文案
2. Toast 在顶部居中弹出，3 秒后消失，鼠标悬浮时暂停
3. AI 回复渲染 Markdown（标题、代码块、列表）
4. 来源列表超出高度后出现滚动条
5. 对话列表超出后出现滚动条
6. 动画流畅，无跳变
