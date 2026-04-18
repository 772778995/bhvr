# 前后端同镜像部署

**当前状态：** 待实施

## 设计结论

单镜像方案：builder 阶段同时构建 `shared`、`client`、`server`；runtime 阶段由 `server` 在 `3450` 端口同时提供 API（`/api/*`）与前端静态资源（`/`）。生产环境只暴露 `3450`，不开前端独立端口。

## 动机

当前 Dockerfile 只打包了 `shared` 和 `server`，前端（`client/`）完全没有进镜像。这意味着：

- 容器内没有前端，用户无法通过 `http://host:3450` 访问 UI
- 想用前端必须在宿主机单独跑 `npm run dev`，或再起一个前端容器再加反向代理
- 这让"一个命令跑起来"的部署目标无法实现

项目目前是单机 MVP。引入 Nginx、双容器、反向代理等方案是过度设计。最合理的路径是：**在现有 Hono server 上加静态文件托管，Dockerfile 同时构建前端**。

## 范围

本设计覆盖：

- Dockerfile 改造，使 builder 阶段同时构建 client
- server 增加静态文件托管中间件与 SPA fallback 路由
- `server/src/index.ts` 重构为无副作用的 `createApp()` 工厂函数，入口文件单独负责 `serve()`
- 开发/测试态下 client 产物不存在时 server 的行为规范
- Vite dev proxy 配置端口修正（由 `3000` 改为 `3450`）

本设计不覆盖：

- 前端开发工作流（`npm run dev` 照常在宿主机运行 Vite，不在容器里跑 dev server）
- 多容器/Kubernetes 部署（超出当前 MVP 范围，未来另立文档）
- CDN / 对象存储托静态资源
- HTTPS 终止（由宿主机或上层 LB 负责）

## 为什么这样设计

### 为什么单镜像而不是前后端分容器

分容器方案需要：①前端容器（Nginx 或 Node preview）②后端容器 ③反向代理或 Compose 网络配置。对单机 MVP 来说是三倍复杂度，收益几乎为零。单镜像：一个 `docker run`，一个端口，部署和调试都简单。

### 为什么生产不暴露前端独立端口

Vite dev server（`5173`）是开发工具，不适合直接暴露给生产流量：无缓存控制、无 gzip 压缩、SSR/SPA fallback 行为不可靠。生产只走 `server` 提供的已构建静态资源。

### 为什么 server 托静态资源而不是独立 Nginx 容器

Hono 可以通过 `@hono/node-server` 的 `serveStatic` 插件提供静态文件服务，性能对 MVP 完全够用。省掉 Nginx 容器意味着省掉反向代理配置、省掉跨容器网络、省掉额外镜像。未来流量变大时，在此基础上加 Nginx 层是一步的事，不会影响现有逻辑。

### 为什么要把 `createApp()` 从 `serve()` 里拆出来

当前 `server/src/index.ts` 在模块导入时直接调用 `serve()`，导致：

- 任何 `import app from './index.js'` 都会启动监听端口——测试无法隔离
- 静态托管中间件要读 `client/dist`，如果测试环境没有这个目录，进程启动就会报错

拆成 `createApp()` 工厂 + 独立入口后，测试可以直接 `import { createApp }` 而不启动端口，也可以传入一个 mock 静态资源目录。

## 关键技术方案

### 1. Dockerfile：builder 同时构建 client

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS builder

WORKDIR /app

# 复制所有 workspace 清单（含 client）
COPY package.json package-lock.json ./
COPY shared/package.json  ./shared/
COPY client/package.json  ./client/
COPY server/package.json  ./server/
COPY tsconfig.json ./

RUN npm ci --ignore-scripts

# 复制所有源码
COPY shared/  ./shared/
COPY client/  ./client/
COPY server/  ./server/

# 构建顺序：shared → client → server
# client build 依赖 shared 的类型；server build 依赖 shared 的类型
RUN npm run build --workspace=shared \
 && npm run build --workspace=client \
 && npm run build --workspace=server

# ---

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json  ./shared/
COPY client/package.json  ./client/
COPY server/package.json  ./server/

RUN npm ci --omit=dev --ignore-scripts

# 带入编译产物
COPY --from=builder /app/shared/dist  ./shared/dist
COPY --from=builder /app/server/dist  ./server/dist
# 前端静态资源：打进镜像，由 server 托管
COPY --from=builder /app/client/dist  ./client/dist

RUN mkdir -p /app/data

