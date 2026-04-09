# 总结 Preset 系统设计

**当前状态：** 已完成

## 设计结论

将「生成研究报告」按钮扩展为可配置的「总结 Preset」系统：点击【总结】弹出 preset 选择菜单，每个 preset 对应一套 Step 3 summaryPrompt；内置一个不可删改的「生成研究报告」preset，并预置一个可编辑的「快速读书」preset，用户可自行添加更多 preset。

---

## 核心约束

- **只替换 Step 3 prompt**：Step 1（生成问题）和 Step 2（逐一提问）流程不变。
- **NotebookLM 来源全程生效**：Step 3 仍通过 `askNotebook()` 调用，所有 preset 都基于用户上传的文档来源生成内容。
- **存储在服务端 DB**：preset 配置持久化，不放浏览器 localStorage（多设备一致）。

---

## 数据模型

### 新增表：`summary_presets`

```typescript
// server/src/db/schema.ts
export const summaryPresets = sqliteTable("summary_presets", {
  id:          text("id").primaryKey(),           // crypto.randomUUID()
  name:        text("name").notNull(),            // 显示名称，如「快速读书」
  description: text("description"),              // 简短说明（选填）
  prompt:      text("prompt").notNull(),          // 注入 Step 3 的 summaryPrompt
  isBuiltin:   integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  // isBuiltin = true → 前端不显示编辑/删除按钮
  createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt:   integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

### `research_tasks` 表新增字段

```typescript
presetId: text("preset_id").references(() => summaryPresets.id)
// null → 使用内置默认 preset（向后兼容旧任务）
```

### 内置 Preset 初始化（DB seed）

服务启动时检查并 upsert 两条内置记录：

| id（固定） | name | isBuiltin |
|---|---|---|
| `builtin-research-report` | 生成研究报告 | true |
| `builtin-quick-read` | 快速读书 | true（可编辑，但不可删除）|

> **注意**：「快速读书」在用户看来是「预置但可编辑」的，但 `isBuiltin` 决定的只是**不可删除**。编辑权限单独用 `canEdit` 逻辑控制（见下文 API 设计）。

---

## API 设计

### Preset CRUD

```
GET    /api/presets              → 列出所有 preset（含内置）
POST   /api/presets              → 创建新 preset
GET    /api/presets/:id          → 获取单个 preset（含 prompt 全文，用于编辑器回显）
PUT    /api/presets/:id          → 更新 preset（isBuiltin=true 且 id=builtin-research-report 时返回 403）
DELETE /api/presets/:id          → 删除 preset（isBuiltin=true 时返回 403）
```

权限规则：
- `builtin-research-report`：不可编辑、不可删除
- `builtin-quick-read` 及其他内置：可编辑、不可删除
- 用户自建：可编辑、可删除

### 研究任务创建

`POST /api/research` 请求体新增可选字段：

```typescript
{
  notebookUrl: string,
  topic?: string,
  numQuestions?: number,
  presetId?: string   // 不传 → 使用 builtin-research-report
}
```

---

## 前端交互设计

### 触发入口

`CreateTaskForm.vue` 中原「开始研究」按钮改为两部分：

```
[ 开始研究 ▾ ]
```

点击主体区域直接用上次选中的 preset 提交；点击 ▾ 展开 preset 选择下拉。

> 或者：单独一个【总结方式】选择区域（select/radio group），然后保留「开始研究」按钮不变。推荐后者，更直观，不容易误触。

### Preset 管理弹框

入口：preset 选择区域右侧有一个「编辑」图标（铅笔），点击打开管理弹框。

弹框内容：
- 列出所有 preset，每行显示：名称 + 简短说明 + 操作按钮
- `builtin-research-report`：仅显示「查看」按钮（prompt 只读）
- 其他内置（快速读书）：显示「编辑」按钮，无「删除」
- 用户自建：显示「编辑」+「删除」按钮
- 底部「+ 添加总结方式」按钮

编辑/新建表单字段：
- 名称（必填，最多 20 字）
- 说明（选填，最多 50 字）
- Prompt（必填，textarea，无字数上限）

### Preset 选择 UI

在 `CreateTaskForm.vue` 的 notebook URL 输入框下方，研究参数区域新增：

```
总结方式  [生成研究报告 ▾]  [编辑图标]
```

使用 `<select>` 或自定义 listbox（与项目现有样式保持一致）。

---

## Worker 层改动

`server/src/worker/research.ts` 中 `compileSummary()` 函数：

```typescript
// 改前（硬编码 prompt）
const summaryPrompt = `请根据以上所有问答...`

// 改后（从 DB 读取 preset prompt）
const preset = task.presetId
  ? await db.query.summaryPresets.findFirst({ where: eq(summaryPresets.id, task.presetId) })
  : await db.query.summaryPresets.findFirst({ where: eq(summaryPresets.id, "builtin-research-report") });

const summaryPrompt = preset!.prompt;
```

向后兼容：`presetId` 为 null 的旧任务，fallback 到 `builtin-research-report` 的 prompt。

---

## 内置 Prompt 内容

### `builtin-research-report`（生成研究报告）

基于现有 `research.ts` 第 163-185 行的 summaryPrompt，原样提取并写入 DB seed，不改动内容。

### `builtin-quick-read`（快速读书）

基于用户提供的书籍解读框架：

```
请根据本笔记本中的文档内容，按照以下框架输出一份书籍解读报告：

1. 基础信息
- 书名
- 英文原版名称（如有）
- 作者（名字及简要介绍）
- 出版时间

2. 结构与内容（快速掌握全书脉络）
- 核心主旨与思想
- 目录脉络（分几个部分，多少章节，章节的逻辑关系；列出每个章节的主要内容和观点，最重要的2-3个内容或观点，以及章节的金句，每个章节不少于300字）
- 独创的概念、模型、方法（概念做解释，模型、工具做适度展开）
- 思维导图（文字版，体现全书结构）

3. 价值与意义（回到组织和工作层面）
- 这本书对读者所在组织的意义
- 对工作有什么用
- 局限性与适用条件

4. 延展阅读（与本书内容主题相关的书籍推荐）

要求：
- 每个条目不超过200字，总体产出文字不超过5000字
- 内容不要堆积，要分论点展开，要用短句子，精辟且易读
- 语言风格要理性、准确，不要随意、发散
- 所有内容必须基于笔记本中的文档来源，不得凭空捏造
```

---

## 实施顺序

1. DB schema 新增 `summary_presets` 表 + `research_tasks.presetId` 字段 + migration
2. DB seed：upsert 两条内置 preset
3. 后端 `/api/presets` CRUD 路由
4. Worker `compileSummary()` 改为从 DB 读取 prompt
5. 前端：`CreateTaskForm.vue` 新增总结方式选择 + 管理弹框组件
6. API 客户端类型更新

---

## 范围外（不做）

- Step 1/Step 2 的 prompt 定制（用户未要求）
- Preset 分享/导出
- 多语言 prompt 模板
- Preset 版本历史
