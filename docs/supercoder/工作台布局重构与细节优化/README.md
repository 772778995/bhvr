# 工作台布局重构与细节优化

**当前状态：** 进行中

## 设计结论

将三栏布局从「来源 | 对话 | 研究控制+报告」重构为「标签页(来源/对话) | 报告列表/详情 | 研究控制」，同时完成 9 项细节优化。核心变化：对话从独占中栏降级为左栏 tab，报告从右栏附属区域升格为中栏主体，支持多报告。

---

## 一、布局重构（任务 9 — 基石，其他任务依赖此项）

### 当前布局

```
┌──────────┬──────────────────┬────────────┐
│ 来源列表  │     对话历史      │  研究控制   │
│ (280px)  │   + 输入框        │  + 报告预览 │
│          │   (flex-1)       │  (340px)   │
└──────────┴──────────────────┴────────────┘
```

### 目标布局

```
┌──────────────────┬──────────────────┬────────────┐
│ [来源] [对话]     │  研究报告列表     │  研究控制   │
│ ─────────────── │  / 报告详情       │            │
│ 来源列表          │                  │  自动研究   │
│ 或               │  (flex-1)        │  开关/进度  │
│ 对话历史+输入框    │                  │  生成按钮   │
│                  │                  │            │
│ (400px)          │                  │  [下方留空]  │
└──────────────────┴──────────────────┴────────────┘
```

### 左栏变更

| 属性 | 当前 | 目标 |
|------|------|------|
| 默认宽度 | 280px | 400px |
| 最小宽度 | 200px | 320px |
| 最大宽度 | 480px | 600px |
| 内容 | 仅来源列表 | 标签页切换：来源列表 / 对话历史+输入框 |

标签页实现：不引入 UI 库，用 `<button>` 组列表 + 条件渲染实现。标签页样式：底部 border 高亮当前 tab，文字风格跟随全局暖色书页主题。

### 中栏变更

| 属性 | 当前 | 目标 |
|------|------|------|
| 内容 | 对话历史+输入框 | 报告列表视图 / 报告详情视图 |
| 最小宽度 | 320px | 320px（不变） |

中栏两个视图状态：
1. **列表视图**（默认）：展示该笔记本所有研究报告的卡片列表，每个卡片显示报告名称（默认按生成时间命名，如"研究报告 2026-04-09 14:30"）、生成时间、内容摘要（前 100 字）。卡片左上角有 × 删除按钮（点击弹出确认对话框）。点击卡片进入详情视图。
2. **详情视图**：顶部工具栏包含「← 返回列表」按钮和「↓ 下载」按钮（下载为 .md 文件）。下方是 markdown 渲染的报告全文。

### 右栏变更

| 属性 | 当前 | 目标 |
|------|------|------|
| 内容 | 研究控制 + 报告预览 | 仅研究控制（自动研究开关、进度、生成报告按钮） |
| 下方 | 报告预览 | 留空（未来放多媒体生成功能） |

报告预览区域从右栏移除，完全由中栏承担。

### 组件拆分

| 文件 | 变更 |
|------|------|
| `NotebookWorkbenchView.vue` | 左栏改为包含 tab 切换逻辑的容器；中栏改为报告列表/详情；右栏删除报告预览 |
| `SourcesPanel.vue` | 保持不变（作为左栏 tab 内容之一） |
| `ChatPanel.vue` | 保持不变（作为左栏 tab 内容之二） |
| `StudioPanel.vue` | 删除报告预览部分，仅保留研究控制区域 |
| **新增** `ReportListPanel.vue` | 中栏的报告列表视图 |
| **新增** `ReportDetailPanel.vue` | 中栏的报告详情视图（markdown 渲染 + 工具栏） |

---

## 二、来源图标体系（任务 2）

### 当前状态

`SourceFavicon.vue` 已存在，对 web 类型用 Google Favicon → DDG → 直接 /favicon.ico 三级兜底，最终 fallback 到 SVG globe 图标。但非 web 类型没有任何图标。

