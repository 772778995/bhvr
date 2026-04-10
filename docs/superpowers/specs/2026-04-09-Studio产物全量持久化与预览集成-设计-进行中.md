# Studio产物全量持久化与预览集成

**当前状态：** 进行中

## 设计结论

当前 Studio artifact 集成并没有完成，现状更接近“部分类型能生成、少数类型能展示一点内容”，离“生成后持久化到本地系统、支持预览与下载、刷新后仍可恢复”还有明显缺口。下一阶段必须按 artifact 类型逐一补齐完整链路：`NotebookLM READY -> 下载/提取内容 -> 持久化到 report_entries + data/files -> /entries 暴露统一数据 -> ReportDetailPanel 做类型化预览/下载`。

本期不再把所有 artifact 混成一套模糊逻辑，而是明确分成三类：

1. **结构化 JSON 型**：`quiz`、`flashcards`
2. **本地文件型**：`audio`、`slide_deck`、`video`、`infographic`
3. **半结构 / 元数据型**：`report`、`mind_map`

每类都定义单独的持久化规则和前端预览规则，不再依赖“SDK get() 恰好返回了点什么”这种运气工程。

---

## 一、现状问题

### 1.1 音频问题已经暴露出主链路缺陷

- `audio` 条目存在 `state = ready + file_path = null + content_json = {}` 的坏数据
- 旧代码把这种残缺条目当作 ready 缓存，导致后续不会再尝试下载 MP3
- 前端只能看到 `fileUrl = null`，显示“音频数据不可用”

这不是单点 bug，而是整个 artifact 持久化策略不完整的直接证据。

### 1.2 其他类型也存在同类缺口

- `slide_deck`：DB 中已有 `ready` 条目，但 `file_path = null`，说明 PDF/PNG 没有真正下载落盘
- `report`：DB 中出现 `ready + content_json = {}` 的空壳，说明 report 内容也没有真正提取
- `video`：当前只知道 SDK 有 `videoData` URL / download 机制，但本地系统没有保存文件，也没有前端预览
- `infographic`：SDK 能返回图片数据，但当前系统没有写入本地文件，也没有展示图片
- `mind_map`：SDK 目前只返回 metadata/experimental 标记，当前系统没有定义“最低可接受展示策略”

### 1.3 前端预览只完成了两类半

- 已有：研究报告 markdown、quiz、flashcards、部分 audio UI、slides 下载按钮
- 缺失：video、infographic、mind_map、report artifact 的真正内容展示
- 当前 UI 兜底文案是“需在 NotebookLM 中查看”，这不是集成完成，只是占位

---

## 二、目标

对以下 artifact 类型逐一实现完整集成：

1. `audio`
2. `slide_deck`
3. `video`
4. `mind_map`
5. `flashcards`
6. `quiz`
7. `infographic`
8. `report`

这里用户还提到“数据表”，对应 NotebookLM 现有能力，应优先理解为：

- `report` 导出到 Google Sheets 不适合直接作为本地可预览 artifact 主链
- 当前系统内更可行的数据表形态是：`flashcards/quiz/report` 的结构化导出视图，或 `report` 的 CSV/表格化摘要

因此“数据表”本期不单独新增一个伪 artifact type，而是作为 `report` / `flashcards` / `quiz` 的附加导出与表格化预览能力处理，避免为了名字好听再造一层假类型。

---

## 三、类型分组与持久化规则

### 3.1 结构化 JSON 型

#### `quiz`

- 数据来源：`sdk.artifacts.get()` 返回 `questions` + `totalQuestions`
- 持久化：写入 `report_entries.content_json`
- 文件：不落本地文件
- 预览：继续使用当前问答式卡片 UI
- 下载：新增 `下载 JSON`

#### `flashcards`

- 数据来源：`sdk.artifacts.get()` 返回 `flashcards` + `csv`
- 持久化：写入 `report_entries.content_json`
- 文件：默认不强制落文件；但允许附带生成 `flashcards-<uuid>.json` 作为导出文件
- 预览：继续使用当前翻卡 UI
- 下载：新增 `下载 JSON`、`下载 CSV`

### 3.2 本地文件型

#### `audio`

