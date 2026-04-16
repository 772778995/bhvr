# 书籍简述提示词收口设计

**当前状态：** 已完成
**任务组标识：** 2026-04-14-读书工作台简述与导图
**所属总览：** docs/superpowers/specs/2026-04-14-读书工作台简述与导图-总览-设计-已完成.md
**所属批次：** 批次01
**前置任务：** 无
**并行开发：** 可与同批次任务并行（当前批次仅此任务）
**对应工作区：** .worktrees/2026-04-14-读书工作台简述与导图-批次01-任务01-书籍简述提示词收口-设计/
**工作区状态：** 已创建
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

这次不改接口，不改数据结构，只收口现有短版与长版总结的用户可见契约：短版入口改名为`书籍简述`，并切换到 300 字内的精简提示；长版`详细解读`保留入口，但提示词改成用户给定的 5000 字内结构化深度解读。所有前后端可见标题、说明、错误文案和测试断言要一起同步，不留下“按钮换了，结果标题还是旧词”的残渣。

## 范围边界

本次实现：

- `/book` 页面把原`快速读书`按钮文案改成`书籍简述`
- 保持 `builtin-quick-read` 与 `builtin-deep-reading` 两个 preset ID 不变
- 更新 `builtin-quick-read` 的名称、描述和提示词，使其对应 300 字内的`书籍简述`
- 更新 `builtin-deep-reading` 的提示词，使其对应用户给定的结构化长版`详细解读`
- 同步调整短版相关的 Toast、fallback 标题、缺书报错和示例占位文案
- 更新相关前后端测试

本次不实现：

- 不新增第三个 preset 或新的生成接口
- 不改动总结列表排序和选择逻辑
- 不在本轮实现思维导图按钮、接口或渲染器

## 涉及文件或模块

- `docs/superpowers/specs/2026-04-14-读书工作台简述与导图-总览-设计-已完成.md`
- `docs/superpowers/specs/2026-04-14-读书工作台简述与导图-批次01-任务01-书籍简述提示词收口-设计-已完成.md`
- `client/src/components/book-workbench/BookActionsPanel.vue`
- `client/src/components/book-workbench/book-actions.ts`
- `client/src/components/book-workbench/book-actions.test.ts`
- `client/src/api/book-summary.test.ts`
- `client/src/components/book-workbench/book-center.test.ts`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/components/PresetManagerDialog.vue`
- `server/src/db/index.ts`
- `server/src/db/init.test.ts`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`

## 验证方式与成功标准

- `/book` 右栏短版按钮显示为`书籍简述`
- 无书状态、Toast、生成结果 fallback 标题和相关示例文案不再出现`快速读书`
- `builtin-quick-read` 的提示词明确要求 300 字内输出核心观点、内容结构、关键案例与适用人群
- `builtin-deep-reading` 的提示词切到用户给定的 5000 字内结构化解读要求
- 相关前端测试与服务端测试通过

## 实施任务

> 该清单只服务当前任务文档。不要跨任务文档混写。

### 步骤 1：先让测试描述新契约

**文件：** 修改 `client/src/components/book-workbench/book-actions.test.ts`、`client/src/api/book-summary.test.ts`、`client/src/components/book-workbench/book-center.test.ts`、`server/src/db/init.test.ts`、`server/src/routes/notebooks/index.test.ts`

**意图：** 先把短版重命名和两套提示词的新要求写进测试，确保后续改动不是靠肉眼瞎对。

- [x] 编写失败的测试
- [x] 运行验证失败

### 步骤 2：最小实现同步前后端文案与提示词

**文件：** 修改 `client/src/components/book-workbench/BookActionsPanel.vue`、`client/src/components/book-workbench/book-actions.ts`、`client/src/views/BookWorkbenchView.vue`、`client/src/components/PresetManagerDialog.vue`、`server/src/db/index.ts`、`server/src/routes/notebooks/index.ts`

**意图：** 在不改接口的前提下同步所有用户可见文案与内置 preset 内容。

- [x] 编写最小实现
- [x] 运行验证通过

### 步骤 3：收尾并确认没有旧词残留

**文件：** 全量检查本任务涉及文件

**意图：** 防止 UI 改成了`书籍简述`，服务端标题和报错还在喊`快速读书`。

- [x] 检查残留文案
- [x] 更新规格状态

## 自审结果

- 已明确这是“文案与提示词契约收口”，不是新功能开发，因此保持接口和 preset ID 稳定。
- 已把所有需要同步的用户可见表面列出来，避免只改按钮不改后端标题这种低级漏项。
- 已通过目标测试验证短版文案、长版 prompt、数据库 seed 刷新与 `/report/generate` 的相关路径。
