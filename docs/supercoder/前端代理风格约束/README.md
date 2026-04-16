# 前端代理风格约束设计

**当前状态：** 已完成

## 设计结论

为 `notebooklm` 增加一个项目级 OpenCode skill，并同步更新 `AGENTS.md` 的前端方向说明，让后续 AI 在这个仓库里默认避开 `Element Plus`、`shadcn-vue` 模板味和常见 AI 产品视觉套路，优先采用 headless primitive + 本地视觉语言的实现方式。

## 范围

- 新增：`.opencode/skills/notebooklm-frontend-direction/SKILL.md`
- 修改：`AGENTS.md`

## 关键约束

- 当前仓库前端仍然使用 `TailwindCSS v4`，不能在文档里假装已经迁移到 `UnoCSS`
- 用户的偏好是 `Vue + headless primitives + 自定义视觉语言`
- 若后续要迁移到 `UnoCSS`，应单独立项，而不是夹带在普通 UI 任务里

## 执行结果

- 项目级 skill 负责约束 AI 的组件选型、视觉倾向和抽象边界
- `AGENTS.md` 负责把该偏好提升为仓库内的显式指令，避免与旧的 `shadcn-vue` 方向冲突