- 数据来源：优先 `artifact.audioData`；缺失时强制走 `downloadAudioFile()`
- 持久化：`data/files/audio-<uuid>.mp3`
- DB：`file_path` 指向 mp3；`content_json` 仅保留 `duration`
- 预览：`<audio controls>`
- 下载：下载 MP3
- 修复要求：历史上 `ready + file_path = null` 的旧条目必须可自愈

#### `slide_deck`

- 数据来源：SDK `get()` 只能拿 slide URLs；真正下载必须走 `sdk.artifacts.download()` 或等价底层下载逻辑
- 持久化：默认存 PDF 到 `data/files/slides-<uuid>.pdf`
- DB：`file_path` 指向 pdf；`content_json` 可附带 `pageCount` / `downloadFormat`
- 预览：优先内嵌 `<iframe>` / `<object>` 预览 PDF；移动端退化为下载按钮
- 下载：下载 PDF
- 后续增强：如有需要，再支持 PNG 幻灯片逐页浏览，但不是第一步

#### `video`

- 数据来源：SDK `get()` 返回 `videoData` URL；真正下载必须走 `sdk.artifacts.download()`
- 持久化：`data/files/video-<uuid>.mp4`
- DB：`file_path` 指向 mp4；`content_json` 可保留 `duration`、`status`、封面占位字段
- 预览：HTML5 `<video controls>`
- 下载：下载 MP4
- 约束：服务端运行环境必须能完成下载；如果 NotebookLM/Playwright 下载失败，条目必须明确标记 failed，而不是继续 ready 空壳

#### `infographic`

- 数据来源：SDK `get()` 返回 `imageData` / `imageUrl`
- 持久化：统一转成本地图像文件，如 `infographic-<uuid>.png`
- DB：`file_path` 指向图片；`content_json` 保留 `width`、`height`、`mimeType`
- 预览：直接 `<img>` 展示，支持点击放大
- 下载：下载图片原文件

### 3.3 半结构 / 元数据型

#### `report`

- 数据来源：SDK `get()` 对 report 只返回 metadata；真正内容要走 `sdk.artifacts.download()` 或等价 report content 获取逻辑
- 持久化：与研究报告统一，写 markdown 到 `data/files/artifact-report-<uuid>.md`
- DB：`file_path` 指向 markdown 文件；`content_json` 可保留少量元信息（如导出链接、摘要）
- 预览：复用 research report 的 markdown 渲染链路
- 下载：下载 `.md`

#### `mind_map`

- 数据来源：当前 SDK 明示只有 metadata + experimental 标记，暂时拿不到真正可渲染的结构化树
- 持久化：先持久化 metadata（title / state / experimental），如果后续能拿到结构数据再扩展
- 预览：本期定义最低可接受方案，不再用“去 NotebookLM 看”敷衍：
  - 若能从 SDK/raw response 拿到节点结构：渲染本地思维导图
  - 若拿不到：展示“思维导图已生成”的专属说明卡、生成时间、状态、下载/导出能力说明，并明确列为后续增强项
- 下载：当前无稳定下载格式，不承诺伪下载

这部分要诚实：如果 NotebookLM 当前没公开足够结构，就别假装自己能 1:1 复刻。先把系统内的状态、记录、入口做完整，再决定是否继续逆向更深层数据。

---

## 四、后端统一原则

### 4.1 `GET /api/notebooks/:id/artifacts/:artifactId`

这个接口继续作为“修复/补全入口”：

- `CREATING` -> 返回状态，不持久化内容
- `FAILED` -> `markArtifactEntryFailed()`
- `READY` -> 根据 artifact type 执行真正的内容提取与本地持久化

禁止再出现以下状态：

- `state = ready` 但对前端可用内容完全缺失
- `audio/slide/video/infographic` 的 `file_path = null`
- `report` 的内容未落地却写成空 `{}`

### 4.2 缓存命中条件必须改成“内容完整”

不能再用“有 `content_json` 就算缓存完整”这种低标准。

改为按类型判断：

- `audio` / `video` / `slide_deck` / `infographic`：必须 `file_path` 非空
- `quiz` / `flashcards`：必须 `content_json` 非空且不是 `{}`
- `report`：必须 `file_path` 非空或 `content_json.content` 非空
- `mind_map`：本期允许 metadata 级 ready，但要单独标记为 `previewMode = 'metadata_only'`

