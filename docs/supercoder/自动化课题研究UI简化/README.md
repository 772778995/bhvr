# 自动化课题研究 UI 简化设计

**当前状态：** 已完成

## 设计结论

将 StudioPanel 的自动课题研究区域简化为：一个开关（toggle）控制研究的启动/停止，加上问答数据量的计数展示。问题生成保持现状，由 NotebookLM 根据文档自动生成。

## 背景

当前 StudioPanel 有两个按钮（"开始自动研究" + "生成研究报告"）和较多状态信息展示（状态、步骤、进度条、错误信息）。用户希望简化为更直觉的交互模式：一个开关和一个数据量展示。

### 关于问题来源

自动研究的问题由 NotebookLM 自身生成（`orchestrator.ts` 发送 meta-prompt 让 NotebookLM 根据文档生成 N 个研究问题）。每轮问答使用独立的 conversation thread（不传 `conversationId`），因此：
- **无上下文串扰** — 每轮问答独立，不会互相影响回答质量
- **对话历史会增加** — notebook 中会多出 21 个对话线程，但用户主要通过本项目 UI 交互，影响可忽略

结论：保持现状，不引入额外 LLM 或用户手动输入问题的流程。

## 前端改动

### StudioPanel.vue 改造

**移除：**
- "开始自动研究" 按钮
- 步骤行（"生成研究问题"/"等待回答" 等细粒度步骤）
- 进度条

**保留/新增：**
1. **Toggle 开关** — 一个 switch 控件，两个状态：
   - **关（默认）**：未启动研究
   - **开**：触发 `onStartResearch()`，研究运行中保持"开"态且不可手动关闭（因为 orchestrator 没有主动中止能力）
   - 研究完成或失败后，自动切回"关"态
   - 运行中时 toggle 显示为 disabled（防止重复触发）

2. **问答数据计数** — 显示格式：`已完成 N 轮问答`
   - 数据来源：`researchState.completedCount`
   - 研究未开始时显示 `暂无问答数据`
   - 研究进行中显示 `已完成 N / M 轮问答`（N = completedCount, M = targetCount）

3. **错误提示** — 保留 `lastError` 展示，但只在有错误时显示

4. **"生成研究报告"按钮** — 保留，因为 orchestrator 完成后只标记 `completed`，不自动生成报告。按钮仅在 `hasResearchAssets` 为 true 且不在研究进行中时可点击。

5. **报告区域** — 保持不变（报告预览 + "暂无报告" 占位）

### Props 接口变化

无需修改——现有 Props 接口完整保留：
- `researchState.status` → toggle 的开/关
- `researchState.completedCount` / `researchState.targetCount` → 问答计数
- `researchState.lastError` → 错误展示
- `report` → 报告预览
- `onStartResearch` → toggle 开启时调用
- `onGenerateReport` → 报告按钮点击时调用
- `hasResearchAssets` → 报告按钮是否可用

## 后端改动

无。orchestrator、registry、SSE 全部保持不变。

## 视觉设计

遵循现有 paper-folio 风格：
- Toggle 使用 `bg-[#3a2e20]` 作为激活色，`bg-gray-300` 作为未激活色
- 问答计数使用 `text-sm text-gray-600`，与现有信息面板风格一致
- 保持 `rounded-lg border border-gray-200 bg-white` 的容器样式

## 实施范围

仅修改 `client/src/components/notebook-workbench/StudioPanel.vue`，可能需要同步调整父组件中移除 `onGenerateReport` prop 的传递。
