# 快速找书独立标签页收口设计

**当前状态：** 已完成
**任务组标识：** 2026-04-13-快速找书独立标签页收口
**对应工作区：** .worktrees/2026-04-13-快速找书独立标签页收口-设计/
**工作区状态：** 未创建
**执行阶段：** 实现中
**当前负责会话：** 无

## 设计结论

中栏应新增独立的 `快速找书` 标签页，而不是继续把它塞进 `课题研究历史` 的条件分支里。`历史`、`快速找书`、`书籍总结` 是三种不同的信息任务，混在一个面板里只会让状态越来越乱。

## 背景判断

- 当前中栏标签来源于 `book-center.ts`，只支持 `history` 和可选的 `summary`
- 现有 `快速找书` 已通过 `finderMode` 挂在 `ResearchHistoryPanel` 内部
- 这种做法短期能跑，长期会把“研究历史展示”和“主动查询找书”搅在一起

## 范围边界

本次只做中栏结构收口：

- 新增 `快速找书` 标签页
- 将快速找书输入与结果展示从 `ResearchHistoryPanel` 中拆出来
- 保持现有 `快速找书` API 与服务端逻辑不变
- 维持现有纸页式视觉和标签切换动效

本次不做：

- 不重写后端快速找书逻辑
- 不引入新的弹窗、抽屉或独立路由
- 不改动 `书籍总结` 数据流

## 推荐方案

### 标签结构

中栏标签调整为：

- `课题研究历史`
- `快速找书`
- `书籍总结`（仅在有总结时出现）

### 组件边界

- `ResearchHistoryPanel` 只负责显示研究历史消息
- 新增 `BookFinderPanel`，专门承接：
  - 固定引导语
  - 输入框
  - 发送按钮
  - 找书结果消息流
- `BookWorkbenchView` 负责切换当前中栏标签与共享消息状态

### 入口行为

- 左侧和右侧 `快速找书` 按钮点击后，直接切换到 `快速找书` 标签页
- 不再通过 `finderMode` 改写 `历史` 面板行为

## 涉及文件或模块

- `client/src/components/book-workbench/book-center.ts`
- `client/src/components/book-workbench/book-center.test.ts`
- `client/src/components/book-workbench/ResearchHistoryPanel.vue`
- `client/src/components/book-workbench/BookFinderPanel.vue`（新增）
- `client/src/views/BookWorkbenchView.vue`

## 验证方式与成功标准

- 无总结时，中栏显示两个标签：`课题研究历史`、`快速找书`
- 有总结时，中栏显示三个标签，并保持 `书籍总结` 的原有显示逻辑
- 点击左右侧 `快速找书` 入口后，中栏切到 `快速找书`
- `ResearchHistoryPanel` 不再承载快速找书输入逻辑

## 实施任务

### 步骤 1：先补失败测试

**文件：** 修改 `client/src/components/book-workbench/book-center.test.ts`

**意图：** 先锁住标签结构，避免改完 UI 才发现行为边界没定义清楚。

- [ ] 为无总结/有总结的标签数组写失败测试
- [ ] 为快速找书标签键值写失败测试

### 步骤 2：拆出独立标签页组件

**文件：** 新增 `client/src/components/book-workbench/BookFinderPanel.vue`

**意图：** 让快速找书有独立承载面板，不再污染研究历史组件。

- [ ] 复用现有引导语、输入与消息展示模式
- [ ] 保持书页式排版与现有配色一致

### 步骤 3：接回中栏切换

**文件：** 修改 `client/src/views/BookWorkbenchView.vue`

**意图：** 用显式标签状态替代 `finderMode` 分支。

- [ ] 按钮入口改为切到 `book-finder` 标签
- [ ] 中栏切换改为 `history / book-finder / summary`

## 自审结果

- 已明确这是单任务收口，不需要额外拆批次
- 已明确保留现有服务端能力，只调整前端结构
- 已明确 `ResearchHistoryPanel` 与 `BookFinderPanel` 的职责边界
