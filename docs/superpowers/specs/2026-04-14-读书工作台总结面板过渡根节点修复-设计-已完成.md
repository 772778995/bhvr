# 读书工作台总结面板过渡根节点修复设计

**当前状态：** 已完成
**任务组标识：** 2026-04-14-读书工作台总结面板过渡根节点修复
**对应工作区：** .worktrees/2026-04-14-读书工作台总结面板过渡根节点修复-设计/
**工作区状态：** 未创建
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`BookSummaryPanel.vue` 必须恢复为单一元素根节点，继续保留真正的 `Teleport + fixed` 全屏阅读弹层，但 `Teleport` 需要作为根 `<section>` 的内部子节点存在，而不是和 `<section>` 并列成双根模板。这样 `BookWorkbenchView.vue` 里的 `<Transition>` 才能对 `BookSummaryPanel` 做合法动画，不再触发 “renders non-element root node” 警告。

## 背景判断

- 当前警告只在切到 `书籍总结` 标签页时出现，堆栈已经明确指向 `BookSummaryPanel` 被放进了 `<Transition>`。
- `BookSummaryPanel.vue` 现状是顶层 `<section>` 后面再跟一个 `<Teleport>`，组件模板因此退化成 fragment 根。
- Vue 对 `<Transition>` 的约束很直接：子组件最终必须落成单一元素根。这里不是框架脾气大，是我们把全屏弹层加进去时把根节点约束踩坏了。
- 不推荐额外包一层 `div.contents` 来糊过去，那样虽然能消除警告，但会让过渡类名打在 `display: contents` 元素上，动画效果本身也会变得不可靠，纯属拆东墙补西墙。

## 范围边界

本次实现：

- 修复 `BookSummaryPanel.vue` 作为 `<Transition>` 子节点时的根节点结构
- 保留当前书页式正文区布局
- 保留真正的全屏 `Teleport` 阅读弹层
- 补一条结构测试，防止后续再把 `Teleport` 挪回根外面

本次不实现：

- 不修改 `BookSummaryPanel` 的视觉设计
- 不调整 `BookWorkbenchView` 的标签切换逻辑
- 不改总结生成、版本切换或全屏阅读交互语义

## 涉及文件或模块

- `client/src/components/book-workbench/BookSummaryPanel.vue`
- `client/src/views/book-workbench-view.test.ts`

## 验证方式与成功标准

- `BookSummaryPanel.vue` 模板恢复为单一元素根
- `Teleport` 仍然存在，但作为根 `<section>` 的内部子节点
- 切换到 `书籍总结` 标签页时不再出现 `renders non-element root node` 的 Vue warning
- 相关前端测试通过
- `client` 构建通过