### 设计

将 `SourceFavicon.vue` 重构为 `SourceIcon.vue`，根据来源类型分流：

| 来源类型 | 图标策略 |
|---------|---------|
| `web` | 保持现有 favicon 获取逻辑（Google → DDG → /favicon.ico → globe SVG fallback） |
| `pdf` | 内联 SVG：文档+PDF 标识图标 |
| `video` | 内联 SVG：播放按钮图标 |
| `audio` | 内联 SVG：音符/音波图标 |
| `text` | 内联 SVG：文本文件图标 |
| `file` / 其他 | 内联 SVG：通用文件图标 |
| `drive` | 内联 SVG：云盘图标 |

关于 favicon.ico 直接渲染：可以。`favicon.ico` 是标准图片格式（ICO），浏览器的 `<img>` 标签可以直接渲染，无需特殊处理。当前 `SourceFavicon.vue` 已经在用 `<img :src="...favicon.ico">` 做这件事，没有问题。

---

## 三、来源删除功能（任务 4）

### 前端

在 `SourcesPanel.vue` 的每个来源项增加 × 删除按钮（鼠标 hover 时显示，位于项的右上角）。点击弹出确认对话框："确定要删除来源「{title}」吗？此操作不可撤销。" 确认后调用 DELETE API。

### 后端

新增路由：`DELETE /api/notebooks/:id/sources/:sourceId`

实现逻辑：
1. 调用 `client.sources.delete(notebookId, sourceId)` 删除远程来源
2. 清理本地 `notebook_source_states` 表中对应记录（如果存在）
3. 返回 204

### notebook_source_states 清理

经查，此表虽然有 service 层代码和路由导入，但功能在之前的计划中已标记为 deferred/removed。在本次改动中：
- 删除来源时顺便清理该表中的对应记录
- 不做大规模清理重构（超出本次范围）

---

## 四、报告 Markdown 渲染（任务 5）

报告详情视图 (`ReportDetailPanel.vue`) 使用与 `ChatPanel.vue` 相同的 `marked` + `DOMPurify` 管道渲染 markdown。复用 `prose-warm` CSS class。

---

## 五、增强 Markdown 支持（任务 6 + 任务 5 共用）

### 当前状态

`marked` 使用默认配置，无代码高亮、无 GFM 扩展配置。

### 增强方案

1. **提取公共 markdown 渲染工具函数**：从 `ChatPanel.vue` 中提取 `renderMarkdown()` 到 `client/src/utils/markdown.ts`，所有需要 markdown 渲染的地方统一引用。
2. **启用 GFM**：`marked.use({ gfm: true })` — 支持表格、删除线、任务列表。
3. **代码高亮**：引入 `highlight.js`（仅核心 + 常用语言包），通过 `markedHighlight` 插件集成。选一个暖色调 highlight 主题（如 `github` 或自定义），确保与书页风格一致。
4. **补充 prose-warm CSS**：增加 `table`、`thead`、`th`、`td`、`del`（删除线）、`input[type="checkbox"]`（任务列表）、`img` 等元素的样式。
5. **数学公式**：暂不支持（YAGNI，NotebookLM 回答中极少出现 LaTeX）。

---

## 六、中文提问（任务 7）

### 当前状态

`orchestrator.ts` 的 `buildQuestionGenerationPrompt()` 使用英文 prompt。其他地方（chat-asker、路由内报告生成）已是中文。

### 改动

将 `buildQuestionGenerationPrompt()` 的 prompt 改为中文，统一风格。同时检查 `worker/research.ts` 中的英文 prompt 一并改为中文。

改动范围：
- `server/src/research-runtime/orchestrator.ts` — `buildQuestionGenerationPrompt()` 改中文
- `server/src/worker/research.ts` — 问题生成和报告编译 prompt 改中文

---

## 七、多研究报告（任务 8）

### DB 变更

`research_reports` 表当前以 `notebook_id` 为主键（一笔记一报告）。改为：

