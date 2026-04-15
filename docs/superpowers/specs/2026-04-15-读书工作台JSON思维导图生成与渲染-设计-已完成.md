# 读书工作台JSON思维导图生成与渲染设计

**当前状态：** 已完成
**任务组标识：** 2026-04-15-读书工作台JSON思维导图生成与渲染
**对应工作区：** .worktrees/2026-04-15-读书工作台JSON思维导图生成与渲染-设计/
**工作区状态：** 已回收
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`/book` 的第三个阅读产出不再走 Mermaid 文本链路，而是新增 `书籍导图` 入口：先让 NotebookLM 基于当前书籍来源生成一份结构化中文摘要，再调用现有 OpenAI-compatible 模型把这份摘要压缩成受约束的 JSON 树，最终仍作为 `research_report` 行写入 `report_entries`，前端在 `/book` 中直接把 JSON 树渲染为本地纸页式导图。导图结果和 `书籍简述`、`详细解读` 继续共用 `/api/notebooks/:id/report/generate`、右栏历史列表和中栏详情，不新开 artifact 子系统，也不依赖 NotebookLM 原生 `mind_map artifact`。

## 背景判断

- 现有两份思维导图相关规格已经把方向说透了：Mermaid `mindmap` 能做，但稳定性和可读性都一般；NotebookLM 原生 `mind_map artifact` 目前更像 metadata-only。继续在这两条路上硬抠，只是在跟不稳定输入谈恋爱。
- 当前仓库已经有足够可复用的基础设施：`report_entries` 支持 `content_json + file_path`，`/entries` 会把 `contentJson` 暴露给前端，`/book` 又已经有基于 `presetId` 的书籍生成入口。既然骨架都在，再新造一套 mind map 专用表和接口，属于典型的为抽象而抽象。
- 服务端现成的 OpenAI-compatible 调用模式已经在 `server/src/book-finder/service.ts` 里跑着，用同一组 `OPENAI_BASE_URL`、`OPENAI_TOKEN`、`OPENAI_MODEL` 去做“摘要转 JSON 树”是当前风险最低的实现。
- 前端当前只有 Markdown 渲染链，没有 Mermaid/Markmap 执行链。这个现实很诚实：与其先背一个图形依赖包的税，不如先把 JSON 树本地渲染做好。树渲染是我们可控的，Mermaid 出什么幺蛾子可不是。

## 范围边界

本次实现：

- 新增 `builtin-book-mindmap` 内置 preset 与 `/book` 的 `书籍导图` 入口
- `/api/notebooks/:id/report/generate` 特殊处理该 preset：NotebookLM 先产出结构化摘要，再调用 OpenAI-compatible 模型生成 JSON 树
- 导图结果继续写入 `report_entries` 的 `research_report` 行：`file_path` 持久化结构化摘要 Markdown，`content_json` 持久化 JSON 树，`preset_id` 标记为 `builtin-book-mindmap`
- `/book` 的历史列表、中栏标签和空态文案从“书籍总结”收口为更准确的“阅读产出”，让导图和两种摘要共存时不显得名不副实
- 前端新增本地递归树渲染组件，在桌面和移动端都能直接展示 JSON 导图
- 为后端路由、DB seed、前端动作与渲染补测试

本次不实现：

- 不接入 Mermaid、Markmap、MindElixir 等第三方导图库作为首版主路径
- 不接入 NotebookLM 原生 `mind_map artifact` 链路
- 不做导图编辑、拖拽、折叠、导出图片或多主题切换
- 不为“结构化 research_report”抽象一套新的通用插件系统；当前先把 `/book` 这一个真实场景做对

## 数据契约

`builtin-book-mindmap` 对应的 `report_entries.content_json` 统一使用以下结构：

```json
{
  "kind": "book_mindmap",
  "version": 1,
  "title": "书名",
  "root": {
    "label": "书名",
    "note": "一句话核心主旨",
    "children": [
      {
        "label": "核心问题",
        "note": "作者试图回答什么",
        "children": []
      }
    ]
  }
}
```

约束如下：

- `kind` 固定为 `book_mindmap`
- `version` 固定为 `1`
- 每个节点至少包含 `label`
- `note` 可选，用于展示 1 句简要解释，不承载长段正文
- `children` 可选，缺失时按空数组处理
- 树深度控制在 4 层以内，单节点直接子节点控制在 8 个以内
- 服务端在持久化前必须校验和清洗结构；模型如果吐出垃圾 JSON，直接报错，不把坏数据塞进库里恶心后人

`file_path` 对应的 Markdown 文件保存 NotebookLM 生成的结构化摘要原文，用作：

