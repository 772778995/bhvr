# 读书工作台阅读操作提示词与导图收口设计

**当前状态：** 已完成
**任务组标识：** 2026-04-15-读书工作台阅读操作提示词与导图收口
**对应工作区：** .worktrees/2026-04-15-读书工作台阅读操作提示词与导图收口-设计/
**工作区状态：** 已回收
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`/book` 右栏的 `书籍简述` 与 `详细解读` 不再只是两个硬编码按钮，而是各自带一个紧邻右侧的设置入口，用来直接编辑对应内置 preset 的输出提示词；这些配置必须真正持久化，不能做成“改完一重启就失忆”的伪功能。与此同时，`/book` 生成出的阅读产出标题统一以功能语义为准：`书籍简述`、`详细解读`、`书籍导图`，不再被模型第一行 Markdown 标题劫持。至于书籍导图，后端其实已经存在“结构化摘要 -> JSON 树 -> 前端树渲染”的链路，当前问题不是完全没做，而是降级为 Markdown 时缺少足够明确的界面提示，导致体验看起来像只生成了结构化摘要。

## 已完成范围

- 在 `/book` 的 `书籍简述`、`详细解读` 按钮右侧新增设置 icon
- 点击设置 icon 后，打开当前动作专属的轻量提示词编辑弹层
- 弹层直接读取并更新对应 built-in preset：`builtin-quick-read`、`builtin-deep-reading`
- 调整 built-in preset 初始化策略，保证用户修改的 prompt 不会在服务重启时被默认值覆盖
- `/api/notebooks/:id/report/generate` 对书籍专用 preset 使用固定功能标题，历史版本与功能名一致
- 书籍导图详情在 `contentJson.kind !== book_mindmap` 时明确展示“当前为 Markdown 回退阅读，不是 JSON 导图”的提示

## 验证摘要

- `node --import tsx --test src/api/book-summary.test.ts src/components/book-workbench/book-actions.test.ts src/views/book-workbench-view.test.ts`
- `node --import tsx --test src/book-mindmap/service.test.ts src/db/init.test.ts src/routes/notebooks/index.test.ts --test-name-pattern "book mindmap|builtin|fixed titles|keeps user-updated"`
- `npm run build --workspace client`
- `npm run build --workspace server`

## 自审结果

- 已明确复用现有 preset API，而不是为了两个按钮再造一套 book-only 配置接口。
- 已把真正的风险点写清楚：built-in prompt 覆盖策略、标题语义漂移、导图 Markdown 降级缺少显式提示。
- 实现已合入 `book-app`，对应 worktree 已完成回收。