```sql
CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,          -- crypto.randomUUID()
  notebook_id TEXT NOT NULL,    -- 外键
  title TEXT NOT NULL,          -- 默认："研究报告 YYYY-MM-DD HH:mm"
  content TEXT,
  generated_at INTEGER,
  error_message TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_notebook ON research_reports(notebook_id);
```

### Service 层变更

| 函数 | 当前 | 目标 |
|------|------|------|
| `getReportByNotebookId` | 返回单个报告 | 改为 `listReportsByNotebookId`，返回报告数组（按 generated_at DESC 排序） |
| `upsertReport` | INSERT ON CONFLICT UPDATE | 改为 `createReport`，始终 INSERT 新记录 |
| **新增** `getReportById` | — | 根据报告 ID 获取单个报告 |
| **新增** `deleteReport` | — | 根据报告 ID 删除 |
| `setReportError` / `clearReportError` | 操作单条记录 | 改为操作最新创建的报告记录 |

### API 变更

| 方法 | 路径 | 变更 |
|------|------|------|
| GET | `/:id/reports` | 新增，返回该笔记本的报告列表 |
| GET | `/:id/reports/:reportId` | 新增，返回单个报告详情 |
| POST | `/:id/report/generate` | 保留路径，但改为创建新报告而非覆盖 |
| DELETE | `/:id/reports/:reportId` | 新增，删除指定报告 |
| GET | `/:id/report` | 废弃或改为重定向到 `/:id/reports`（向后兼容） |

### 默认命名

报告标题格式：`研究报告 YYYY-MM-DD HH:mm`，使用服务端生成时间。

---

## 八、网页来源点击跳转（任务 1）

**已实现。** `SourcesPanel.vue` 中 web 类型来源已渲染为 `<a :href="url" target="_blank">`。无需额外改动。

---

## 九、滚动到底部按钮定位 Bug（任务 3）

### 问题分析

`ChatPanel.vue` 中的滚动到底部按钮使用 `absolute` 定位。需要确认其父容器（消息滚动区域）是否设置了 `position: relative`。如果按钮跟随滚动内容移动而非固定在视口底部，说明定位基准不对。

### 修复

确保消息列表的滚动容器设置 `position: relative`，按钮使用 `position: sticky` 或在滚动容器外层用 `position: absolute` + `bottom/right` 定位，使其始终固定在对话区域右下角。布局重构后对话移到左栏 tab 内，修复时直接在新位置处理。

---

## 实施顺序

由于任务 9（布局重构）是基石，其他任务都在重构后的布局上工作，所以必须先做 9。

1. **阶段 A — 基础设施**（可并行）
   - A1：提取公共 markdown 工具 + 增强配置 + 补充 CSS（任务 5/6）
   - A2：DB schema 变更 + 多报告 service/API（任务 7/8 后端部分）
   - A3：中文 prompt 统一（任务 7）
   - A4：删除来源 API（任务 4 后端部分）

2. **阶段 B — 布局重构**
   - B1：`NotebookWorkbenchView.vue` 布局改造 + 左栏 tab 切换
   - B2：`StudioPanel.vue` 移除报告预览
   - B3：新增 `ReportListPanel.vue` + `ReportDetailPanel.vue`

3. **阶段 C — 细节优化**（可并行）
   - C1：`SourceIcon.vue` 文件类型图标（任务 2）
   - C2：来源删除前端（任务 4 前端部分）
   - C3：滚动按钮定位修复（任务 3）

---

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 标签页组件 | 原生 `<button>` 组 | 两个 tab 不值得引入 Reka UI TabGroup |
| 代码高亮 | highlight.js + markedHighlight | 成熟、体积可按需裁剪、有暖色主题 |
| 文件类型图标 | 内联 SVG | 不引入图标库，6-7 个 SVG 手写即可 |
| 报告下载 | Blob + URL.createObjectURL | 纯前端下载 .md 文件，不需要后端参与 |
| 确认对话框 | 自定义小组件 | 不引入 UI 库，一个 teleport modal 即可 |
| DB 迁移 | 追加 DDL + 数据迁移 | 重建 research_reports 表结构 |

