# 快速找书后端消息分轨设计

**当前状态：** 已完成
**任务组标识：** 2026-04-13-快速找书后端消息分轨
**对应工作区：** .worktrees/2026-04-13-快速找书后端消息分轨-设计/
**工作区状态：** 未创建
**执行阶段：** 实现中
**当前负责会话：** 无

## 设计结论

不新建消息表，直接把 `chat_messages.source` 从 `manual | research` 扩成 `manual | research | book_finder`。普通对话继续用 `manual`，自动研究继续用 `research`，快速找书单独落成 `book_finder`，读取时按来源过滤。

## 背景判断

- 当前前端已经通过视图层过滤避免了串台，但底层消息仍混存在同一来源里
- 快速找书和普通手动对话都写成 `manual`，这是串台根因
- 单表多来源已经是现有模式，继续沿用最省改动、最易维护

## 范围边界

本次只做消息分轨：

- `chat_messages.source` 扩展来源枚举
- 快速找书写库改为 `book_finder`
- 普通历史接口继续只返回 `manual + research`
- 新增快速找书专用消息读取接口，或在现有读取层按来源过滤

本次不做：

- 不拆消息表
- 不回填旧的 `manual` 历史数据
- 不修改研究流和报告流

## 推荐方案

### 1. 数据层

- `ChatMessageRecord.source` 扩为 `manual | research | book_finder`
- `countChatMessages` 与 `listChatMessages` 支持可选来源过滤

### 2. 写入策略

- `/api/notebooks/:id/chat/messages` 继续写 `manual`
- `/api/notebooks/:id/book-finder/search` 改写 `book_finder`

### 3. 读取策略

- 普通研究历史页读取 `manual + research`
- 快速找书页读取 `book_finder`
- 欢迎气泡仍然不入库，只在前端视图层拼接

## 涉及文件或模块

- `server/src/db/schema.ts`
- `server/src/db/index.ts`
- `server/src/db/chat-messages.ts`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`
- `client/src/api/notebooks.ts`
- `client/src/views/BookWorkbenchView.vue`

## 验证方式与成功标准

- 快速找书写入的消息在数据库层标记为 `book_finder`
- 普通研究历史接口不再返回快速找书消息
- 快速找书页读取时只拿到 `book_finder` 消息
- 现有普通对话与研究历史行为不回归

## 自审结果

- 已明确单表扩枚举比新表更合适
- 已明确本次不做旧数据迁移，避免范围失控
- 已明确前后端都需要按来源过滤，而不是只改一边
