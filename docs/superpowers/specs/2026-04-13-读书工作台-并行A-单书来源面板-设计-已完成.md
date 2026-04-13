# 读书工作台并行A-单书来源面板设计

**当前状态：** 已完成

## 设计结论

`/book/:id` 左侧面板必须从“通用来源管理”收缩成“单书上传与状态展示”。它不是旧 `SourcesPanel` 改个标题就完事，而是语义彻底变成单 PDF 书籍入口。

## 依赖关系

- 依赖 `前置A-路由入口与共享壳层`
- 依赖 `前置B-PDF转文本上传接口` 的接口形态
- 可与 `并行B-右侧读书工具面板与快速读书` 并行开发

## 目标

1. 左侧只展示一本书
2. 上传入口只接受 PDF
3. 提供空态、处理中、就绪、失败四种状态
4. 已有书籍时禁用继续上传，并提供删除或替换入口

## 组件建议

- `client/src/components/book-workbench/BookSourcePanel.vue`
- `client/src/components/book-workbench/UploadBookDialog.vue`

必要时在 `client/src/views/BookWorkbenchView.vue` 内做最小状态编排。

## UI 约束

- 标题从“来源”改成“书籍”或“当前书籍”
- 不再显示网页、文本、Drive、YouTube 等类型入口
- 标签统一显示为 `PDF`
- 文案要明确这是“单书模式”

## 数据规则

- 允许 0 或 1 本书
- 若接口底层返回的 source type 是 `text`，前端仍按 `PDF 上传书籍` 语义展示
- 标题优先使用 PDF 文件名

## 不在本任务做的事

- 不处理底层多来源历史数据兼容，那是 `收口A` 的事
- 不处理右侧读书工具面板
- 不实现快速读书和快速找书逻辑

## 推荐文件边界

- `client/src/components/book-workbench/BookSourcePanel.vue`
- `client/src/components/book-workbench/UploadBookDialog.vue`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/api/notebooks.ts`
- 与该面板直接相关的测试文件

## 验证

1. 空态下只能选择 PDF 上传
2. 上传中显示流式进度或处理中状态
3. 上传完成后只展示单本书条目
4. 已有书时不能继续叠加第二本
5. 删除后可重新上传

## 自审结果

- 已把左侧单书语义与后端上传链路解耦为清晰边界
- 文件改动面主要集中在 book 侧组件，适合单独 worktree
