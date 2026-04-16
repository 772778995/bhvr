# 读书工作台残留清理与测试命名收口设计

**当前状态：** 已完成
**任务组标识：** 2026-04-14-读书工作台残留清理与测试命名收口
**对应工作区：** .worktrees/2026-04-14-读书工作台残留清理与测试命名收口-设计/
**工作区状态：** 未创建
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`/book` 页已经从“自动研究壳”收口为单书对话工作台后，继续留着未接线的旧面板、没人用的历史判断 helper 和名不副实的测试文件，只会让后续维护者误判当前架构。此次只做最小前端清理：删除已彻底断线的组件与废弃 helper，修正测试命名，让代码结构和真实行为重新对齐。

## 背景判断

- `ResearchHistoryPanel.vue` 已被 `ChatPanel.vue` 替代，但文件还留在 `book-workbench` 目录里，等于用尸体占坑。
- `BookSummaryListPanel.vue` 已被 `BookSummaryPanel.vue` 顶部版本切换取代，继续保留只会误导人以为书籍总结仍是左右分栏。
- `hasBookResearchHistory()` 与 `createStartingResearchState()` 已不再参与 `/book` 的现行逻辑，只剩测试在给它们续命。
- `research-history-panel.test.ts` 现在实际测试的是 `ChatPanel.vue`，文件名和内容对不上，属于看一眼就让人怀疑人生的低级噪音。

## 范围边界

本次实现：

- 删除 `/book` 已不再引用的旧面板组件
- 删除仅剩测试引用的废弃 helper 与对应测试
- 将 `research-history-panel.test.ts` 更名为能反映真实测试对象的文件名
- 保持 `/book` 当前行为、样式和接口不变

本次不实现：

- 不调整 `/book` 的交互或视觉表现
- 不触碰 `book-finder`、数据库、服务端路由相关改动
- 不做跨目录的大规模重构或通用抽象整理

## 推荐实现

### 1. 删除断线组件

- 移除 `client/src/components/book-workbench/ResearchHistoryPanel.vue`
- 移除 `client/src/components/book-workbench/BookSummaryListPanel.vue`
- 保留 `book-summary-list.ts`，因为下载按钮样式与下载逻辑仍由现有测试覆盖；只删真正断线的视图层。

### 2. 删除废弃 helper

- 从 `client/src/components/book-workbench/book-view-state.ts` 中移除 `hasBookResearchHistory()`
- 从 `client/src/views/book-workbench-view.ts` 中移除 `createStartingResearchState()` 及相关常量
- 同步删掉只为这些废弃函数存在的测试用例

### 3. 测试命名收口

- 将 `client/src/components/book-workbench/research-history-panel.test.ts` 改名为 `chat-panel.test.ts`
- 保留原有断言内容，继续约束 `ChatPanel.vue` 的对话气泡和输入区行为

## 涉及文件或模块

- `docs/superpowers/specs/2026-04-14-读书工作台残留清理与测试命名收口-设计-已完成.md`
- `client/src/components/book-workbench/ResearchHistoryPanel.vue`
- `client/src/components/book-workbench/BookSummaryListPanel.vue`
- `client/src/components/book-workbench/book-view-state.ts`
- `client/src/components/book-workbench/book-view-state.test.ts`
- `client/src/components/book-workbench/chat-panel.test.ts`
- `client/src/views/book-workbench-view.ts`
- `client/src/views/book-workbench-view.test.ts`

## 验证方式与成功标准

- `book-workbench` 目录内不再保留 `/book` 已断线的旧面板组件
- `book-view-state.ts` 只保留当前仍在使用的 `canGenerateBookSummary()`
- `book-workbench-view.ts` 不再暴露未接线的研究状态 helper
- `ChatPanel.vue` 的测试文件名与真实测试对象一致
- 相关前端测试仍全部通过

## 自审结果

- 范围已明确限定在 `/book` 前端残留，不会误伤当前分支里其它进行中的 `book-finder` / DB 工作
- 删除对象都已确认无生产引用，不是拍脑袋式“看着像没用”
- 测试命名收口单独写清，避免把“删文件”和“行为调整”混成一坨