EXPOSE 3450
CMD ["node", "server/dist/index.js"]
```

> **注意**：`client/package.json` 需要有 `build` 脚本（目前已有：`vue-tsc -b && vite build`），builder 阶段直接使用，无需额外修改。

### 2. server 如何托管静态文件

使用 `@hono/node-server` 提供的 `serveStatic`（它是 `hono/serve-static` 的 Node.js 适配版）。

```typescript
import { serveStatic } from "@hono/node-server/serve-static";

// 静态资源根目录，相对于进程 CWD（容器内为 /app）
const STATIC_ROOT = process.env.STATIC_ROOT ?? "client/dist";

app.use(
  "/*",
  serveStatic({ root: STATIC_ROOT })
);
```

- `root` 路径相对于 `process.cwd()`，容器启动时 CWD 是 `/app`，对应 `/app/client/dist`
- 静态资源命中时直接返回文件，不走后续路由
- API 路由（`/api/*`）挂在静态中间件**之前**，优先匹配

### 3. SPA fallback

Vite 生成的 SPA 入口是 `index.html`。所有非 API、非已知静态文件的路径（如 `/notebooks/123`）都应返回 `index.html`，由 Vue Router 在客户端处理路由。

```typescript
// SPA fallback：放在所有 API 路由和静态中间件之后
app.get("*", async (c) => {
  const indexPath = path.join(process.cwd(), STATIC_ROOT, "index.html");
  try {
    const html = await fs.readFile(indexPath, "utf-8");
    return c.html(html);
  } catch {
    // client/dist 不存在（开发/测试环境），见下节
    return c.text("Frontend not built. Run `npm run build --workspace=client`.", 503);
  }
});
```

### 4. `/api/*` 与 `/` 的路由优先级

路由挂载顺序决定优先级，从上到下依次为：

1. `app.use(cors())`
2. `app.route("/api/auth", auth)`
3. `app.route("/api/research", research)`
4. `app.route("/api/health", health)`
5. `app.route("/api/notebooks", notebooks)`
6. `app.route("/api/presets", presetsRouter)`
7. `app.route("/api/files", filesRouter)`
8. `app.use("/*", serveStatic(...))` ← 静态文件，命中则返回
9. `app.get("*", spaFallback)` ← SPA fallback，兜底

API 路由全部以 `/api/` 前缀挂载，不会与静态资源或 SPA 路径冲突。无需额外的路径判断逻辑。

### 5. client 产物不存在时的行为

**开发态（宿主机直接跑 `tsx watch`）：**

`client/dist` 不存在是正常状态。`serveStatic` 命中不到文件会 pass through，SPA fallback 读 `index.html` 失败后返回 `503 + 文字提示`。API 端点不受影响，仍然可以正常访问。

**测试态（`vitest` / `hono/testing`）：**

`createApp()` 工厂函数接受可选的 `staticRoot` 参数，测试时可传入一个临时目录或 `null`（禁用静态托管），避免测试依赖构建产物的存在。

**推荐做法：**
- 开发时：宿主机 `npm run dev --workspace=client`（Vite dev server `5173`）+ `npm run dev --workspace=server`（`3450`），前端通过 Vite proxy 访问后端
- 测试时：`createApp({ staticRoot: null })` 或传 fixture 目录
- 生产时：镜像内 `client/dist` 已存在，一切正常

### 6. `createApp()` 重构要点

当前 `index.ts` 在导入时直接执行 `serve()`，需要拆成两层：

```
server/src/
├── app.ts        # 新增：createApp(options?) → Hono 实例（纯函数，无副作用）
└── index.ts      # 保留：仅负责调用 createApp() + serve() + 启动监控
```

`app.ts` 职责：
- 构建并返回 Hono 实例
- 挂载所有中间件和路由
- 接受 `staticRoot?: string | null` 选项

`index.ts` 职责：
- `import { createApp } from './app.js'`
- `const app = createApp({ staticRoot: process.env.STATIC_ROOT ?? 'client/dist' })`
- `serve()` + 启动 `authManager`、`recoverInterruptedTasks`

### 7. Vite dev proxy 端口修正

当前 `client/vite.config.ts` 的 proxy target 是 `http://localhost:3000`，但 server 实际监听 `3450`。需要修正为：

```typescript
proxy: {
  "/api": {
    target: "http://localhost:3450",
    changeOrigin: true,
  },
},
```

这属于本次范围内的配套修改，未修正则开发态 API 请求全部 502。

## 坑 / 注意事项

1. **`serveStatic` 的 `root` 是相对于 `process.cwd()` 的**，不是相对于当前文件。容器内 CMD 从 `/app` 执行，所以 `client/dist` 对应 `/app/client/dist`。若本地开发的 CWD 不在项目根目录，需通过 `STATIC_ROOT` 环境变量覆盖。

2. **`client/package.json` 列为 workspace 成员**：当前根 `package.json` 的 `workspaces` 字段需要包含 `"client"`。如果缺失，builder 阶段 `npm ci` 不会安装 client 的依赖，构建失败。需确认根 `package.json` 的 `workspaces` 数组包含 `"client"`。

3. **`vue-tsc` 在 builder 阶段**：`client/build` 脚本是 `vue-tsc -b && vite build`，`vue-tsc` 属于 devDependency。builder 阶段用 `npm ci`（含 devDeps）没问题，但要注意 runtime 阶段用 `npm ci --omit=dev` 不安装 `vue-tsc`，这是正确的——runtime 只运行 `node server/dist/index.js`，不需要构建工具。

4. **`client/dist` 已被 client 的 `.gitignore` 排除**，不会意外提交。Dockerfile 通过 `COPY --from=builder` 复制，不依赖 git 跟踪的文件，没有问题。

5. **SPA fallback 会匹配所有 404**：如果访问一个不存在的 API 路由（如 `/api/nonexistent`），Hono 会 404 → 静态中间件 pass through → SPA fallback 返回 `index.html`。这不是理想行为。解决方案：在 SPA fallback 之前，对 `/api/*` 路径显式返回 JSON 404，避免 API 404 被 SPA 吞掉。

6. **生产镜像不带 Vite**：`serveStatic` 只提供基本的静态文件服务，没有 Vite 的 HMR、sourcemap 等开发功能。这是预期行为，生产不需要这些。

7. **端口 `3000` 在 Windows 上被系统保留**：server 原本就监听 `3450`，Vite proxy target 写成 `3000` 是历史遗留错误，必须修正为 `3450`。

## 待办

- [ ] 确认根 `package.json` 的 `workspaces` 数组已包含 `"client"`（当前 Dockerfile 未复制 client 相关清单，需一并补上）
- [ ] 安装 `@hono/node-server/serve-static` 相关依赖（确认 `@hono/node-server` 版本已包含该导出，否则需要额外安装 `hono` 的 `serve-static` 适配器）
- [ ] 新建 `server/src/app.ts`，将 Hono 实例构建逻辑从 `index.ts` 中拆出，接受 `staticRoot` 选项
- [ ] 修改 `server/src/index.ts`，改为调用 `createApp()` + `serve()`
- [ ] 在 `app.ts` 中挂载 `serveStatic` 中间件和 SPA fallback（含 `/api/*` 的 JSON 404 保护）
- [ ] 修改 `Dockerfile`：补充 `client/package.json` 复制、`COPY client/` 源码、`npm run build --workspace=client`、`COPY --from=builder /app/client/dist`
- [ ] 修正 `client/vite.config.ts` proxy target 由 `3000` 改为 `3450`
- [ ] 本地验证：`docker build -t bhvr . && docker run -p 3450:3450 bhvr`，访问 `http://localhost:3450` 确认前端正常加载，访问 `http://localhost:3450/api/health` 确认 API 正常

## 实施任务

### 任务 1：server 应用工厂重构（`app.ts` 拆分）

**目标文件：**
- 新增 `server/src/app.ts`
- 修改 `server/src/index.ts`

**要求：**
- `createApp(options?: { staticRoot?: string | null })` 返回配置好的 Hono 实例
- 静态中间件在 API 路由**之后**挂载（保证路由优先级正确）
- `staticRoot` 为 `null` 时跳过静态托管（测试友好）
- `staticRoot` 对应目录不存在时，SPA fallback 返回可读的 `503` 文本，不抛异常
- `/api/*` 路径上如果没有匹配到 API 路由，返回 JSON `{ error: "Not Found", path: "..." }` 而不是 SPA `index.html`
- `index.ts` 保留所有副作用逻辑（`serve`、`authManager`、`recoverInterruptedTasks`）

### 任务 2：Dockerfile 补全 client 构建

**目标文件：**
- `Dockerfile`

**要求：**
- builder 阶段：复制 `client/package.json`、`COPY client/`、`npm run build --workspace=client`
- runtime 阶段：`COPY --from=builder /app/client/dist ./client/dist`
- 构建顺序严格为 `shared → client → server`（client 依赖 shared 类型）
- 不在 runtime 镜像中保留 client 的 `node_modules`（devDeps 不进镜像）

### 任务 3：配套修正

**目标文件：**
- `client/vite.config.ts`

**要求：**
- proxy target 由 `http://localhost:3000` 改为 `http://localhost:3450`

## 变更历史

| 日期 | 作者 | 说明 |
|------|------|------|
| 2026-04-19 | supercoder | 初始设计，明确单镜像方案与 server 静态托管路线 |
