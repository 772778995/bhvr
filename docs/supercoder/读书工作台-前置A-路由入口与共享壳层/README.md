# 读书工作台前置A-路由入口与共享壳层设计

**当前状态：** 已完成

## 设计结论

先把 `/book/:id` 的路由入口和共享工作台壳层打好，再谈左侧单书面板和右侧读书工具区。否则所有后续工作都得建立在复制版 `NotebookWorkbenchView.vue` 上，维护成本肉眼可见地烂掉。

## 这是前置任务的原因

- `/book/:id` 是新默认入口
- `BookWorkbenchView.vue` 需要一个稳定的共享壳层承载布局、加载态、宽度持久化和中间区共用逻辑
- 没有这一层，后续文档只能复制现有页面再魔改

## 可并行关系

- 可与 `前置B-PDF转文本上传接口` 并行开发
- 会被 `并行A-单书来源面板` 和 `并行B-右侧读书工具面板与快速读书` 依赖

## 目标

1. 新增 `/book/:id` 路由
2. 首页列表默认跳转改为 `/book/:id`
3. 保留 `/notebook/:id` 作为兼容页面
4. 抽离共享工作台壳层，避免 notebook 页和 book 页复制逻辑

## 范围

### 路由

- 修改 `client/src/router/navigation.ts`
- 修改 `client/src/router/index.ts`
- 更新 `client/src/router/navigation.test.ts`
- 更新列表页跳转逻辑：
  - `client/src/views/NotebookListView.vue`
  - `client/src/views/notebook-list-view.ts`

### 壳层抽离

- 新建 `client/src/components/notebook-workbench/NotebookWorkbenchShell.vue`
- 让 `client/src/views/NotebookWorkbenchView.vue` 回归薄组装层
- 新建 `client/src/views/BookWorkbenchView.vue`

## 壳层必须承接的能力

- 顶栏容器
- 三栏布局与拖拽分栏
- 宽度 localStorage 持久化
- 加载态 / 错误态 / 空态外壳
- 全局 toast / loader / confirm dialog 挂载位
- 中间区域容器插槽

## 明确不在本任务做的事

- 不实现 PDF 上传接口
- 不实现书籍面板 UI 细节
- 不实现右侧读书工具面板
- 不接入快速读书或快速找书能力

## 文件边界

本任务尽量集中修改以下文件：

- `client/src/router/navigation.ts`
- `client/src/router/index.ts`
- `client/src/router/navigation.test.ts`
- `client/src/views/NotebookListView.vue`
- `client/src/views/notebook-list-view.ts`
- `client/src/views/NotebookWorkbenchView.vue`
- `client/src/views/BookWorkbenchView.vue`
- `client/src/components/notebook-workbench/NotebookWorkbenchShell.vue`

## 验证

1. 首页进入 notebook 后默认跳到 `/book/:id`
2. `/notebook/:id` 仍可访问
3. `BookWorkbenchView.vue` 能加载出壳层与中间区占位
4. 现有 notebook 工作台未被壳层抽离误伤

## 自审结果

- 已明确这是主线前置，不和具体业务面板混写
- 已限制文件边界，适合单独 worktree 开发