---

## 不做的事情

- 不引入 Element Plus、shadcn-vue 或其他 UI 套件
- 不支持 LaTeX 数学公式渲染
- 不做 notebook_source_states 表的大规模清理（仅在删除来源时顺便清理）
- 不做报告重命名功能（可以后续加）
- 不做右栏多媒体生成功能（本次只留空）


---

# 工作台布局重构与细节优化 — 实施计划

**状态：** 未开始
**规格来源：** `docs/superpowers/specs/2026-04-09-工作台布局重构与细节优化-设计-进行中.md`
**分支：** `opencode/workbench-layout-refactor`

---

## 概览

10 个任务，3 个阶段，7 个执行批次。阶段 A 为基础设施（后端 + 工具函数），阶段 B 为核心布局重构，阶段 C 为细节优化和收尾。

---

## 阶段 A — 基础设施

### 任务 1：提取公共 Markdown 渲染工具 + 增强配置

**目标：** 将 ChatPanel.vue 中的 inline markdown 渲染逻辑提取到 `client/src/utils/markdown.ts`，并增强配置（GFM 表格、代码高亮、删除线、任务列表）。

**修改文件：**
- 新建 `client/src/utils/markdown.ts` — 导出 `renderMarkdown(raw: string): string`
- 修改 `client/src/components/notebook-workbench/ChatPanel.vue` — 删除 inline `renderMarkdown`，改为 import 公共函数
- 修改 `client/src/style.css` — 补充 `prose-warm` CSS：table/thead/th/td/del/input[checkbox]/img/.hljs 样式
- 修改 `client/package.json` — 添加 `highlight.js` + `marked-highlight` 依赖

**实现细节：**
1. `markdown.ts` 中配置 marked：`marked.use({ gfm: true })`，使用 `markedHighlight` 插件集成 highlight.js
2. highlight.js 仅注册核心 + 常用语言（js/ts/python/json/bash/sql/html/css）
3. highlight 主题选 `github` 或类似暖色调主题，与书页风格一致
4. DOMPurify sanitize 保留在 `renderMarkdown` 函数内
5. CSS 中 table 样式：border-collapse、暖色 border、th 背景色、padding
6. 删除线：`text-decoration: line-through`
7. 任务列表 checkbox：appearance 定制、accent-color 暖色

**验收标准：**
- ChatPanel 中 assistant 消息的 markdown 渲染行为不变
- 表格、代码块（带高亮）、删除线、任务列表都能正确渲染
- `renderMarkdown` 可在任意组件中 import 使用
- TypeScript 编译 0 错误

**依赖：** 无

---

### 任务 2：多研究报告后端

**目标：** 将 research_reports 从「一笔记一报告」改为「一笔记多报告」，包括 DB schema、service 层、API 路由、前端 API 客户端。

**修改文件：**
- 修改 `server/src/db/schema.ts` — research_reports 表改为 id 主键 + notebook_id 索引 + title 字段
- 修改 `server/src/db/index.ts` — DDL 更新 + 数据迁移逻辑（旧数据补 id 和 title）
- 修改 `server/src/report/schema.ts` — Zod schema 添加 id + title
- 修改 `server/src/report/service.ts` — 重写为多报告 CRUD（listByNotebookId, create, getById, deleteById）
- 修改 `server/src/routes/notebooks/index.ts` — 新增 GET /:id/reports, GET /:id/reports/:reportId, DELETE /:id/reports/:reportId；修改 POST /:id/report/generate 为创建新报告
- 修改 `client/src/api/notebooks.ts` — 新增 listReports, getReport, deleteReport 方法
- 修改 `server/src/routes/notebooks/index.test.ts` — 适配多报告 API 测试

