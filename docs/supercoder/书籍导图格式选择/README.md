# 书籍导图格式选择

**状态：** 进行中

## 设计结论

点击"书籍导图"按钮后，先弹出格式选择弹窗，用户选定图表类型后，前端调 `POST /api/notebooks/:id/report/generate`（携带 `diagramType` 字段），服务端根据类型用不同 system prompt 让 LLM 生成对应 Mermaid 代码，存储并渲染。

## 动机

当前只能生成 mindmap 一种格式，但不同书籍适合不同图表：技术书适合流程图/类图，历史书适合时间线，项目管理书适合甘特图。提供格式选择让产出更有针对性。

## 设计决策

### 支持的图表类型（6种）

| 类型 key | 展示名 | Mermaid 头部 |
|----------|--------|-------------|
| `mindmap` | 思维导图 | `mindmap` |
| `flowchart` | 流程图 | `flowchart TD` |
| `timeline` | 时间线 | `timeline` |
| `sequenceDiagram` | 时序图 | `sequenceDiagram` |
| `classDiagram` | 类图 | `classDiagram` |
| `gantt` | 甘特图 | `gantt\ndateFormat YYYY-MM-DD` |

### API 协议扩展

`POST /api/notebooks/:id/report/generate` body 新增可选字段：
```json
{
  "presetId": "builtin-book-mindmap",
  "diagramType": "flowchart"
}
```
`diagramType` 缺失时默认 `"mindmap"`（向后兼容）。

### 服务端 `book-mindmap/service.ts` 扩展

- `buildBookMindmapFromSummary` 重命名为 `buildBookDiagramFromSummary(summary, diagramType, env, fetch)`
- 每个 `diagramType` 对应独立 system prompt，核心规则：输出只有 Mermaid 代码、无代码块标记、节点文字简短
- `MermaidMindmapPayload` 扩展为 `MermaidDiagramPayload`，新增可选 `diagramType` 字段（mindmap 时保持 `kind: "mermaid_mindmap"` 不变，其余类型设 `diagramType` 字段供前端参考，`kind` 统一保持 `"mermaid_mindmap"` 以复用现有渲染路径）

### 前端弹窗

新建 `BookDiagramTypeDialog.vue`（参照 `UploadBookDialog.vue` 的弹窗风格）：
- 6 个格式卡片，点击选中（高亮 border）
- 底部"生成"按钮，点击后关闭弹窗并触发生成
- 默认选中 `mindmap`

### 数据流

1. 用户点击"书籍导图"按钮 → `BookActionsPanel.vue` emit `onMindmap`
2. `BookWorkbenchView.vue` 的 `onGenerateMindmap` 改为：先弹出 `BookDiagramTypeDialog`，获取用户选择后再调 `generateBookDiagram(notebookId, diagramType)`
3. `generateBookDiagram` 调 `notebooksApi.generateReport(notebookId, "builtin-book-mindmap", { diagramType })`
4. 服务端生成 → 存储 → 客户端刷新，跳转到 summary tab

### 不推荐的方向

- ~~为每种图表类型创建独立 presetId（如 `builtin-book-flowchart`）~~ —— 会爆炸性增长 preset 数量，且每次新增图表类型都要改 DB 初始化脚本
- ~~引入新的 Vue 组件库~~ —— 现有内联弹窗模式已够用

## 涉及文件

**服务端：**
- 修改 `server/src/book-mindmap/service.ts`（扩展函数 + 类型 + 多类型 prompt）
- 修改 `server/src/routes/notebooks/index.ts:913` 处理 `diagramType` 参数

**客户端：**
- 新建 `client/src/components/book-workbench/BookDiagramTypeDialog.vue`
- 修改 `client/src/api/book-summary.ts`（`generateBookSummary` 支持传 `diagramType`）
- 修改 `client/src/api/notebooks.ts`（`generateReport` 接受额外参数）
- 修改 `client/src/views/BookWorkbenchView.vue`（`onGenerateMindmap` 接管弹窗流程）

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | — |

## 坑 / 注意事项

- gantt 图表对日期格式极其敏感，LLM 生成时 system prompt 必须明确要求日期格式与 `dateFormat YYYY-MM-DD` 一致，否则静默空白渲染
- mindmap 是 mermaid 实验性功能（v11.x），lazy load 机制在 Vite 中可能出现 race condition，已有代码中的 `renderDiagram` 做了错误处理 + DOM cleanup，保持不变即可
- `BookMindmapMermaid.vue` 组件名与渲染逻辑无关（它只接收 `code` 字符串），所有 mermaid 图表都可直接用它渲染，无需改名或新建组件

## 实施任务

> 按以下顺序实施，任务间有轻微依赖。

### 任务 1：服务端扩展 `buildBookDiagramFromSummary`

**文件：**
- 修改 `server/src/book-mindmap/service.ts`
- 修改 `server/src/book-mindmap/service.test.ts`

