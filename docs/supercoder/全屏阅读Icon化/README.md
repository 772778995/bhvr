# 全屏阅读按钮 Icon 化

**状态：** 进行中

## 设计结论

将 `BookSummaryPanel.vue` 中"全屏阅读"文字按钮替换为 expand/maximize SVG icon，全屏内的关闭按钮保持文字不变（文字在全屏内有足够空间且更明确）。

## 动机

文字按钮"全屏阅读"叠在内容区右上角，视觉上占用了阅读空间且与文档内文字竞争注意力。换成 icon 后占地面积更小、视觉层级更低，同时通过 `aria-label` 保持可访问性。

## 设计决策

- 图标使用内联 SVG（expand/maximize，4箭头向外），宽高 16×16，风格与现有 SVG icons 一致（stroke, no fill）
- 按钮样式保持不变：`absolute right-4 top-4 z-10 rounded-md border border-[#d8cfbe] bg-[#fbf6ed]/92 px-2 py-2 text-[#5d4f3d] ...`（去掉 `px-3` 改为 `px-2` 因为只有 icon 不需要额外水平内边距）
- 加 `aria-label="全屏阅读"` 保障可访问性
- 全屏内顶部 bar 的"全屏阅读模式"文字标签保持不变，不是这次需求范围

## 涉及文件

- 修改 `client/src/components/book-workbench/BookSummaryPanel.vue:38-44`

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | — |

## 坑 / 注意事项

- 去掉 `px-3` 文字时的内边距，icon-only 按钮只需 `px-2 py-2`