**实现细节：**
1. DB schema：`id TEXT PRIMARY KEY`（crypto.randomUUID）、`notebook_id TEXT NOT NULL`、`title TEXT NOT NULL`、`content TEXT`、`generated_at INTEGER`、`error_message TEXT`、`updated_at INTEGER NOT NULL`
2. 创建索引 `idx_reports_notebook ON research_reports(notebook_id)`
3. 数据迁移：检测旧表结构（notebook_id 为 PK），如果是旧结构则：读取旧数据 → DROP TABLE → 重建 → 插入旧数据（补 id + title）
4. Service：`createReport` 始终 INSERT；title 默认 `研究报告 YYYY-MM-DD HH:mm`
5. 报告列表按 `generated_at DESC` 排序
6. Worker 中的 `upsertReport` 调用改为 `createReport`

**验收标准：**
- 一个笔记本可以有多份报告
- 报告可以列表、详情查看、删除
- 旧数据迁移无丢失
- TypeScript 编译 0 错误
- API 测试通过

**依赖：** 无

---

### 任务 3：统一中文 Prompt

**目标：** 将所有与 NotebookLM 交互的 prompt 统一为中文。

**修改文件：**
- 修改 `server/src/research-runtime/orchestrator.ts` — `buildQuestionGenerationPrompt()` 改中文
- 修改 `server/src/worker/research.ts` — 问题生成 prompt (~L250) + 报告编译 prompt (~L163-180) 改中文

**实现细节：**
1. orchestrator.ts `buildQuestionGenerationPrompt`：将英文 prompt 翻译为中文，保持相同的语义和结构
2. research.ts 问题生成 prompt：改中文
3. research.ts 报告编译 prompt：改中文
4. 保持 prompt 的指令风格清晰、简洁

**验收标准：**
- 所有与 NotebookLM 交互的 prompt 均为中文
- prompt 语义与原英文版一致
- TypeScript 编译 0 错误

**依赖：** 无

---

### 任务 4：删除来源后端 API

**目标：** 实现删除来源的后端 API（远程 + 本地清理）。

**修改文件：**
- 修改 `server/src/notebooklm/client.ts` — 新增 `deleteSource(notebookId, sourceId)` 函数
- 修改 `server/src/notebooklm/index.ts` — 导出 `deleteSource`
- 修改 `server/src/source-state/service.ts` — 新增 `deleteSourceState(notebookId, sourceId)`
- 修改 `server/src/routes/notebooks/index.ts` — 新增 `DELETE /api/notebooks/:id/sources/:sourceId` 路由
- 修改 `client/src/api/notebooks.ts` — 新增 `deleteSource(notebookId, sourceId)` 方法

**实现细节：**
1. `client.ts`：使用 `runNotebookRequest` 封装 SDK 的 `client.sources.delete(notebookId, sourceId)`
2. 路由实现：先调 SDK 删除远程 → 再清理 `notebook_source_states` 表 → 返回 204
3. `source-state/service.ts`：新增 delete 函数，根据 notebookId + sourceId 删除记录
4. 前端 API：使用 `request<void>` + DELETE 方法

**验收标准：**
- DELETE API 返回 204
- 远程来源被删除
- 本地 source_states 对应记录被清理
- TypeScript 编译 0 错误

**依赖：** 无（但与任务 2 共享 routes/notebooks/index.ts 和 api/notebooks.ts，需顺序执行）

---

## 阶段 B — 布局重构

### 任务 5：通用确认对话框组件

**目标：** 创建 `ConfirmDialog.vue`，用于来源删除和报告删除的确认弹窗。

**修改文件：**
- 新建 `client/src/components/ui/ConfirmDialog.vue`

**实现细节：**
1. Props：`visible: boolean`、`title: string`、`message: string`、`confirmText?: string`（默认"确认"）、`cancelText?: string`（默认"取消"）、`danger?: boolean`（危险操作高亮确认按钮）
2. Events：`@confirm`、`@cancel`
3. 使用 `<Teleport to="body">` + overlay mask + 居中 modal
4. 样式跟随暖色书页主题：纸色背景、圆角、阴影
5. ESC 键关闭、点击 mask 关闭
6. 不引入任何 UI 库

