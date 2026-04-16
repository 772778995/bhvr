# 产物统一持久化与接口合并

**当前状态：** 已完成

## 设计结论

将 `research_reports` 和 `artifacts` 两张独立表合并为统一的 `report_entries` 表，音频/幻灯片等二进制内容改为写本地文件系统（`data/files/`），DB 只存相对路径。后端暴露单一列表接口 `GET /api/notebooks/:id/entries`，前端 `ReportListPanel` 改为调用该接口，废弃并发双请求。

---

## 一、当前问题

| 问题 | 说明 |
|------|------|
| 两张独立表 | `research_reports`（本地研究报告）和 `artifacts`（NotebookLM Studio 产物）分离，前端需要并发调两个接口再手工合并 |
| 大 base64 入 SQLite | 音频 artifact 的 `contentJson` 存 MP3 base64 字符串，幻灯片存 PDF base64；SQLite text 字段承载 MB 级二进制数据不合适 |
| 前端双接口合并逻辑 | `ReportListPanel.vue` 自己维护 `UnifiedItem` 并发合并，脆弱且冗余 |

---

## 二、目标架构

```
GET /api/notebooks/:id/entries
  → 返回该笔记本下所有产物（本地研究报告 + Studio artifacts）
  → 按 created_at 降序排列
  → 带 entry_type、file_url 等统一字段

POST /api/notebooks/:id/artifacts
  → 创建时行为不变
  → 当 artifact READY 时，二进制内容写 data/files/，DB 存 file_path

GET /api/files/:filename
  → 静态文件服务，直接从 data/files/ 读取并返回
```

---

## 三、DB Schema 设计

### 3.1 新表：`report_entries`

```sql
CREATE TABLE report_entries (
  id           TEXT PRIMARY KEY,          -- randomUUID
  notebook_id  TEXT NOT NULL,
  entry_type   TEXT NOT NULL,             -- 'research_report' | 'artifact'
  -- 通用字段
  title        TEXT,
  state        TEXT NOT NULL DEFAULT 'ready',  -- 'creating' | 'ready' | 'failed'
  -- 研究报告专用
  content      TEXT,                      -- Markdown 正文
  error_message TEXT,
  -- Artifact 专用
  artifact_id  TEXT,                      -- NotebookLM SDK artifact ID
  artifact_type TEXT,                     -- SDK artifact type 字符串
  content_json TEXT,                      -- 结构化内容（quiz/flashcards 等小数据）
  file_path    TEXT,                      -- 相对路径，如 "audio-xxx.mp3"（大二进制）
  -- 时间戳
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
)
```

**索引：**
- `idx_report_entries_notebook` ON `(notebook_id, created_at DESC)`
- `UNIQUE idx_report_entries_artifact_id` ON `(artifact_id)` WHERE artifact_id IS NOT NULL

### 3.2 旧表保留策略

- `research_reports` 和 `artifacts` 表继续存在，**不删除**
- 新建迁移时把现有数据 INSERT INTO `report_entries`
- 新代码只写 `report_entries`；旧路由（`/api/notebooks/:id/reports`、`/api/notebooks/:id/artifacts`）保留，但内部改为读 `report_entries`（向后兼容，前端切换完成后再移除）

---

## 四、文件系统存储方案

### 4.1 目录结构

```
data/
  notebooklm.db
  files/
    audio-{uuid}.mp3
    slides-{uuid}.pdf
```

`data/files/` 在 `.gitignore` 中（`data/` 已忽略）。

### 4.2 何时写文件

- `GET /api/notebooks/:id/artifacts/:artifactId`：当 SDK 返回 `state=READY`，检查 artifact 类型
  - `audio`：把 `artifact.audioData`（base64）解码写 `data/files/audio-{uuid}.mp3`，`contentJson` 中去除 `audioData` 字段
  - `slide_deck`：调用 `client.artifacts.download(artifactId, 'data/files/')` 或直接写 PDF base64，存路径
  - 其他类型（quiz、flashcards、report）：内容小，继续存 `contentJson`，不写文件

### 4.3 文件服务路由

```
GET /api/files/:filename
  → 从 data/files/:filename 读取
  → Content-Type 根据扩展名推断（.mp3 → audio/mpeg，.pdf → application/pdf）
  → 支持 Range 请求（音频播放需要）
```

---

## 五、接口设计

### 5.1 统一列表接口