**意图：** 让 service 支持按 `diagramType` 生成不同 Mermaid 图表，保持向后兼容（默认 mindmap）

- [ ] 更新 `MermaidMindmapPayload`：新增可选 `diagramType?: string` 字段
- [ ] 新增 `DiagramType` 类型：`"mindmap" | "flowchart" | "timeline" | "sequenceDiagram" | "classDiagram" | "gantt"`
- [ ] 将 `buildBookMindmapFromSummary` 重命名为 `buildBookDiagramFromSummary`，新增 `diagramType: DiagramType = "mindmap"` 参数
- [ ] 新增 `getDiagramSystemPrompt(diagramType)` 函数，返回各类型对应 system prompt；mindmap 使用原有 prompt，其余参照 mindmap prompt 的约束风格（简短节点/行、最多N层、无代码块标记等，gantt 额外约束日期格式）
- [ ] `sanitizeMermaidMindmapCode` 重命名为 `sanitizeMermaidCode`，mindmap 保留"必须以 mindmap 开头"校验，其他类型校验对应关键字（flowchart、gantt 等）
- [ ] 更新旧名称的 export 为 `buildBookMindmapFromSummary = buildBookDiagramFromSummary`（alias，保持路由代码零改动选项，但下一任务选择直接用新名字）
- [ ] 更新 service.test.ts 覆盖 flowchart 类型的 parseMermaid 和 sanitize 路径
- [ ] 运行 `npm test --workspace=server` 通过

### 任务 2：路由层支持 `diagramType` 参数

**文件：**
- 修改 `server/src/routes/notebooks/index.ts:805-955`（generate route）
- 修改 `server/src/routes/notebooks/index.test.ts`（mindmap 相关测试）

**意图：** 从 request body 读取可选 `diagramType`，透传给 `buildBookDiagramFromSummary`

- [ ] 在 route handler body 解析处读取 `diagramType`（string，默认 `"mindmap"`，无效值 fallback `"mindmap"`）
- [ ] 调用 `buildBookDiagramFromSummary(result.answer, diagramType, process.env, fetch)`
- [ ] 验证 flowchart 请求返回 `contentJson.code` 以 `flowchart` 开头的测试用例通过
- [ ] 运行 `npm test --workspace=server` 通过

### 任务 3：客户端 API 层支持 `diagramType`

**文件：**
- 修改 `client/src/api/notebooks.ts`（`generateReport` 接受额外 body 字段）
- 修改 `client/src/api/book-summary.ts`（新增 `generateBookDiagram` 函数）

**意图：** 让 API 调用层能传递 `diagramType` 字段到服务端

- [ ] `notebooksApi.generateReport` 第三个参数改为可选 `extraBody?: Record<string, unknown>`，merge 进 request body
- [ ] `book-summary.ts` 新增 `generateBookDiagram(notebookId, diagramType)` → 调 `generateReport(id, "builtin-book-mindmap", { diagramType })`
- [ ] 原 `generateBookSummary` 调用不受影响

### 任务 4：前端弹窗组件 `BookDiagramTypeDialog.vue`

**文件：**
- 新建 `client/src/components/book-workbench/BookDiagramTypeDialog.vue`

**意图：** 提供格式选择 UI，用户点击后返回所选 diagramType 并触发生成

- [ ] 组件接收 `open: boolean` 和 `onGenerate: (diagramType: string) => void`、`onClose: () => void` props
- [ ] 6 个格式卡片，默认高亮 `mindmap`；每个卡片显示图表名 + 简短说明（一行中文）
- [ ] 弹窗样式参照 `BookWorkbenchView.vue` 中的 `promptDialogOpen` 内联弹窗风格（`fixed inset-0 z-50`，border + `bg-[#f8f3ea]`，header + footer 结构）
- [ ] 点击格式卡片切换选中高亮，点击"生成"传 `onGenerate(selectedType)` 关闭弹窗
- [ ] 点击遮罩/关闭按钮触发 `onClose`

### 任务 5：接入 `BookWorkbenchView.vue`

**文件：**
- 修改 `client/src/views/BookWorkbenchView.vue`

**意图：** 将"书籍导图"按钮的直接生成改为先弹窗选型再生成

- [ ] 新增 `diagramDialogOpen: ref(false)`
- [ ] `onGenerateMindmap` 改为：设置 `diagramDialogOpen.value = true`（不直接生成）
- [ ] 新增 `onDiagramDialogGenerate(diagramType)` 函数：关闭弹窗，调 `generateBookDiagram(notebookId, diagramType)` 并走原有生成流程（loading 状态、toast、刷新、切 tab）
- [ ] 在 `#dialogs` slot 中挂载 `<BookDiagramTypeDialog>` 组件
- [ ] 验证：点击"书籍导图"→弹窗出现→选 flowchart→生成→中栏显示流程图