**验收标准：**
- 组件可复用于任意确认场景
- 键盘交互（ESC 关闭）
- 视觉风格与书页主题一致
- TypeScript 编译 0 错误

**依赖：** 无

---

### 任务 6：核心布局重构

**目标：** 将三栏布局从「来源 | 对话 | 研究控制+报告」重构为「标签页(来源/对话) | 报告列表/详情 | 研究控制」。

**修改文件：**
- 修改 `client/src/views/NotebookWorkbenchView.vue` — 左栏 tab 切换、中栏报告视图、右栏精简
- 修改 `client/src/components/notebook-workbench/StudioPanel.vue` — 移除报告预览部分
- 新建 `client/src/components/notebook-workbench/ReportListPanel.vue` — 报告列表视图
- 新建 `client/src/components/notebook-workbench/ReportDetailPanel.vue` — 报告详情视图（markdown 渲染 + 工具栏）

**实现细节：**

左栏改造（WorkbenchView）：
1. 左栏尺寸常量：LEFT_MIN=320, LEFT_MAX=600, LEFT_INIT=400
2. 两个 tab：「来源」「对话」，用 `<button>` 组 + 条件渲染
3. tab 样式：底部 border 高亮当前 tab，暖色主题
4. `activeLeftTab: 'sources' | 'chat'` 响应式状态

中栏改造（WorkbenchView + 新组件）：
1. 中栏两个视图状态：`reportView: 'list' | 'detail'`
2. 列表视图 `ReportListPanel.vue`：卡片列表，每卡显示标题、时间、摘要（前100字）、× 删除按钮
3. 详情视图 `ReportDetailPanel.vue`：顶部工具栏（← 返回、↓ 下载 .md）、markdown 渲染报告全文
4. 使用任务 1 的 `renderMarkdown` 函数渲染报告
5. 下载功能：Blob + URL.createObjectURL 纯前端下载

右栏改造：
1. StudioPanel 移除报告预览区域（第 82-98 行左右）
2. 仅保留研究控制区（自动研究开关、进度、生成报告按钮）
3. 下方留空

数据流：
1. WorkbenchView 调用 listReports API 获取报告列表
2. 新增 `reports` ref 和 `selectedReportId` ref
3. 生成报告完成后刷新列表
4. 删除报告后刷新列表（使用 ConfirmDialog）

**验收标准：**
- 左栏 tab 切换正常，来源和对话两个面板独立工作
- 中栏报告列表展示正确，点击进入详情，返回列表
- 报告详情使用 markdown 渲染
- 报告可下载为 .md 文件
- 报告可删除（确认对话框）
- 右栏仅保留研究控制，下方留空
- TypeScript 编译 0 错误

**依赖：** 任务 1（renderMarkdown）、任务 2（多报告 API）、任务 5（ConfirmDialog）

---

### 任务 7：来源图标体系

**目标：** 创建 `SourceIcon.vue` 替代 `SourceFavicon.vue`，根据来源类型显示不同图标。

**修改文件：**
- 新建 `client/src/components/notebook-workbench/SourceIcon.vue`
- 修改 `client/src/components/notebook-workbench/SourcesPanel.vue` — 用 SourceIcon 替换 SourceFavicon

**实现细节：**
1. Props：`source: { type: string; url?: string }` + `size?: number`（默认 16）
2. web 类型：复用 SourceFavicon 的 favicon 获取逻辑（Google → DDG → /favicon.ico → globe SVG）
3. 其他类型用内联 SVG：
   - pdf：文档+PDF 标识
   - video：播放按钮
   - audio：音符/音波
   - text：文本文件
   - drive：云盘
   - file/其他：通用文件
4. SVG 颜色使用 `currentColor`，由父元素控制颜色
5. SourceFavicon.vue 不删除（其他地方可能引用），但 SourcesPanel 改用 SourceIcon

