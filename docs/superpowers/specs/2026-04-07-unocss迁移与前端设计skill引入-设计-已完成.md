# UnoCSS迁移与前端设计skill引入设计

**当前状态：** 已完成

## 设计结论

将 `client/` 从 `TailwindCSS v4` 直接迁移到 `UnoCSS + presetWind4`，以最大限度保留现有 utility class 写法，同时在项目内新增一个中文化的 `frontend-design` skill，约束后续 AI 产出避免模板化 AI 风格、Element 风格和 Electron 套壳感。

## 范围

- 修改 `client/package.json`
- 修改 `client/vite.config.ts`
- 修改 `client/src/main.ts`
- 删除或调整 `client/src/style.css` 中对 Tailwind 的直接导入
- 新增 `client/uno.config.ts`
- 新增项目级 `.opencode/skills/frontend-design/SKILL.md`
- 更新 `AGENTS.md` 以反映 UnoCSS 已成为当前前端样式栈

## 关键判断

- 当前仓库前端样式层很薄，迁移成本仍然低，现在迁移比后面补迁移便宜
- 采用 `presetWind4`，避免为了迁移而重写大量 class
- `frontend-design` 不应原样照搬英文文案，而应保留其“拒绝 generic AI aesthetics”的原则，并翻译成更适合该仓库的中文版本
- 所有新增配置仅位于 `notebooklm` 项目内，不触碰全局 OpenCode 配置

## 不做的事

- 不在这次任务里引入 `Reka UI` 或大规模改造页面视觉
- 不把现有所有页面同步重设计
- 不改全局 `~/.config/opencode`

## 验证方式

- 运行 `npm install` 更新项目依赖和 lockfile
- 运行 `npm run build --workspace client` 验证 `UnoCSS` 迁移后的前端构建通过
