# 读书工作台聊天样式统一与总结真全屏设计

**当前状态：** 已完成
**任务组标识：** 2026-04-14-读书工作台聊天样式统一与总结真全屏
**对应工作区：** .worktrees/2026-04-14-读书工作台聊天样式统一与总结真全屏-设计/
**工作区状态：** 未创建
**执行阶段：** 已完成
**当前负责会话：** 无

## 设计结论

`/book` 的 `对话` 与 `快速找书` 不再各写一套半残聊天皮肤，而是统一为同一组聊天骨架：输入区沿用 `对话` 标签页的样式，消息历史区改用 `快速找书` 当前更稳定的列表布局；`书籍总结` 的历史版本不再挤在中栏顶部，而是迁到右栏上半区做滚动列表；中栏 `书籍总结` 只保留正文预览，并新增真正的 fixed 全屏弹层用于阅读长文。原来顶部那块“书籍总结 / 版本切换保留在顶部...”说明区直接删除。

## 背景判断

- 现在 `对话` 和 `快速找书` 明明都是聊天交互，却长成两种不同的输入区和气泡逻辑，看着像两个项目临时拼一起，挺拧巴。
- 用户已经明确要“输入框像对话，历史像快速找书”，这不是让我们继续做第三套，而是说明当前两边各有一半是对的，应该收口。
- `书籍总结` 顶部下拉既占中栏阅读高度，又不适合放多版本历史；右栏上方空着不用，只能说布局资源浪费得挺稳定。
- 之前把“全屏展示”理解成“占满中栏宽度”已经被用户明确否掉了。继续守着旧结论不改，只能说明我们在和自己的误解谈恋爱。

## 范围边界

本次实现：

- 统一 `对话` 与 `快速找书` 的聊天容器风格
- `快速找书` 输入区改用 `对话` 当前的输入框和发送按钮样式
- `快速找书` 历史区保留现有列表式布局与消息排列方式
- `对话` 用户气泡等消息样式与 `快速找书` 收口到一致的共享样式
- 将 `书籍总结` 历史版本迁到右栏上半区，做滚动列表
- 右栏下半区保留阅读操作按钮区
- 中栏 `书籍总结` 删除顶部标题说明区，只保留正文预览
- 新增真正的 fixed 全屏总结阅读弹层

本次不实现：

- 不改 `/book` 的接口语义
- 不改 `快速找书` 的检索逻辑
- 不把总结历史再拆回左侧或顶部下拉
- 不新增复杂富文本编辑能力；全屏仅用于阅读，不是编辑器模式

## 推荐实现

### 1. 聊天样式收口

- 抽一个轻量的 `book-chat` 样式 helper，用于统一：
  - 用户气泡样式
  - 助手气泡样式
  - 输入框样式
  - 主按钮样式
- `ChatPanel.vue` 保留现有发送逻辑和滚动到底按钮
- `BookFinderPanel.vue` 保留现有消息过滤结果与历史列表结构，但换成和 `ChatPanel.vue` 一致的输入区、用户气泡样式

### 2. 右栏重排

- `BookActionsPanel.vue` 改为上下两段：
  - 上半区：历史版本列表，撑满当前空白区域，可滚动
  - 下半区：阅读操作按钮区（快速读书、详细解读）
- 历史列表项展示标题 + 更新时间，点击直接切换当前总结
- 当前选中项需要有明显但克制的纸页式高亮

### 3. 中栏总结区收口

- `BookSummaryPanel.vue` 删除顶部标题/说明/下拉选择区
- 中栏只保留正文内容区和空状态
- 如果当前有总结，正文区域右上角提供一个“全屏阅读”按钮

### 4. 真全屏展示

- 新增一个基于 `<Teleport to="body">` 的总结全屏弹层
- 弹层要求：
  - `fixed inset-0 z-50`
  - 暖纸底、墨色字，延续当前阅读气质
  - 顶部提供关闭按钮和基础标题信息
  - 正文区域独立滚动
- 该弹层复用 `ReportDetailPanel.vue` 的正文渲染能力，避免再造一套 markdown 预览

## 涉及文件或模块

- `docs/superpowers/specs/2026-04-14-读书工作台聊天样式统一与总结真全屏-设计-已完成.md`
- `client/src/components/book-workbench/ChatPanel.vue`（如需迁移为共享样式，则对应实际文件为 `client/src/components/notebook-workbench/ChatPanel.vue`）
- `client/src/components/book-workbench/BookFinderPanel.vue`
- `client/src/components/book-workbench/book-finder-panel.ts`
- `client/src/components/book-workbench/BookSummaryPanel.vue`
- `client/src/components/book-workbench/BookActionsPanel.vue`
- `client/src/components/book-workbench/book-actions.test.ts`
- `client/src/components/book-workbench/book-finder-panel.test.ts`
- `client/src/components/book-workbench/book-layout.ts`
- `client/src/components/book-workbench/book-layout.test.ts`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/views/book-workbench-view.test.ts`

## 验证方式与成功标准

- `快速找书` 输入区与 `对话` 使用同一套输入框/发送按钮样式
- `对话` 与 `快速找书` 的用户气泡样式一致
- `快速找书` 继续保留当前消息历史列表布局，不退化成 `ChatPanel` 的空状态/滚动按钮结构复制版
- 右栏上方出现可滚动的总结历史版本列表
- 点击右栏历史版本可切换当前 `书籍总结` 展示内容
- `BookSummaryPanel.vue` 不再出现“书籍总结 / 版本切换保留在顶部...”那块头部区域
- `书籍总结` 支持真正 fixed 全屏弹层阅读，不再只是中栏内伪全屏

## 自审结果

- 已明确这是单任务 UI 收口，不需要拆多任务规格
- 已把“全屏”重新定义为真正弹层，避免继续沿用上一轮错误理解
- 已限制在前端布局与样式收口，不会把范围膨胀到接口和生成逻辑
- 已明确右栏历史列表与下半区按钮共存，避免新布局再次把总结历史塞回中栏顶部
