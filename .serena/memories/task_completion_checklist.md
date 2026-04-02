# 任务完成检查清单

完成编码任务后，请按以下步骤检查：

1. **类型检查**: 运行 `npm run type-check` 确保无类型错误
2. **构建**: 运行 `npm run build` 确保构建通过
3. **测试**: 运行 `npm run test`（如果有测试）
4. **代码检查**: 运行 `npm run lint`（如果配置了 lint）
5. **手动验证**: 如涉及 API 变更，启动 `npm run dev:server` 并用 curl 测试相关接口
6. **数据库迁移**: 如修改了 schema.ts，运行 `npx tsx server/src/db/migrate.ts`

## 不要提交的文件
- .env 及相关环境变量文件
- data/ 目录（SQLite 数据库）
- ~/.notebooklm/（Google 登录凭证）
- node_modules/

## 提交前确认
- 确保 .gitignore 覆盖了敏感文件
- 确认没有 console.log 残留在生产代码中
