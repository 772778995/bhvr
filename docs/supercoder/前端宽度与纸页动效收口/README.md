# 前端宽度与纸页动效收口设计

**当前状态：** 已完成

## 设计结论

本轮直接收口前端阅读版心与过渡语言：首页笔记本列表页、Google 账号管理页的页面宽度整体放宽到更接近杂志目录页的版心；全局页面切换、`/book/:id` 工作台加载态、中栏标签切换统一采用“纸页滑移 + 淡入淡出 + 轻翻书”这一套克制动效，不引入第三方动画库，不做浮夸 3D 炫技。

## 范围边界

1. 仅调整前端布局宽度与动画表现，不改业务流程、接口或数据结构。
2. 不引入动画依赖库；统一基于 Vue `<Transition>`、`<RouterView v-slot>` 和本地 CSS / Uno 风格 class 实现。
3. `快速找书` 功能本身仍不实现，本轮只优化视觉与交互动效。

## 关键决策

1. 首页 `NotebookListView` 与账号管理页 `AccountsView` 的最大宽度分别提升到更宽的阅读版心，避免列表内容像窄票据一样挤在中间。
2. `App.vue` 接管全局路由过渡，使用 `RouterView` 插槽 + `Transition`，根据是否进入工作台采用统一的 `paper-route` 动画。
3. `NotebookWorkbenchShell` 的加载态不再显示纯文本 `正在加载工作台...`，改为一个简约的翻书 loader：双页片轻微开合 + 墨色脊线，时长控制在 1.2s 左右循环。
4. `BookWorkbenchView` 中栏切换包裹 `Transition`，使用短程横向滑移和透明度变化，强调“翻到相邻栏页”的感觉，而不是突兀闪切。
5. 其余可见反馈只补轻量动画：首页卡片入场、账号卡片入场、按钮 hover/active、header 链接 hover，不额外制造大量会动的装饰物。

## 视觉与动效方向

1. 动画语义：纸页翻动、内页切换、版面滑移。
2. 进入：`150ms - 220ms ease-out`，`opacity + translateY/translateX` 为主。
3. 离开：`120ms - 160ms ease-in`，位移幅度更小，避免视觉拖泥带水。
4. 翻书 loader：只做局部页片开合，不做真实复杂翻页模拟，避免廉价拟物。
5. 工作台 tab 切换：左右微滑 + 淡入，不使用缩放弹跳。

## 涉及文件

- `client/src/App.vue`
- `client/src/views/NotebookListView.vue`
- `client/src/views/AccountsView.vue`
- `client/src/components/notebook-workbench/NotebookWorkbenchShell.vue`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/components/ui/` 下新增或复用 loader 组件
- 必要时新增小型纯函数测试文件，锁定路由动效名、宽度 token、book 中栏切换配置

## 验证方式

1. 纯函数测试覆盖动效配置和宽度配置。
2. `node --import tsx --test ...` 跑相关前端测试。
3. `npm run build --workspace client` 确认类型与构建通过。

## 成功标准

- 首页笔记本列表页版心明显比当前更宽，列表行长度更舒展。
- Google 账号管理页版心明显放宽，卡片不再显得局促。
- 路由切换出现统一且克制的页面过渡。
- 从首页进入 `/book/:id` 时，工作台加载态呈现简约翻书动画，而不是纯文本提示。
- `/book/:id` 中栏切换带有符合书页风格的过渡动画。
- 动画整体克制、不浮夸，与纸页/档案页方向一致。