### 4.3 `/entries` 必须只暴露前端真实可用字段

统一返回：

- `artifactType`
- `state`
- `fileUrl`
- `contentJson`
- 可选 `previewMode`

不要把 SDK 的不稳定原始字段原封不动透传到前端。

---

## 五、前端预览策略

### 5.1 保留现有高质量实现

- `quiz`：保持问答卡片交互
- `flashcards`：保持翻卡交互
- `research_report`：保持 markdown 渲染

### 5.2 统一补上下载按钮规则

工具栏按类型显示：

- `audio`：下载 MP3
- `video`：下载 MP4
- `slide_deck`：下载 PDF
- `infographic`：下载图片
- `report`：下载 Markdown
- `quiz`：下载 JSON
- `flashcards`：下载 JSON / CSV

### 5.3 各类型预览要求

- `audio`：播放器 + 时长 + 自愈补取状态
- `video`：视频播放器 + 下载按钮
- `slide_deck`：内嵌 PDF 预览 + 下载按钮
- `infographic`：图片预览 + 下载按钮
- `report`：markdown 渲染 + 下载按钮
- `mind_map`：专属 metadata 卡片；后续若拿到结构，再做可视化树

### 5.4 视觉要求

仍然遵守当前“档案页 / 书页”方向：

- 暖纸底
- 墨色文字
- 小范围工具栏，不做 SaaS 控制台式外观
- 不引入 UI 套件

---

## 六、实施顺序

不要八种一起乱改，按“先补数据链，再补预览”的顺序分批推进。

### Phase 1：补齐后端持久化主链

1. `audio` 完整修复并验证
2. `report` artifact 改为写 markdown 文件
3. `slide_deck` 改为落 PDF
4. `infographic` 改为落图片
5. `video` 改为落 mp4

### Phase 2：补齐前端预览/下载

1. `audio` 自愈 + 播放器
2. `report` artifact markdown 预览
3. `slide_deck` PDF 预览
4. `infographic` 图片预览
5. `video` 播放器
6. `quiz` / `flashcards` 下载能力

### Phase 3：Mind Map 与“数据表”收尾

1. 深挖 NotebookLM / SDK 是否能拿到 mind map 结构
2. 若能拿到：实现本地思维导图预览
3. 若拿不到：保留 metadata 预览，并明确为能力边界
4. “数据表”作为结构化导出视图接入 `report` / `flashcards` / `quiz`

---

## 七、验证要求

每完成一个类型，都必须验证：

1. 生成新 artifact
2. 轮询至 ready
3. `report_entries` 写入完整
4. `data/files/` 落文件（若该类型需要）
5. 刷新页面后仍可预览
6. 下载按钮可用

不能再接受“本次会话里看起来能用，刷新后死掉”的伪完成。

---

## 八、当前音频修复结论

本轮已明确修复方向：

- 后端 `audio` 不再把 `ready + file_path = null` 当作完整缓存
- `audioData` 缺失时强制走 `downloadAudioFile()`
- 前端音频详情在遇到历史坏条目时，会主动触发一次后端修复

这部分是整个全量 artifact 集成的第一步，不是终点。

---

## 九、当前实施顺序（锁定）

为了避免再次陷入“每种都碰一点，结果每种都半死不活”的状态，当前实施顺序锁定为：

1. `audio`：修复 READY 空壳、自愈旧数据、确保 MP3 落盘
2. `report` artifact：复用 markdown 文件链路，打通真正内容预览
3. `slide_deck`：先实现 PDF 落盘 + PDF 预览
4. `infographic`：实现图片落盘 + 图片预览
5. `video`：实现 mp4 落盘 + 原生 video 预览
6. `quiz` / `flashcards`：补下载能力与表格化导出
7. `mind_map`：只做 metadata-only 完整展示，除非后续确认能拿到结构化导图数据

不再接受“同时做完所有 artifact 类型”这种说法式完成。每种类型都要独立经过：生成、落盘、刷新恢复、预览、下载这 5 个检查点。
