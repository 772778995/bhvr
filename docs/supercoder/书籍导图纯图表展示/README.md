# 书籍导图纯图表展示

**状态：** 进行中

## 设计结论

从 `BookMindmapMermaid.vue` 移除标题/标签 header，新增 `compact` prop 控制全屏铺满样式，并在 `BookSummaryPanel.vue` 全屏模式下通过 `ReportDetailPanel` → `BookMindmapMermaid` 的 prop 链透传 `compact=true`。

## 动机

导图是一种图形语言，自带书名节点（mindmap root），顶部额外标题/标签冗余。全屏下更需要充分利用屏幕空间，边框和内边距反而形成视觉裁剪感。

## 设计决策

### 1. 移除 `BookMindmapMermaid.vue` 标题 header

`BookMindmapMermaid.vue:49-61` 的 `v-if="title"` 标题 block 整体删除。  
`title` prop 保留在接口声明中（不 breaking），删除渲染代码即可。

### 2. `BookMindmapMermaid.vue` 新增 `compact` prop

```ts
interface Props {
  code: string;
  title?: string;
  compact?: boolean;  // true = 全屏铺满，false = 默认带圆角边框容器
}
```

- `compact=false`（默认）：保持现有 SVG 渲染区样式（rounded-lg border bg px-4 py-6，外层 mx-auto max-w-5xl）
- `compact=true`：外层 section 改为 `w-full h-full`，SVG 渲染区改为 `w-full h-full overflow-auto`（无边框、无 bg、无内边距）

### 3. `ReportDetailPanel.vue` 接收并透传 `compact` prop

新增可选 `compact?: boolean` prop，在 `isBookMindmapReport` 路径上传给 `<BookMindmapMermaid :compact="compact">`。

非导图路径忽略 `compact`（不影响其他 entry 类型渲染）。

### 4. `BookSummaryPanel.vue` 全屏时传递 `compact`

全屏内的 `<ReportDetailPanel>` 加 `:compact="entry?.contentJson?.kind === 'mermaid_mindmap'"` 。

全屏内容 div（`px-6 py-6 sm:px-8`）同时按相同条件去掉内边距：
```vue
<div :class="entry?.contentJson?.kind === 'mermaid_mindmap'
  ? 'min-h-0 flex-1 overflow-y-auto'
  : 'min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8'">
```

非全屏的 `<ReportDetailPanel>` 不传 `compact`（默认 false），导图在普通视图仍有圆角容器，视觉一致。

## 涉及文件

- 修改 `client/src/components/book-workbench/BookMindmapMermaid.vue`（移除 header，新增 `compact` prop，条件样式）
- 修改 `client/src/components/notebook-workbench/ReportDetailPanel.vue:19-49 + 334-338`（新增 `compact` prop，透传）
- 修改 `client/src/components/book-workbench/BookSummaryPanel.vue:73-93`（全屏传 compact，移除 padding）

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | — |

## 坑 / 注意事项

- `compact=true` 时 SVG 本身宽度可能超出屏幕，`overflow-auto` 允许横向滚动
- `ReportDetailPanel.vue` 渲染 mindmap 时，外层 `div` 当前有 `px-5 py-5` 内边距，`compact` 时需改为 `class="min-h-0 min-w-0 flex-1 overflow-y-auto"`（无内边距），让 `BookMindmapMermaid` 真正撑满
