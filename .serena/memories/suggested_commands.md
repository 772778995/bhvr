# 常用命令

## 系统工具（Windows）
- git — 版本控制
- dir / ls — 列目录（PowerShell 中 ls 是 Get-ChildItem 的别名）
- cd — 切换目录
- findstr / Select-String — 文本搜索
- where — 查找可执行文件路径

## 安装依赖
```bash
npm install
```

## 开发
```bash
# 启动后端开发服务器（端口 3000）
npm run dev:server

# 启动前端开发服务器（尚未开发）
npm run dev:client

# 同时启动所有 workspace
npm run dev
```

## 数据库
```bash
# 初始化/迁移数据库
npx tsx server/src/db/migrate.ts
```

## 构建
```bash
# 构建所有 workspace
npm run build

# 只构建后端
npm run build:server

# 只构建前端
npm run build:client
```

## 类型检查
```bash
npm run type-check
```

## 代码检查
```bash
npm run lint
```

## 测试
```bash
npm run test
```

## NotebookLM 认证
```bash
# 首次登录（会打开浏览器）
npx notebooklm login

# 会话保存在 ~/.notebooklm/storage-state.json
```

## API 测试
```bash
# 健康检查
curl http://localhost:3000/api/health

# 认证状态
curl http://localhost:3000/api/auth/status

# 创建研究任务
curl -X POST http://localhost:3000/api/research -H "Content-Type: application/json" -d "{\"notebookUrl\":\"URL\",\"topic\":\"主题\",\"numQuestions\":5}"

# 查看所有任务
curl http://localhost:3000/api/research

# 查看任务详情
curl http://localhost:3000/api/research/:id
```
