# 读书工作台对话收口与总结全屏设计

**当前状态：** 已完成
**任务组标识：** 2026-04-14-读书工作台对话收口与总结全屏
**对应工作区：** .worktrees/2026-04-14-读书工作台对话收口与总结全屏-设计/
**工作区状态：** 未创建
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`/book/:id` 不再把“自动研究”当成单书阅读页的主流程，而是收口成“上传书籍后直接对话、直接快速读书、直接查看总结”的工作台。中栏标签顺序调整为 `对话 / 书籍总结 / 快速找书`；右栏移除自动研究区，只保留快速读书入口；书籍总结改为全宽阅读视图，不再把一半宽度浪费在固定侧栏上；快速读书生成不再依赖先跑出自动研究问答历史。

## 背景判断

- 当前 `/book` 页的第一屏心智仍然绑在“自动研究”上，但用户现在要的是单书阅读和单书问答，这条旧主线已经喧宾夺主。
- 中栏标题还是“课题研究历史”，实际却承载一本书的使用过程，这个命名本身就跑偏了。
- `书籍总结` 当前采用“左侧历史列表 + 右侧详情”的拆分，详情宽度太窄，读长文时像在邮票上看 Markdown，纯属给自己找罪受。
- `快速读书` 仍被前端和后端历史资产判断拦着，结果就是书已经上传好了，按钮还在装矜持，这套门槛没有业务价值。

## 范围边界

本次实现：

- 中栏首个标签从 `课题研究历史` 改为 `对话`
- 中栏标签顺序改为 `对话 / 书籍总结 / 快速找书`
- `对话` 标签改为可发送消息的真实聊天面板
- `书籍总结` 详情改为全宽阅读，不再保留固定左侧历史栏
- 右栏移除自动研究状态、启停按钮和相关提示，只保留快速读书操作
- 快速读书按钮改为“有书即可触发”，不再依赖自动研究历史
- 后端 `builtin-quick-read` 生成链路改为允许在无历史问答时直接执行
- Book 页读取的聊天记录改为普通手动对话，不混入自动研究历史

本次不实现：

- 不删除后端自动研究能力本身，只是不再在 `/book` 页继续接线
- 不重做整套工作台壳层布局
- 不改动快速找书的检索逻辑
- 不新增复杂全屏模态；“全屏展示”以总结内容占满当前标签主体宽度为准

## 推荐实现

### 1. 中栏交互收口

- `book-center.ts` 直接输出 `对话 / 书籍总结 / 快速找书`
- Book 页不再加载研究 SSE，也不再维护自动研究状态
- 新的 `对话` 面板继续沿用纸页气质，但提供输入框、发送按钮和普通聊天消息滚动区

### 2. 聊天数据边界

- 服务端保留 `GET /api/notebooks/:id/messages` 的现有语义，继续给旧页面读取 `manual + research`
- `GET /api/notebooks/:id/chat/messages` 改为只返回 `manual`，供 `/book` 页读取真实对话
- `/book` 页发送消息继续走 `POST /api/notebooks/:id/chat/messages`

### 3. 快速读书入口

- 右栏保留为简化后的 `BookActionsPanel.vue`
- 面板内只保留 `快速读书` 按钮和必要提示
- 按钮可用条件收口为“当前有书且当前没有生成中的请求”
- 服务端 `POST /api/notebooks/:id/report/generate` 在 `presetId === builtin-quick-read` 时不再要求已有聊天历史；普通研究报告保持原门槛不变

### 4. 书籍总结全宽阅读

- `BookSummaryPanel.vue` 改为纵向结构：顶部轻量版本选择区，下面是全宽 `ReportDetailPanel`
- 若存在多份总结，用原生下拉或轻量按钮切换版本；不再固定占用一列展示列表
- 空状态文案同步改为从当前标签内直接生成或切换

## 涉及文件或模块

- `docs/superpowers/specs/2026-04-14-读书工作台对话收口与总结全屏-设计-进行中.md`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/components/book-workbench/book-center.ts`
- `client/src/components/book-workbench/book-center.test.ts`
- `client/src/components/book-workbench/ResearchHistoryPanel.vue`
- `client/src/components/book-workbench/BookActionsPanel.vue`
- `client/src/components/book-workbench/book-view-state.ts`
- `client/src/components/book-workbench/book-view-state.test.ts`
- `client/src/components/book-workbench/BookSummaryPanel.vue`
- `client/src/components/book-workbench/book-layout.ts`
- `client/src/components/book-workbench/book-layout.test.ts`
- `client/src/api/notebooks.ts`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`
- 视需要补充 `book-workbench-view.test.ts`

## 验证方式与成功标准

- `/book/:id` 中栏标签顺序为 `对话 / 书籍总结 / 快速找书`
- 中栏首个标签可发送消息，且只展示普通手动对话，不展示自动研究历史
- 右栏不再出现 `自动研究`、`开始自动研究`、`停止自动研究` 等文案
- 上传书籍后，不需要研究历史即可点击 `快速读书`
- `builtin-quick-read` 在无聊天历史但有书籍来源时可成功生成总结
- `书籍总结` 标签中的详情内容占满标签主体宽度，不再使用固定左侧历史栏

## 自审结果

- 这是单任务收口，不需要拆成总览文档和任务文档
- 已明确“全屏展示”在本轮实现中指总结内容占满标签主体宽度，而不是新增浏览器级全屏模式
- 已明确保留后端自动研究能力但移除 Book 页接线，避免把范围扩成无关后端清理
- 已明确普通聊天与自动研究历史的数据边界，避免“换个标题继续混读旧消息”的伪改造
