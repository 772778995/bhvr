# 书籍导图 SVG 转 JPG 下载

**状态：** 进行中

## 设计结论

**推荐：前端 Canvas 方案。** 在现有下载逻辑中，先获取 SVG 数据，用 canvas 渲染后导出为 JPG。

## 问题分析

**现状：**
- 书籍导图通过 Mermaid 渲染为 SVG 显示在前端 (`BookMindmapMermaid.vue`)
- 当前下载功能只支持导出 Mermaid 源码 (.mmd 文件)
- 用户需要 JPG 格式的导图图片用于分享/保存

**需求：** 点击下载按钮时，将当前显示的 SVG 导图转换为 JPG 图片并下载。

## 设计决策

### 方案：前端 Canvas 转换（推荐）

在 `BookSummaryPanel.vue` 的 `downloadEntry` 函数中，针对 mindmap 类型做特殊处理：

1. 获取 SVG 内容（从组件内部或通过 props 传入）
2. 创建一个 Image 对象，加载 SVG 数据
3. 用 canvas 绘制 Image
4. 导出 canvas 内容为 JPG blob
5. 触发 JPG 下载

```typescript
async function downloadAsJpg(svgHtml: string, filename: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          triggerDownload(url, `${filename}.jpg`);
          resolve();
        } else {
          reject(new Error("Failed to create JPG blob"));
        }
      }, "image/jpeg", 0.95);
    };
    img.onerror = () => reject(new Error("Failed to load SVG"));
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgHtml)));
  });
}
```

**关键点：**
- SVG 数据需要正确编码为 data URL
- 需要处理跨域（本地 data URL 不存在跨域问题）
- JPG 质量设为 0.95 保证清晰度
- 需要白色背景，因为 SVG 本身透明

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | 用户需要在下载书籍导图时将 SVG 转成 JPG |

## 坑 / 注意事项

- SVG 数据可能较大，需要确保 base64 编码正确处理中文和特殊字符
- 大尺寸 SVG 在 canvas 绘制可能存在性能问题
- 需要处理 SVG 中引用外部资源的情况（本项目应无此问题）

## 待办

## 实施任务

> 使用 supercoder:subagent-coordination 逐任务实施。

### 任务 1：修改 BookSummaryPanel 支持 SVG 下载

**文件：** `client/src/components/book-workbench/BookSummaryPanel.vue`

**意图：** 为 mindmap 类型的 entry 添加 SVG → JPG 下载支持

- [x] 导入必要类型（ReportEntry 已导入）
- [x] 修改 `downloadEntry` 函数，检测 mindmap 类型
- [x] 实现 `downloadAsJpg` 辅助函数
- [x] 保留原有 .mmd 下载作为 fallback

### 任务 2：传递 SVG 数据

**文件：** `client/src/components/book-workbench/BookMindmapMermaid.vue` + `BookSummaryPanel.vue`

- [x] 通过 DOM 查询获取（简化方案）

### 任务 3：验证

- [x] 修复模糊问题：使用 getBoundingClientRect 获取实际渲染尺寸
- [ ] 启动前端，手动生成书籍导图
- [ ] 点击下载，验证导出为 JPG 格式