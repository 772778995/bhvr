# Markdown 文件化与未完成状态轮询

**当前状态：** 进行中

## 设计结论

两件事：(1) 研究报告 markdown 从数据库 `content` 字段改为文件存储，列表 API 只返回元数据；(2) 来源 processing 和产物 creating 状态增加前端自动轮询，刷新页面后不丢失进度追踪。

---

## 一、Markdown 文件化

### 问题

`GET /:id/entries` 列表 API 对每条 `research_report` 返回完整 markdown 文本（`content` 字段）。报告数量增长后，单次列表请求传输量线性膨胀。

### 方案

与音频文件一致的模式：markdown 写入 `data/files/report-{uuid}.md`，`file_path` 存文件名，`content` 留空。

### 后端改动

1. **`server/src/routes/notebooks/index.ts` — `POST /:id/report/generate`**
   - 生成 markdown 后，调用 `writeTextFile(markdown, \`report-${crypto.randomUUID()}.md\`)` 写入文件
   - `insertReportEntry()` 传 `filePath: filename`，`content: null`
   - 新增 `writeTextFile(text, filename)` 工具函数（与 `writeBase64File` 同级）

2. **`server/src/routes/notebooks/index.ts` — `GET /:id/entries`**
   - 列表响应中 `content` 字段不再返回（或始终返回 null）
   - `fileUrl` 字段已有：`r.filePath ? '/api/files/' + r.filePath : null`

3. **`server/src/routes/files/index.ts`**
   - MIME 映射添加 `.md` → `text/markdown; charset=utf-8`

4. **`server/src/db/index.ts` — 启动迁移**
   - 查找 `entry_type = 'research_report' AND content IS NOT NULL AND file_path IS NULL` 的旧行
   - 每条：写文件 → 更新 `file_path` → 清空 `content`

### 前端改动

1. **`client/src/api/notebooks.ts`**
   - 新增 `fetchEntryContent(fileUrl: string): Promise<string>` — fetch 原始文件文本

2. **`client/src/components/notebook-workbench/ReportDetailPanel.vue`**
   - 研究报告预览：从 `entry.content` 改为按需 fetch `entry.fileUrl`
   - 本地缓存已 fetch 的内容（`Map<entryId, string>`），避免重复请求
   - 加载中显示占位状态

3. **`ReportListPanel.vue`** — 无需改动（只显示标题）

---

## 二、来源 processing 轮询

### 问题

来源添加的 SSE 流结束后（成功或超时），如果来源仍为 processing，前端不再轮询。刷新页面后 processing 来源永远卡住。

### 方案

`NotebookWorkbenchView.vue` 在来源列表中检测到 processing 状态时，自动启动轮询。

### 实现

1. **`NotebookWorkbenchView.vue`**
   - `watch` sources 列表，如有 `status === 'processing'` 的来源，启动定时器
   - 每 5 秒调用 `GET /:id/sources/status`
   - 当 `allReady === true` 时，刷新来源列表并停止轮询
   - 超时 5 分钟后停止
   - 组件 unmount 时清理定时器

2. **后端** — 无需改动，`GET /:id/sources/status` 已存在

---

## 三、产物 creating 恢复轮询

### 问题

StudioPanel 的 `pollArtifact()` 仅在当次会话有效。刷新页面后，`creating` 状态的产物无人轮询，永远卡在 creating。

### 方案

`NotebookWorkbenchView.vue` 在 entries 列表中检测到 `state === 'creating'` 的产物时，自动恢复轮询。StudioPanel 原有的即时轮询保留不动（两者不冲突，后端幂等）。

### 实现

1. **`NotebookWorkbenchView.vue`**
   - `watch` entries 列表，筛出 `state === 'creating' && artifactId` 的条目
   - 对每个 creating entry，每 10 秒调用 `GET /:id/artifacts/:artifactId`（比 StudioPanel 的 3 秒保守，省 SDK 配额）
   - 当返回 `READY` 或 `FAILED` 时，刷新 entries 列表并停止该条目的轮询
   - 单条超时 10 分钟
   - 组件 unmount 时清理所有定时器

2. **后端** — 无需改动，`GET /:id/artifacts/:artifactId` 已有完整的 SDK 查询 → 文件持久化 → DB 更新逻辑

---

## 不在范围内

- Research worker 的报告不写 `report_entries`（遗留问题，单独处理）
- 产物 `contentJson`（quiz/flashcard 等小 JSON）不改为文件存储
- 批量轮询 API（当前逐条轮询够用，YAGNI）

---

## 文件清单

| 文件 | 改动类型 |
|------|---------|
| `server/src/routes/notebooks/index.ts` | 修改：报告生成写文件、列表 content 置空 |
| `server/src/routes/files/index.ts` | 修改：添加 .md MIME |
| `server/src/db/index.ts` | 修改：启动迁移逻辑 |
| `client/src/api/notebooks.ts` | 修改：新增 fetchEntryContent |
| `client/src/components/notebook-workbench/ReportDetailPanel.vue` | 修改：按需 fetch 文件内容 |
| `client/src/views/NotebookWorkbenchView.vue` | 修改：来源轮询 + 产物恢复轮询 |