**验收标准：**
- web 来源显示 favicon
- 非 web 来源显示对应类型图标
- 图标大小可配置
- TypeScript 编译 0 错误

**依赖：** 无

---

## 阶段 C — 细节优化

### 任务 8：来源删除前端

**目标：** 在 SourcesPanel 中实现来源删除交互。

**修改文件：**
- 修改 `client/src/components/notebook-workbench/SourcesPanel.vue` — 添加 × 删除按钮 + 删除逻辑
- 修改 `client/src/views/NotebookWorkbenchView.vue` — 传递删除回调 prop

**实现细节：**
1. 每个来源项 hover 时右上角显示 × 按钮
2. 点击 × 弹出 ConfirmDialog："确定要删除来源「{title}」吗？此操作不可撤销。"
3. 确认后调用 deleteSource API
4. 成功后从本地列表移除 + toast 提示
5. 失败时 toast 错误提示

**验收标准：**
- hover 显示删除按钮
- 确认对话框正确弹出
- 删除成功后列表更新
- 错误处理完善
- TypeScript 编译 0 错误

**依赖：** 任务 4（deleteSource API）、任务 5（ConfirmDialog）、任务 6（布局重构后的 WorkbenchView）、任务 7（SourceIcon 已修改 SourcesPanel）

---

### 任务 9：滚动到底部按钮定位修复

**目标：** 修复对话区"滚动到底部"按钮随内容滚动的 bug。

**修改文件：**
- 修改 `client/src/components/notebook-workbench/ChatPanel.vue` — 按钮从滚动容器内移到外部

**实现细节：**
1. 将"滚动到底部"按钮从滚动容器内部移到外部
2. 使用 absolute 定位在 ChatPanel 容器的右下角（ChatPanel 本身 relative）
3. 按钮始终固定在对话区域右下角，不随内容滚动
4. 注意：布局重构后对话在左栏 tab 内，确保定位在新布局下正确

**验收标准：**
- 按钮始终固定在对话区域右下角
- 不随内容滚动
- 点击功能正常
- TypeScript 编译 0 错误

**依赖：** 任务 6（布局重构后 ChatPanel 在新位置）

---

### 任务 10：报告 Markdown 渲染收尾验证

**目标：** 确认 ReportDetailPanel 正确使用 renderMarkdown，所有 markdown 特性正常工作。

**修改文件：**
- 可能微调 `client/src/components/notebook-workbench/ReportDetailPanel.vue`
- 可能微调 `client/src/utils/markdown.ts`
- 可能微调 `client/src/style.css`

**实现细节：**
1. 验证报告详情中的 markdown 渲染：标题层级、列表、表格、代码高亮、引用、链接、删除线、任务列表
2. 验证 prose-warm CSS 在报告详情中的表现
3. 检查长报告的滚动行为
4. 确保 DOMPurify 不会意外过滤掉合法内容

**验收标准：**
- 所有 markdown 特性在报告详情中正确渲染
- 样式与书页主题一致
- TypeScript 编译 0 错误

**依赖：** 全部前置任务

---

## 批次执行计划

```
批次 1: [任务 1, 任务 3] — 并行（无文件冲突，无逻辑依赖）
批次 2: [任务 2] → [任务 4] — 顺序（共享 routes/notebooks/index.ts + api/notebooks.ts）
批次 3: [任务 5, 任务 7] — 并行（无文件冲突）
批次 4: [任务 6] — 依赖任务 1, 2, 5
批次 5: [任务 9] — 依赖任务 6（ChatPanel 在新位置）
批次 6: [任务 8] — 依赖任务 4, 5, 6, 7
批次 7: [任务 10] — 集成验证，依赖全部
```

---

## 验证策略

每个任务完成后：
1. `npx tsc --noEmit` 编译检查 0 错误
2. 运行相关测试（如有）
3. 规格合规审核
4. 代码质量审核

全部完成后：
1. 完整 TypeScript 编译检查
2. 全局代码审核
3. 手动验证关键交互流程
