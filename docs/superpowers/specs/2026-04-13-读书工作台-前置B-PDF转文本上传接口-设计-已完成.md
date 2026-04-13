# 读书工作台前置B-PDF转文本上传接口设计

**当前状态：** 已完成

## 设计结论

读书页上传 PDF 后，服务端必须先提取文本，再调用 `addSourceFromText()` 交给 NotebookLM。不要继续沿用通用 `addSourceFromFile()`，不然“单书阅读工作台”表面变了，底层还是老来源模型的旧账。

## 这是前置任务的原因

- 左侧单书面板最终要接的是真实 API，不是空壳按钮
- 如果没有这条接口，前端的上传交互只能先写死 mock 或临时分叉
- 这条链路还定义了后续单书模式怎么识别来源与展示状态

## 可并行关系

- 可与 `前置A-路由入口与共享壳层` 并行开发
- 被 `并行A-单书来源面板` 依赖
- `收口A` 也依赖这条链路稳定后再做异常处理

## 目标

1. 新增 book 专用 SSE 上传接口
2. 只接受 PDF
3. 解析 PDF 为纯文本
4. 以文本来源方式提交到 NotebookLM
5. 沿用现有处理轮询与流式进度

## 推荐接口

- `POST /api/notebooks/:id/book-source/stream/upload-pdf`

不建议再造 `/api/books/...` 顶层资源，没必要把 notebook 体系切碎。

## 服务端流程

1. 校验 `notebookId`
2. 解析 multipart form data
3. 校验文件存在且是 PDF
4. 若当前 notebook 已有活动书籍来源，拒绝上传或要求先删除
5. 调用独立 PDF 文本提取模块
6. 清洗文本：去空白页、压缩异常空行、空文本报错
7. 调用 `addSourceFromText()`
8. 继续 `pollUntilReady()`
9. SSE 返回提交、处理中、完成或失败事件

## PDF 解析边界

本任务只覆盖：

- 普通文本型 PDF
- 提取后的纯文本清洗

本任务不覆盖：

- OCR
- 扫描件识别
- 表格/公式结构化
- 保真排版还原

## 推荐文件边界

- `server/src/routes/notebooks/index.ts`
- `server/src/notebooklm/client.ts`
- `server/src/pdf/extract-text.ts`
- `server/src/pdf/extract-text.test.ts`
- 对应路由测试文件

## 测试要求

1. 非 PDF 请求被拒绝
2. 空文本 PDF 返回错误
3. 成功路径调用 `addSourceFromText()` 而不是 `addSourceFromFile()`
4. SSE 输出完整进度事件
5. 轮询完成后来源状态可刷新为 ready / failed

## 自审结果

- 已把上传链路与页面 UI 拆开，方便后端单独 worktree 推进
- 已明确这是可并行前置，而不是收口阶段顺手补丁
