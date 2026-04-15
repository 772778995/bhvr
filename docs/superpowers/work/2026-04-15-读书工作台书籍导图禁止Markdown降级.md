# 读书工作台书籍导图禁止Markdown降级

**任务组标识：** 2026-04-15-读书工作台书籍导图禁止Markdown降级
**对应工作区：** .worktrees/2026-04-15-读书工作台书籍导图禁止Markdown降级/
**工作区状态：** 已创建
**执行阶段：** 已完成
**当前负责会话：** 当前会话

## 设计结论

`builtin-book-mindmap` 不再允许“JSON 导图失败时回退为 Markdown 阅读产出”。只要导图 JSON 转换失败、配置缺失或结构校验不过，`POST /api/notebooks/:id/report/generate` 就直接返回失败，不写入任何 `builtin-book-mindmap` 阅读条目，也不再给前端留一个看起来像半成品的摘要回退结果。用户要的是思维导图，不是一个叫导图却不是导图的替身。

## 背景判断

- 现有实现把 `builtin-book-mindmap` 做成“成功最好，失败也给你一篇 Markdown 摘要”，这套兜底逻辑表面体贴，实际是在污染产品语义。入口名叫书籍导图，产出却可能不是导图，这不叫降级，这叫糊弄。
- 前端已经不得不加提示去解释“这次没有 JSON，但你还能看摘要”，说明回退本身就在制造认知负担。一个功能要靠大段免责声明证明自己不是坏的，基本已经输麻了。
- 服务端当前在 `server/src/routes/notebooks/index.ts` 里捕获 `buildBookMindmapFromSummary()` 的异常后继续落库并返回成功文案，这正是需要砍掉的行为根源。
- 你已经明确要求“无法正常输出思维导图直接报错”，那就没必要继续保留“也许用户愿意先看摘要”的自作主张。产品决策已经给了，剩下就是老老实实执行。

## 范围边界

本次实现：

- `builtin-book-mindmap` 在 JSON 转换失败、配置缺失或校验失败时直接返回错误
- 导图失败时不再写入 Markdown 回退条目
- 前端不再展示导图专属 Markdown 回退提示文案，也不再为 mindmap report 加载或渲染 Markdown 内容
- 更新相关前后端测试，覆盖“成功生成 JSON 导图”和“失败直接报错、不落条目”两条路径

本次不实现：

- 不调整 `书籍简述`、`详细解读` 的行为
- 不修改 `BookMindmapTree` 的渲染细节
- 不新增额外重试机制、任务队列或后台补偿逻辑
- 不把 Markdown 摘要另存为别的条目类型

## 推荐实现

### 1. 后端：导图失败直接中止

- `server/src/routes/notebooks/index.ts` 中 `rawPresetId === "builtin-book-mindmap"` 的分支不再吞掉 `buildBookMindmapFromSummary()` 的错误后继续执行。
- 最小正确改法是：
  - JSON 转换成功：照旧写入 `content_json` 并返回成功
  - JSON 转换失败：直接返回 502/500 级错误，消息明确说明“书籍导图生成失败”或“导图转换失败”
- 导图失败时不得落 `report_entries`，否则历史里仍会留下假的导图条目。

### 2. 前端：去掉导图回退叙事

- `ReportDetailPanel.vue` 中 `showBookMindmapMarkdownFallbackNotice` 这条导图专属回退分支应该删除。
- 对 `builtin-book-mindmap` 来说，详情页只应该处理两种状态：
  - 有合法 `book_mindmap` JSON：渲染树
  - 没有该 JSON：按普通空内容/失败行为处理，而不是继续演“先看摘要”
- mindmap report 不应再触发 Markdown 内容获取，也不应落回通用 Markdown 渲染分支。

### 3. 测试：明确卡住“不准回退”

- 服务端测试至少要覆盖：
  - mindmap JSON 成功时照旧落条目
  - mindmap JSON 失败时接口返回失败，且 `report_entries` 中没有新增 `builtin-book-mindmap` 条目
- 前端测试至少要覆盖：
  - `ReportDetailPanel.vue` 不再保留导图 Markdown 回退提示文案
  - mindmap report 不再 fetch/render Markdown fallback
  - mindmap 入口、JSON 渲染分支仍保留

## 涉及文件或模块

- `docs/superpowers/work/2026-04-15-读书工作台书籍导图禁止Markdown降级.md`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`
- `client/src/components/notebook-workbench/ReportDetailPanel.vue`
- `client/src/components/notebook-workbench/report-detail-content.ts`
- `client/src/components/notebook-workbench/report-detail-content.test.ts`
- `client/src/views/book-workbench-view.test.ts`

## 验证方式与成功标准

- `builtin-book-mindmap` 成功时仍可生成并展示 JSON 导图
- `builtin-book-mindmap` 失败时接口直接返回失败，而不是成功生成 Markdown 回退条目
- 导图失败后，历史列表中不会多出一条假的“书籍导图”阅读产出
- 前端代码中不再保留导图 Markdown 回退提示分支，也不会对 mindmap report 加载或渲染 Markdown fallback

## 实施任务

### 步骤 1：先补失败测试

**文件：** 修改 `server/src/routes/notebooks/index.test.ts`、`client/src/views/book-workbench-view.test.ts`

**意图：** 先把“不准降级”钉死，免得后面又被“先给用户点东西看”这种伪善逻辑带偏。

- [x] 为导图失败直接报错且不落条目补失败测试
- [x] 为前端移除导图 Markdown 回退分支补失败测试
- [x] 运行目标测试并确认按预期失败

### 步骤 2：最小实现

**文件：** 修改 `server/src/routes/notebooks/index.ts`、`client/src/components/notebook-workbench/ReportDetailPanel.vue`

**意图：** 删除回退路径，让书籍导图只在真能产出 JSON 时才算成功。

- [x] 移除服务端 mindmap Markdown 回退逻辑
- [x] 移除前端导图 Markdown 回退提示分支
- [x] 阻止前端对 mindmap report 加载或渲染 Markdown fallback
- [x] 运行目标测试并确认通过

### 步骤 3：集成验证

**文件：** 不新增实现文件

**意图：** 确认这次真的把“失败直接报错”落到了运行结果里，而不是只改了文案。

- [x] 运行相关服务端与前端测试
- [x] 如有必要运行构建

## 自审结果

- 这是单任务改动，边界集中在 `builtin-book-mindmap` 的失败语义，没有必要拆多任务。
- 行为取舍已明确：宁可失败，也不再产出冒牌 Markdown 导图。
- 当前实现不仅移除了专属提示文案，也封死了 mindmap report 继续 fetch/render Markdown 的暗门，避免前端继续偷偷降级。
