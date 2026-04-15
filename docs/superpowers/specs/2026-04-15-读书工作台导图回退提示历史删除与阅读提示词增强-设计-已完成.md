# 读书工作台导图回退提示历史删除与阅读提示词增强设计

**当前状态：** 已完成
**任务组标识：** 2026-04-15-读书工作台导图回退提示历史删除与阅读提示词增强
**对应工作区：** .worktrees/2026-04-15-读书工作台导图回退提示历史删除与阅读提示词增强-设计/
**工作区状态：** 已回收
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

这轮 `/book` 收尾只做三件真有价值的事：把 `书籍导图` 的 Markdown 回退提示从“像报错说明书”改成用户能看懂的阅读状态提示；把右栏历史版本做成可直接删除的列表，而不是只能越积越多的陈列架；把 `书籍简述` 和 `详细解读` 两条内置 prompt 改写成更明确、更前置、更不容易被 NotebookLM 带偏的约束文本。不要再幻想靠 Markdown 加粗或伪 OpenAPI 语气就能提升服从度，那种操作基本属于对提示词工程许愿。

## 已实现范围

- `builtin-book-mindmap` 的 Markdown 回退提示已改成阅读型状态说明，明确当前展示的是这次导图流程保留下来的摘要回退内容
- `/book` 右栏历史版本项已增加删除 `x` 入口
- 删除操作复用现有 entry 删除 API 和确认弹窗
- 删除后会同步刷新历史列表，并在当前选中项被删时回退到最新剩余阅读产出
- `BUILTIN_QUICK_READ_PROMPT` 与 `BUILTIN_DEEP_READING_PROMPT` 已重写
- 旧数据库中未被用户改过的 legacy 内置 prompt 会在下次初始化时升级到新的默认约束
- `builtin-deep-reading` 的 preset 描述已与新的 prompt 语义对齐，不再继续宣传“延展阅读”

## 本次不实现

- 不改 `书籍导图` 的 JSON 生成链路和渲染组件
- 不新增批量删除、撤销删除或历史分组功能
- 不增加新的 preset 类型、版本控制或多份内置 prompt 模板
- 不改 `/book` 中栏整体布局，只调整必要文案和列表交互

## 验证方式与成功标准

- `书籍导图` 在 Markdown 回退时展示新的阅读型提示，而不是旧的生硬配置说明
- `/book` 右栏每条历史版本都出现独立删除入口，点击主体仍是选中条目，点击 `x` 只触发删除确认
- 删除阅读产出后，历史列表刷新，当前选中项状态正确回退
- `builtin-quick-read` 与 `builtin-deep-reading` 默认 prompt 包含更明确的来源约束、缺失信息处理和输出结构要求
- 旧数据库里仍保持 legacy 默认文案的内置 preset 会在初始化时升级为新文案；用户自己改过的 prompt 不会被覆盖

## 实施任务

### 步骤 1：先补失败测试

**文件：** 修改 `client/src/components/book-workbench/book-actions.test.ts`、`client/src/views/book-workbench-view.test.ts`、`server/src/db/init.test.ts`

**意图：** 先把这轮真正变化的行为钉死，免得后面 UI 改得很勤快，结果删除根本没接上、prompt 还是旧味儿。

- [x] 为历史版本删除入口与删除状态流补失败测试
- [x] 为导图回退提示文案变化补失败测试
- [x] 为两条内置 prompt 默认约束补失败测试
- [x] 为未改动 legacy 默认 prompt 的升级行为补失败测试
- [x] 运行目标测试并确认按预期失败

### 步骤 2：最小实现

**文件：** 修改 `client/src/components/notebook-workbench/ReportDetailPanel.vue`、`client/src/components/book-workbench/BookActionsPanel.vue`、`client/src/views/BookWorkbenchView.vue`、`server/src/db/index.ts`

**意图：** 复用现有能力，把体验缺口补上，不引入多余抽象。

- [x] 实现新的导图回退阅读提示
- [x] 实现历史版本删除入口与删除确认流
- [x] 重写两条默认 prompt
- [x] 升级未改动的 legacy 默认 prompt 与 description
- [x] 运行目标测试并确认通过

### 步骤 3：集成验证

**文件：** 不新增实现文件

**意图：** 确认这次不是“看着像做完了，实际上删一个就炸”的表演型交付。

- [x] 运行 `node --import tsx --test src/components/book-workbench/book-actions.test.ts src/views/book-workbench-view.test.ts`
- [x] 运行 `node --import tsx --test src/db/init.test.ts`
- [x] 运行 `npm run build --workspace client`
- [x] 运行 `npm run build --workspace server`

## 自审结果

- 这是单个可执行任务，三项改动都围绕 `/book` 阅读产出区收口，没有必要硬拆总览文档。
- 删除入口明确复用现有统一 entry 删除 API，没有自创 book-only 删除体系。
- prompt 增强路线已经写死为“重写默认文本约束”，而不是去迷信 Markdown 装饰、角色扮演或伪协议语法。
- 额外 code review 指出的 3 个问题已修复：legacy 默认 prompt 升级、回退提示不再误导为“稍后会就绪”、深度解读 description 与 prompt 对齐。