**`GET /api/notebooks/:id/entries`**

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "entryType": "research_report",
      "title": "关于 X 的研究报告",
      "state": "ready",
      "content": "## 摘要\n...",
      "createdAt": "2026-04-09T12:00:00Z"
    },
    {
      "id": "uuid",
      "entryType": "artifact",
      "title": "音频概述",
      "state": "ready",
      "artifactId": "nlm-artifact-id",
      "artifactType": "audio",
      "fileUrl": "/api/files/audio-uuid.mp3",
      "contentJson": null,
      "createdAt": "2026-04-09T13:00:00Z"
    },
    {
      "id": "uuid",
      "entryType": "artifact",
      "title": "测验",
      "state": "ready",
      "artifactId": "nlm-artifact-id",
      "artifactType": "quiz",
      "fileUrl": null,
      "contentJson": { "questions": [...], "totalQuestions": 5 },
      "createdAt": "2026-04-09T14:00:00Z"
    }
  ]
}
```

### 5.2 删除接口

**`DELETE /api/notebooks/:id/entries/:entryId`**

- 从 `report_entries` 删除记录
- 如果有 `file_path`，同时删除 `data/files/{file_path}`

---

## 六、前端改造

### 6.1 API 客户端

在 `client/src/api/notebooks.ts` 新增：

```ts
export interface ReportEntry {
  id: string;
  entryType: 'research_report' | 'artifact';
  title: string | null;
  state: 'creating' | 'ready' | 'failed';
  content?: string | null;
  artifactId?: string | null;
  artifactType?: string | null;
  fileUrl?: string | null;
  contentJson?: Record<string, unknown> | null;
  createdAt: string;
}

// 新增方法
listEntries(notebookId: string): Promise<ReportEntry[]>
deleteEntry(notebookId: string, entryId: string): Promise<void>
```

### 6.2 ReportListPanel.vue

- 删除 `fetchArtifacts()` 并发逻辑
- 改为调用 `notebooksApi.listEntries(notebookId)` 单一接口
- `UnifiedItem` 从 `ReportEntry` 直接映射，不再手动合并

### 6.3 ReportDetailPanel.vue

- artifact 详情：如果有 `fileUrl`，展示对应播放器/下载按钮
  - 音频：`<audio controls>` 加载 `fileUrl`
  - 幻灯片/PDF：显示下载按钮（`<a href={fileUrl} download>`）
- 其余类型（quiz、flashcards）：保持现有展示逻辑不变

### 6.4 StudioPanel.vue 轮询逻辑

- 轮询调用的是 `GET /api/notebooks/:id/artifacts/:artifactId`（旧接口）
- 旧接口内部改为写 `report_entries`，并返回相同格式 → **前端无需改动**
- 轮询完成后触发 `refreshKey++` → `ReportListPanel` 重新调用 `/entries` 刷新列表

---

## 七、迁移策略（不破坏现有数据）

1. 新建迁移脚本，在 `db/index.ts` 初始化时自动创建 `report_entries` 表
2. 启动时运行一次性迁移：`INSERT OR IGNORE INTO report_entries SELECT ... FROM research_reports` + `INSERT OR IGNORE INTO artifacts ...`
3. 新代码同时写 `report_entries` 和旧表（双写），确保旧接口仍能工作
4. 前端切换到 `/entries` 接口后，下一期移除旧接口和双写

---

## 八、实施任务清单

### 后端

- [ ] `db/schema.ts`：新增 `reportEntries` 表定义
- [ ] `db/index.ts`：新增建表 SQL + 一次性数据迁移
- [ ] `db/reportEntries.ts`：CRUD 函数（insert、listByNotebook、getById、deleteById）
- [ ] `routes/files/index.ts`：静态文件服务路由（带 Range 支持）
- [ ] `routes/notebooks/index.ts`：
  - 新增 `GET /:id/entries` 路由
  - 新增 `DELETE /:id/entries/:entryId` 路由
  - 修改 `GET /:id/artifacts/:artifactId`：READY 时写文件 + 写 `report_entries`
  - 修改研究任务完成时写 `report_entries`（而非仅 `research_reports`）
- [ ] `app.ts` 或入口：挂载 `/api/files` 路由

### 前端

- [ ] `api/notebooks.ts`：新增 `ReportEntry` 类型、`listEntries`、`deleteEntry`
- [ ] `ReportListPanel.vue`：改为调用 `listEntries`，移除双请求合并逻辑
- [ ] `ReportDetailPanel.vue`：音频播放器 + PDF 下载按钮
- [ ] `NotebookWorkbenchView.vue`：`onDeleteReport` 改为调用 `deleteEntry`

---

## 九、不在本期范围内

- 视频 artifact（SDK 标注 experimental，download 未完全实现）：只存 `artifactId` 和状态，不下载
- 音频流式传输优化（本期支持 Range 请求即可）
- 旧接口删除（下一期）
- 前端搜索/筛选 entries（下一期）
