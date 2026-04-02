# 代码风格与规范

## 语言
- TypeScript 严格模式
- ES Modules（"type": "module"）

## 命名规范
- 文件名: kebab-case（如 research.ts, queue.ts）
- 变量/函数: camelCase
- 类型/接口: PascalCase
- 数据库列名: snake_case
- ID: crypto.randomUUID() 生成的文本主键

## 路由组织
- 参考 hono-open-api-starter 模式
- 按功能模块分目录: routes/auth/, routes/research/, routes/health/
- 每个模块有 index.ts 导出 Hono 子路由

## 数据库
- ORM: Drizzle ORM + drizzle-orm/libsql
- 客户端: @libsql/client（纯 JS SQLite，不是 better-sqlite3）
- Schema 定义在 server/src/db/schema.ts
- 迁移脚本: server/src/db/migrate.ts

## 日志
- 生产代码禁止使用 console.log
- 如需日志请使用结构化日志

## 数据验证
- 使用 Zod 进行请求体验证

## 导出模式
- 使用 barrel exports（index.ts 重导出）
- 如 server/src/notebooklm/index.ts 导出 client.ts 的内容

## 重要注意事项
- 使用 Node.js + tsx 运行 TypeScript
- 不使用 native 编译依赖（系统无 C++ 编译工具链）
