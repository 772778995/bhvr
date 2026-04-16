# 持久化三栏面板宽度和网页来源跳转 实施计划

> **面向智能体工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 已完成

**目标：** 在NotebookLM工作台中持久化三栏面板的宽度设置，并确保网页来源可以直接跳转打开

**架构：** 通过在NotebookWorkbenchView.vue中使用localStorage保存和恢复左右面板宽度，并在SourcesPanel.vue中已实现网页来源的直接跳转功能

**技术栈：** Vue 3, TypeScript, localStorage API

---

### 任务 1：持久化三栏面板宽度

**当前状态：** 已完成

**文件：**
- 修改：`client/src/views/NotebookWorkbenchView.vue`

**意图：** 将左右面板的宽度持久化到localStorage中，使得用户调整面板宽度后刷新页面或重新打开时能够保持之前的设置

- [x] **步骤 1：分析当前面板宽度实现**
  
  检查NotebookWorkbenchView.vue中leftWidth和rightWidth的初始化和拖拽处理逻辑

- [x] **步骤 2：从localStorage读取初始宽度**
  
  修改leftWidth和rightWidth的初始化，优先从localStorage读取值，如果不存在则使用默认值

- [x] **步骤 3：宽度变化时持久化到localStorage**
  
  添加watch监听器，当leftWidth或rightWidth变化时将新值保存到localStorage

- [x] **步骤 4：验证持久化功能**
  
  调整面板宽度，刷新页面确认宽度保持不变

- [x] **步骤 5：提交更改**
  
  提交信息：feat: 持久化三栏面板宽度到localStorage

### 任务 2：验证网页来源跳转功能

**当前状态：** 已完成

**文件：**
- 检查：`client/src/components/notebook-workbench/SourcesPanel.vue`

**意图：** 确认SourcesPanel.vue中已经实现了网页来源的直接跳转功能（无需修改）

- [x] **步骤 1：检查SourcesPanel.vue实现**
  
  检查canOpen函数和模板中的a标签跳转逻辑

- [x] **步骤 2：验证跳转功能**
  
  确认web类型来源使用a标签带有target="_blank"和href属性可以直接跳转

- [x] **步骤 3：确认无需修改**
  
  验证SourcesPanel.vue已经正确实现了网页来源的直接跳转功能
