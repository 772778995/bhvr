# PDF 大文件解析修复

**状态：** 进行中

## 设计结论

用 `unpdf`（基于最新 PDF.js v5 的 serverless 构建）替换 `pdf-parse`，2 行代码替换现有 `PDFParse` 包装，无其他改动。

## 动机

`pdf-parse` 底层内嵌了一份 2018 年的旧 PDF.js，对不含 ToUnicode 映射的嵌入字体和特殊布局（常见于大文件）无法正确解码字符流，导致提取出的文本只有页码数字，没有实际内容。这是结构性问题，不是可以 patch 的。

## 设计决策

### 选型：`unpdf` > `pdf2json` > 直接用 `pdfjs-dist`

- `unpdf` 封装了 PDF.js v5 serverless build（worker 内联、browser API strip 均已做好），Node 无需任何额外配置
- `pdf2json` 也在维护，但底层仍是 PDF.js 的老 fork，EventEmitter API，且面向 JSON 输出而非纯文本
- 直接用 `pdfjs-dist@5` 要求 Node ≥ 20.19 且需要手动 mock canvas，`unpdf` 已封装这层，没必要自己踩

### 迁移路径

`server/src/pdf/extract-text.ts` 中的 `extractPdfText(buffer)` 函数改为：

```ts
import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizeExtractedPdfText(text);
}
```

`normalizeExtractedPdfText` 函数保持不变，已有测试无需修改。

`loadPdfParse` 函数和 `pdf-parse` 的 `createRequire` 包装整体删除。

## 涉及文件

- 修改 `server/src/pdf/extract-text.ts`（替换实现，接口 `extractPdfText(buffer)` 签名不变）
- `server/package.json`：移除 `pdf-parse` 依赖，新增 `unpdf`

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | — |

## 坑 / 注意事项

- `unpdf` 1.6.0（2026-04-13）是最新版，直接安装 latest 即可
- `unpdf` 的 `extractText` 返回 `{ text: string, totalPages: number }`，只需 `.text` 字段
- `mergePages: true` 把所有页文本合并成单个字符串，与原 `pdf-parse` 行为一致
- `pdf-parse` 有对应 `@types/pdf-parse`，卸载时注意一并移除（如果 package.json 中有）
- 现有 `normalizeExtractedPdfText` 的测试（`extract-text.test.ts`）只测 normalize 逻辑，不涉及库调用，无需修改

## 实施任务

### 任务 1：替换 PDF 解析实现

**文件：**
- 修改 `server/src/pdf/extract-text.ts`
- 修改 `server/package.json`

**意图：** 用 `unpdf` 替换 `pdf-parse`，函数签名不变，`normalizeExtractedPdfText` 保留不动

- [ ] 在 `server/` 目录运行 `npm install unpdf`
- [ ] 在 `server/` 目录运行 `npm uninstall pdf-parse`（同时检查是否有 `@types/pdf-parse` 一并移除）
- [ ] 删除 `extract-text.ts` 中的 `PDFParseCtor` 类型声明和 `loadPdfParse` 函数
- [ ] 用 `unpdf` 的 `extractText + getDocumentProxy` 重写 `extractPdfText` 函数体，签名不变：`async function extractPdfText(buffer: Buffer): Promise<string>`
- [ ] 运行 `npm test --workspace=server` 确认 `extract-text.test.ts` 中的 `normalizeExtractedPdfText` 测试仍通过（它不涉及 unpdf，应无影响）
- [ ] 运行 `npm run build --workspace=server` 确认 TypeScript 编译无报错
