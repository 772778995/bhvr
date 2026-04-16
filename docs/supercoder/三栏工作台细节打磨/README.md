# 三栏工作台细节打磨设计

**当前状态：** 已完成

## 设计结论

以书页暖色调为基准，统一气泡、按钮、图标、滚动条风格，加入可拖拽分隔条改变三栏宽度，修复 tooltip，无新依赖。

---

## 变更清单

### 1. 气泡风格统一

**目标：** 用户气泡和 AI 气泡都纳入书页暖色系，与背景一致，避免突兀的蓝色。

| 角色 | 旧样式 | 新样式 |
|------|--------|--------|
| user | `bg-blue-600 text-white` | `bg-[#3a2e20] text-[#f5ede0]`（墨色底+暖纸字） |
| assistant | `bg-gray-100 text-gray-900` | `bg-[#f8f3ea] text-[#2f271f] border border-[#e0d5c0]`（暖纸底+墨字+细边框） |

时间戳也对齐：user 右对齐，assistant 左对齐，颜色 `text-[#9a8a78]`。

---

### 2. 来源列表去掉 globe 占位符

删除 `iconForSourceType` 调用，删除图标 `<span>`，改为在标题下方的次级信息行用纯文字标签显示类型（原本已有 `source.type · source.status`，保留即可）。

---

### 3. truncate 悬浮 tooltip

给来源列表每项标题（`<a>` 和 `<p>`）加 `:title="source.title"` 属性，浏览器原生 tooltip，零依赖。

---

### 4. 全局滚动条样式

在 `style.css` 中追加 `::-webkit-scrollbar` 系列规则：
- 宽/高：6px
- track：透明
- thumb：`rgba(160, 140, 110, 0.35)`，圆角，hover 加深到 `rgba(160, 140, 110, 0.6)`
- 与暖纸背景融合，细而不突兀

---

### 5. 可拖拽三栏分隔条

**方案：** 自封装，纯 mousedown/mousemove，`display:flex` 替代 `grid`，CSS variable 控制宽度。

**布局变化：**

```
旧：grid grid-cols-[280px_minmax(0,1fr)_300px]
新：flex，左栏 width 由 ref 控制，中栏 flex-1，右栏 width 由 ref 控制
```

**分隔条组件：** `ResizeDivider.vue`（约 50 行）
- 视觉：4px 宽透明区域，中心 1px 线，hover 变暖色（`#c8b89a`），`cursor-col-resize`
- 拖拽逻辑：mousedown 记录起始 x，mousemove 计算 delta 更新宽度，mouseup/mouseleave 清理
- 最小宽度：左 220px，右 280px，中 300px

**初始宽度：** 左 280px，右 340px。

---

### 6. 右侧栏按钮统一

**目标：** 去掉 `bg-blue-600`，统一书页风墨色/暖色系。

| 按钮 | 旧 | 新 |
|------|----|----|
| 开始自动研究（主要） | `bg-blue-600 hover:bg-blue-700` | `bg-[#3a2e20] hover:bg-[#2a201a] text-[#f5ede0]` |
| 生成研究报告（次要） | `border-gray-300 text-gray-700` | `border-[#c8b89a] bg-[#fbf7ef] text-[#564738] hover:bg-[#f1e8d8]` |

---

### 7. 右侧栏宽度

`300px → 340px`。

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `client/src/components/notebook-workbench/ResizeDivider.vue` | 新建 |
| `client/src/views/NotebookWorkbenchView.vue` | 修改：布局 flex + ResizeDivider + 宽度 state |
| `client/src/components/notebook-workbench/ChatPanel.vue` | 修改：气泡风格 |
| `client/src/components/notebook-workbench/SourcesPanel.vue` | 修改：删 globe，加 tooltip |
| `client/src/components/notebook-workbench/StudioPanel.vue` | 修改：按钮颜色 |
| `client/src/style.css` | 修改：追加滚动条样式 |

---

## 验证

```bash
npm run build --workspace client
```