- JSON 转换失败时的问题定位材料
- 前端在 JSON 丢失或校验失败时的回退阅读内容

## 推荐实现

### 1. 后端生成链路

- `server/src/db/index.ts` 新增 `builtin-book-mindmap` 的 seed，prompt 目标不是直接生成导图语法，而是生成“适合转树”的结构化摘要：核心主旨、章节结构、关键概念、论证脉络、案例与实践启发。
- `server/src/routes/notebooks/index.ts` 扩展 Book 页可直接生成的 preset 集合，并为 `builtin-book-mindmap` 增加独立成功文案、失败文案和无书提示。
- `POST /api/notebooks/:id/report/generate` 在 `builtin-book-mindmap` 分支执行：
  1. 仅基于当前启用书籍来源向 NotebookLM 请求结构化摘要
  2. 调用 OpenAI-compatible 模型把摘要转换成 JSON 树
  3. 校验/清洗 JSON 结构
  4. 先把摘要 Markdown 写入 `data/files/report-*.md`
  5. JSON 树可用时，把 `content_json` 和 `preset_id` 一起写入 `report_entries`
  6. JSON 树不可用时，仍保留 `preset_id = builtin-book-mindmap` 的 Markdown 阅读产出，并返回明确降级提示
- OpenAI-compatible 配置缺失、模型转换失败或 JSON 不合法时，不得落“只有标题、没有正文”的空壳导图；但只要结构化摘要已经拿到，就应保留 Markdown 回退产出，而不是把整条阅读链路一起掐死。

### 2. 服务端结构校验策略

- 新增一个轻量服务模块负责“摘要转 JSON 树 + 结构校验”，不要把一大坨字符串解析逻辑继续塞进已经 1500 多行的路由文件里。
- 校验规则以“最小可渲染”为准：
  - 根节点必须存在
  - `label` 去空白后不能为空
  - 超过最大深度的节点直接裁剪
  - 非数组 `children` 按空数组处理
  - 过长 `label` / `note` 做截断，避免前端卡片直接爆版
- 清洗后如果根节点仍然不可用，直接抛错，不写 DB。

### 3. 前端动作与信息架构

- `BookActionsPanel.vue` 在 `书籍简述`、`详细解读` 下新增第三个按钮 `书籍导图`。
- `BookWorkbenchView.vue` 新增 `generatingMindmap` 状态、按钮回调和成功失败 toast。
- 中栏标签和相关空态文案从 `书籍总结` 收口为 `阅读产出`，因为现在这里已经不只是 Markdown 摘要。再死守旧名字，只会让界面自己打自己脸。
- 右栏历史版本继续沿时间排序，但允许 `builtin-book-mindmap` 与另外两个 preset 并列出现。

### 4. 前端导图渲染

- 新增本地递归组件，例如 `BookMindmapTree.vue`，只负责把 JSON 树渲染成带连接线的层级卡片，不引第三方图形依赖。
- 视觉方向继续遵守当前书页/档案页风格：暖纸底、墨色字、小圆角、细边框，用版心和连线建立结构，不做 SaaS 控制台味的节点框墙。
- 桌面端优先展示“根节点 + 分支列”式树形阅读；移动端自动退化为单列缩进树，保证可读性优先于花哨布局。
- `ReportDetailPanel.vue` 对 `research_report + presetId === builtin-book-mindmap` 做专门分支：
  - `contentJson.kind === book_mindmap` 时渲染 JSON 树
  - JSON 丢失或不合法时，回退显示已保存的 Markdown 摘要
  - 不要把导图条目误当成普通 Markdown 直接渲染，那样和没做功能没区别

### 5. 复用与兼容边界

- 继续复用 `generateBookSummary()` 这一层轻量 API 封装，只扩展 preset union，不因为多一个 preset 就重写一套客户端调用层。
- `report_entries` 和 `/entries` 保持现有接口形状，不新增 `/mindmap/*` 私有接口。
- 旧的 `书籍简述`、`详细解读` 渲染逻辑不变；只有 `builtin-book-mindmap` 走专门详情视图。

## 涉及文件或模块

