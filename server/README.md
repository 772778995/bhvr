# 服务端

NotebookLM 自动化研究引擎的后端服务，基于 Hono.js + Node.js。

## 安装依赖

```bash
npm install
```

## 初始化数据库

```bash
npx tsx src/db/migrate.ts
```

## 启动开发服务器

```bash
npm run dev
```

服务启动后访问 http://localhost:3000