- `docs/superpowers/specs/2026-04-15-读书工作台JSON思维导图生成与渲染-设计-已完成.md`
- `server/src/db/index.ts`
- `server/src/db/report-entries.ts`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`
- `server/src/db/init.test.ts`
- `server/src/book-mindmap/service.ts`
- `server/src/book-mindmap/service.test.ts`
- `client/src/api/book-summary.ts`
- `client/src/api/book-summary.test.ts`
- `client/src/components/book-workbench/book-actions.ts`
- `client/src/components/book-workbench/book-actions.test.ts`
- `client/src/components/book-workbench/book-center.ts`
- `client/src/components/book-workbench/book-center.test.ts`
- `client/src/components/book-workbench/BookActionsPanel.vue`
- `client/src/components/book-workbench/BookSummaryPanel.vue`
- `client/src/components/book-workbench/BookMindmapTree.vue`
- `client/src/components/notebook-workbench/ReportDetailPanel.vue`
- `client/src/views/BookWorkbenchView.vue`

## 验证方式与成功标准

- `/book` 右栏出现 `书籍导图` 按钮，并且没有书时会给出对应提示
- 生成 `书籍导图` 后，接口返回 `书籍导图已生成`
- `report_entries` 中新增的导图条目仍是 `research_report`，且 `preset_id = builtin-book-mindmap`
- 导图条目拥有可读取的 `content_json.kind = book_mindmap`，并同时保留结构化摘要 Markdown 文件
- `/book` 中栏切到对应条目时，默认展示 JSON 树而不是原始 Markdown
- JSON 缺失或损坏时，界面能回退到 Markdown 摘要，不会白屏；后端若发生降级，前端 toast 也要显示真实降级提示，而不是硬说“书籍导图已生成”
- 相关服务端与前端测试通过

## 实施任务

> 该清单只服务当前任务文档。

### 步骤 1：后端导图生成链路

**文件：** 修改 `server/src/db/index.ts`、`server/src/db/report-entries.ts`、`server/src/routes/notebooks/index.ts`、`server/src/routes/notebooks/index.test.ts`，创建 `server/src/book-mindmap/service.ts`、`server/src/book-mindmap/service.test.ts`

**意图：** 让 `builtin-book-mindmap` 可以走“NotebookLM 摘要 -> OpenAI JSON 树 -> report_entries 持久化”的完整后端路径，并对坏结构做硬校验。

- [ ] 先写失败测试，覆盖 preset seed、成功文案、无书提示、内容持久化与 JSON 校验失败
- [ ] 运行相关测试并确认失败
- [ ] 编写最小实现
- [ ] 运行相关测试并确认通过

### 步骤 2：前端动作与导图详情渲染

**文件：** 修改 `client/src/api/book-summary.ts`、`client/src/api/book-summary.test.ts`、`client/src/components/book-workbench/book-actions.ts`、`client/src/components/book-workbench/book-actions.test.ts`、`client/src/components/book-workbench/book-center.ts`、`client/src/components/book-workbench/book-center.test.ts`、`client/src/components/book-workbench/BookActionsPanel.vue`、`client/src/components/book-workbench/BookSummaryPanel.vue`、`client/src/components/notebook-workbench/ReportDetailPanel.vue`、`client/src/views/BookWorkbenchView.vue`，创建 `client/src/components/book-workbench/BookMindmapTree.vue`

**意图：** 在 `/book` 中增加 `书籍导图` 入口，把中栏从纯 Markdown 阅读区升级为能区分导图与摘要的阅读产出区。

- [ ] 先写失败测试，覆盖新按钮、新 preset、历史筛选与导图详情分支
- [ ] 运行相关测试并确认失败
- [ ] 编写最小实现
- [ ] 运行相关测试并确认通过

### 步骤 3：集成验证

**文件：** 验证上述改动，不新增实现文件

**意图：** 确认这次不是“测试勉强过了，页面一开就散架”的伪完成。

- [ ] 运行目标测试集合
- [ ] 运行 `client` 构建
- [ ] 若验证通过，更新本文档中的执行元数据

## 现成方案探索结论

- **推荐：本地 JSON 树组件**。最贴合当前需求，数据可控、样式可控、依赖最小。
- **次选：`markmap-view`**。包仍在维护，适合“Markdown 层级转图”，但当前我们已经决定上游产物是 JSON，不是层级 Markdown，它会变成多余的一层转换。
- **淘汰：MindElixir 一类完整脑图库**。不是不能用，是现在不值。你只是要在 `/book` 里把只读导图展示出来，不是要现场造一个协同脑图编辑器。
- **淘汰：`d3-hierarchy` 直接开做完整布局引擎**。它是好底座，但对当前需求太底层。第一版先把树渲染做对，不要一上来就把自己送进坐标布局和交互细节地狱。

## 自审结果

- 这是单个可执行任务，没有硬拆成总览 + 多任务文档，避免文档数量比代码还多。
- 路线已经明确选择“NotebookLM 结构摘要 + OpenAI 转 JSON + 本地树渲染”，没有继续在 Mermaid 和原生 artifact 之间摇摆。
- 规格已同步更新为真实降级语义：JSON 生成失败时保留 Markdown 阅读产出，而不是把整条链路一并判死。
