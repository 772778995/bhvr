# Google 账号持久化认证与管理页面 实施计划

> **面向智能体工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 已完成

**目标：** 修复 Google 认证每隔几小时失效的根本问题，通过 Playwright persistent context 持久化浏览器 profile，并新增账号管理 Web 页面。

**架构：**
1. 新增 `loginAccount(accountId)` 函数：使用 Playwright `launchPersistentContext` headed 模式打开浏览器，用户手动完成 Google 登录后，browser-user-data 目录被填充，后续静默刷新即可成功。
2. 后端新增账号管理 API 路由：`GET /api/auth/accounts`、`POST /api/auth/accounts/:id/login`、`DELETE /api/auth/accounts/:id`。
3. 前端新增账号管理页面 `AccountsView.vue`，路由 `/settings/accounts`，从首页 auth banner 链接进入。

**技术栈：** Node.js + TypeScript + Playwright + Hono.js + Vue 3 + UnoCSS

---

## 根本原因

`npx notebooklm login` 只保存 `~/.notebooklm/storage-state.json`（cookies），**不填充** `~/.notebooklm/profiles/default/browser-user-data/`。

`refreshWithPersistentProfile()` 依赖 `browser-user-data` 目录有 Google 会话，但该目录为空，Playwright 打开的是全新空白浏览器，立即被重定向到 Google 登录页，刷新彻底失败。

结果：每次 cookies 过期（约几小时至一天），用户必须手动重跑 `npx notebooklm login`。

**修复方向：** 提供一个 headed 模式登录入口，让用户完成一次手动登录，此后 browser-user-data 有完整会话，`refreshWithPersistentProfile()` 即可成功静默刷新。

---

## 文件结构

### 新增文件
- `server/src/notebooklm/login.ts` — `loginAccount(accountId)` 函数，封装 headed Playwright 登录流程
- `client/src/views/AccountsView.vue` — 账号管理页面

### 修改文件
- `server/src/notebooklm/index.ts` — 导出 `loginAccount`
- `server/src/routes/auth/index.ts` — 新增 3 个路由端点
- `client/src/api/client.ts` — 新增账号管理 API 类型和方法
- `client/src/router/navigation.ts` — 新增 `/settings/accounts` 路由
- `client/src/router/index.ts` — 注册 `AccountsView` 组件
- `client/src/views/HomeView.vue` 或全局 Layout — auth banner 添加"管理账号"链接

---

## 任务列表

### 任务 1：实现 `loginAccount` 后端函数

**当前状态：** 已完成

**文件：**
- 创建：`server/src/notebooklm/login.ts`
- 修改：`server/src/notebooklm/index.ts`（新增导出）

**意图：** 使用 Playwright `launchPersistentContext` 以 `headless: false`（headed 模式）打开浏览器，导航到 `https://notebooklm.google.com/`，等待用户手动完成 Google 登录，登录成功后导出 storage state 并更新 auth-meta 为 `ready`。

整个过程有超时保护（默认 5 分钟），超时后关闭浏览器并抛出错误。登录成功的判断条件是：页面 URL 不包含 `accounts.google.com`，且 cookies 中存在 `SAPISID`。

流程伪代码：
```pseudo
async loginAccount(accountId):
  ensureProfileDirectories(accountId)
  paths = getProfilePaths(accountId)
  
  context = chromium.launchPersistentContext(paths.browserUserDataDir, {
    headless: false,
    timeout: 5 * 60 * 1000
  })
  
  try:
    page = context.newPage()
    page.goto("https://notebooklm.google.com/", { waitUntil: "domcontentloaded" })
    
    // 等待用户登录完成：URL 变为 notebooklm.google.com 且不含 challenge
    page.waitForURL(url => isNotebookLMHomePage(url), { timeout: 5 * 60 * 1000 })
    
    storageState = exportPersistentContextState(context, accountId)
    cookieData = extractCookieData(storageState)
    if not cookieData or not cookieData.cookieHeader.includes("SAPISID"):
      throw Error("登录未完成：缺少必要的 Google 会话 cookie")
    
    writeAuthMeta(accountId, { accountId, status: "ready", lastRefreshedAt: now() })
    return { accountId, status: "ready" }
  finally:
    context.close()
```

- [x] **步骤 1：创建 `server/src/notebooklm/login.ts`**

  实现 `loginAccount(accountId: string): Promise<{ accountId: string; status: "ready" }>` 函数，按上述伪代码逻辑：
  - 调用 `ensureProfileDirectories(accountId)` 确保目录存在
  - 使用 `chromium.launchPersistentContext(paths.browserUserDataDir, { headless: false })` 打开带持久化 profile 的有头浏览器
  - 导航到 `https://notebooklm.google.com/`
  - 等待 URL 变为 notebooklm.google.com 首页（不包含 `accounts.google.com` 也不包含 `/challenge`），超时 5 分钟
  - 调用 `exportPersistentContextState(context, accountId)`（从 `client.ts` 的同名函数逻辑提取，或直接调用）保存 storage state
  - 验证 cookies 中包含 `SAPISID`，否则抛出 `Error("登录未完成：缺少必要的 Google 会话 cookie")`
  - 调用 `writeAuthMeta(accountId, { accountId, status: "ready", lastRefreshedAt: new Date().toISOString() })` 更新状态
  - `finally` 块中关闭 context
  - 注意：`exportPersistentContextState` 和 `extractCookieData` 在 `client.ts` 中是非导出的内部函数，需要在 `login.ts` 中复制相关逻辑，或者将这两个函数从 `client.ts` 提取到 `auth-profile.ts` 中作为共享工具函数。**推荐方案：** 直接在 `login.ts` 中实现这两步（导出 storage state + 验证 cookie），不引入 `client.ts` 内部依赖，避免循环依赖。

- [x] **步骤 2：在 `server/src/notebooklm/index.ts` 中导出 `loginAccount`**

  在 `index.ts` 的导出列表中添加 `export { loginAccount } from "./login.js"`。

  检查 `index.ts` 当前导出了哪些内容，确保不引入命名冲突。

- [x] **步骤 3：手动验证（非自动测试）**

  本任务没有合适的自动化测试（需要真实浏览器和 Google 账号），通过任务 3 实现后端路由后，用浏览器调用 API 端点来验证。

- [x] **步骤 4：提交**

  提交信息：`新增 loginAccount 函数：通过 Playwright headed 模式持久化浏览器 profile`

---

### 任务 2：后端新增账号管理 API 路由

**当前状态：** 已完成

**文件：**
- 修改：`server/src/routes/auth/index.ts`

**意图：** 在现有 `GET /api/auth/status` 基础上，新增三个端点支持账号管理。这些端点暂时只操作 `DEFAULT_ACCOUNT_ID`（"default"），为后续多账号扩展留好接口形状。

新增端点：
- `GET /api/auth/accounts` — 返回所有账号的状态列表（目前只有 default）
- `POST /api/auth/accounts/:accountId/login` — 触发指定账号的 headed 登录流程
- `DELETE /api/auth/accounts/:accountId` — 删除指定账号的 profile（清空 storage-state.json 和 browser-user-data，重置 auth-meta 为 missing）

注意事项：
- `POST /login` 端点调用 `loginAccount(accountId)` 是一个长时间操作（等待用户手动登录，最长 5 分钟），需要在后端使用 `Promise` 异步执行，并立即返回 `202 Accepted` + `{ message: "登录窗口已打开，请在浏览器中完成 Google 登录" }`，让前端轮询 `GET /api/auth/accounts` 来感知登录完成。
  - 原因：Hono 的请求超时通常小于 5 分钟，不适合同步等待。
  - 实现：在内存中维护一个简单的 `loginInProgress: Set<string>`，`POST /login` 检查是否已有进行中的登录，若有则返回 409；否则 fire-and-forget 执行，失败时更新 auth-meta 为 error。
- `DELETE /:accountId` 需要调用 `writeAuthMeta` 重置为 `{ accountId, status: "missing" }`，并删除 `storageStatePath` 文件（若存在）。**不删除** `browserUserDataDir`（保留以防止 Playwright profile 被意外清除）。实际需要清空的是 `storage-state.json`。

响应类型：
```typescript
// GET /api/auth/accounts
{ accounts: AuthStatus[] }

// POST /api/auth/accounts/:accountId/login
// 202
{ message: string }
// 409（已有进行中的登录）
{ error: string }

// DELETE /api/auth/accounts/:accountId
// 200
{ message: string }
```

- [x] **步骤 1：在 `server/src/routes/auth/index.ts` 中添加三个端点**

  按上述接口设计实现三个端点，注意：
  - 导入 `loginAccount` from `../../notebooklm/index.js`
  - 导入 `writeAuthMeta`, `readAuthMeta`, `getProfilePaths`, `DEFAULT_ACCOUNT_ID` from `../../notebooklm/auth-profile.js`（注意 `DEFAULT_ACCOUNT_ID` 在 `auth-profile.ts` 里有，在 `auth-manager.ts` 也有，两处相同，选其一）
  - 导入 `existsSync`, `unlinkSync` from `node:fs`
  - `loginInProgress` 维护在路由文件模块级别（Set<string>）
  - `accountId` 参数校验：只允许 `"default"` 目前，若传其他值返回 404
  - 操作 `storage-state.json` 删除：使用 `unlinkSync(paths.storageStatePath)` 包裹在 `existsSync` 判断中

- [x] **步骤 2：用 curl 或 Postman 手动测试端点**

  启动服务器后测试：
  - `curl http://localhost:3000/api/auth/accounts` 应返回包含 default 账号状态的数组
  - `curl -X POST http://localhost:3000/api/auth/accounts/default/login` 应返回 202 并弹出浏览器窗口
  - `curl -X DELETE http://localhost:3000/api/auth/accounts/default` 应重置账号状态

- [x] **步骤 3：提交**

  提交信息：`新增账号管理 API 路由：支持列出、触发登录和删除账号`

---

### 任务 3：前端 API 客户端更新

**当前状态：** 已完成

**文件：**
- 修改：`client/src/api/client.ts`

**意图：** 新增账号管理相关的类型定义和 API 方法，供 `AccountsView.vue` 使用。

新增类型：
```typescript
export interface AccountsListResponse {
  accounts: AuthStatus[];
}
```

新增 API 方法（添加到 `api` 对象中）：
- `listAccounts(): Promise<AccountsListResponse>` — `GET /api/auth/accounts`
- `triggerLogin(accountId: string): Promise<{ message: string }>` — `POST /api/auth/accounts/:accountId/login`
- `deleteAccount(accountId: string): Promise<{ message: string }>` — `DELETE /api/auth/accounts/:accountId`

- [x] **步骤 1：更新 `client/src/api/client.ts`**

  添加 `AccountsListResponse` 类型和三个 API 方法，保持与文件现有风格一致（使用现有的 `request<T>()` 函数）。

- [x] **步骤 2：提交**

  提交信息：`前端 API 客户端新增账号管理方法`

---

### 任务 4：前端路由新增账号管理页面

**当前状态：** 已完成

**文件：**
- 修改：`client/src/router/navigation.ts`
- 修改：`client/src/router/index.ts`

**意图：** 注册 `/settings/accounts` 路由，使用懒加载方式导入 `AccountsView.vue`（该组件在任务 5 中创建）。

- [x] **步骤 1：在 `navigation.ts` 中新增路由定义**

  在 `createAppRoutes` 返回的数组中新增：
  ```
  {
    path: "/settings/accounts",
    name: "accounts-settings",
    component: () => import("@/views/AccountsView.vue"),
  }
  ```

  由于是懒加载，组件文件尚不存在时路由定义不会报错，但在任务 5 完成前不能实际访问该路由。

- [x] **步骤 2：提交**

  提交信息：`前端路由新增账号管理页面路由`

---

### 任务 5：创建账号管理页面 `AccountsView.vue`

**当前状态：** 已完成

**文件：**
- 创建：`client/src/views/AccountsView.vue`

**意图：** 实现一个简单清晰的账号管理页面，列出当前所有 Google 账号（目前只有 default），显示每个账号的认证状态，支持触发登录和删除账号操作。

页面功能：
1. 挂载时调用 `api.listAccounts()` 获取账号列表，每 5 秒自动刷新一次（用于感知登录完成）
2. 对每个账号显示：
   - 账号 ID（`accountId`）
   - 认证状态徽章：`ready` = 绿色"已登录"，`refreshing` = 黄色"刷新中"，`expired`/`reauth_required` = 红色"已过期"，`missing` = 灰色"未登录"，`error` = 红色"错误"
   - 最后检查时间（`lastCheckedAt`，若存在）
   - 错误信息（`error`，若存在，红色小字）
3. 操作按钮：
   - "登录"按钮（状态为 `missing`/`expired`/`reauth_required`/`error` 时显示）：点击调用 `api.triggerLogin(accountId)`，成功后显示提示"登录窗口已打开，请在浏览器中完成 Google 登录"，按钮变为禁用 + "等待登录..."
   - "删除"按钮（状态为任意时显示，`ready` 状态时需要二次确认）：点击调用 `api.deleteAccount(accountId)`，成功后刷新列表
4. 页面顶部有返回首页的链接

**视觉方向**（遵循项目"仿书页/档案页/研究手稿"风格，参考 `AGENTS.md`）：
- 暖纸色背景（`bg-[#faf7f2]` 或类似）
- 墨色文字（`text-[#2c2c2c]`）
- 衬线标题（页面标题使用 `font-serif`）
- 卡片用细边框 + 轻阴影，不要投影太重
- 状态徽章用小圆点 + 文字，不要大色块 pill
- 主要内容不要 `text-xs`，至少 `text-base`，行高宽松

- [x] **步骤 1：加载前端设计 skill**

  在实现 Vue 组件之前，加载 `notebooklm-frontend-direction` skill 以确保视觉方向正确。

- [x] **步骤 2：创建 `AccountsView.vue`**

  实现完整的账号管理页面，包含上述所有功能和视觉方向要求。使用 `<script setup lang="ts">` 语法，使用 `ref`/`onMounted`/`onUnmounted` 管理状态和定时器，使用 `api.listAccounts()`/`api.triggerLogin()`/`api.deleteAccount()` 进行 API 调用。

  状态变量：
  - `accounts: Ref<AuthStatus[]>` — 账号列表
  - `loading: Ref<boolean>` — 初始加载状态
  - `error: Ref<string | null>` — 加载错误
  - `loginPending: Ref<Set<string>>` — 正在等待登录的账号 ID 集合
  - `deleteConfirm: Ref<string | null>` — 当前请求确认删除的账号 ID

  定时器：`setInterval` 每 5 秒调用一次 `refreshAccounts()`，`onUnmounted` 时清除。

- [x] **步骤 3：提交**

  提交信息：`新增账号管理页面，支持查看状态、触发登录和删除账号`

---

### 任务 6：首页 auth banner 添加"管理账号"入口

**当前状态：** 已完成

**文件：**
- 修改：`client/src/views/HomeView.vue`（或存放 auth banner 的组件）

**意图：** 在现有 auth status banner 中添加一个"管理账号"链接，让用户能从首页快速导航到账号管理页面。当认证状态为非 `ready` 时，链接文字可以更醒目（如"请登录"）。

- [x] **步骤 1：定位 auth banner 在 HomeView.vue 中的位置**

  阅读 `client/src/views/HomeView.vue`，找到显示 auth 状态的代码段（搜索 `authStatus` 或 `auth` 相关）。

- [x] **步骤 2：在 banner 中添加链接**

  在 auth banner 适当位置添加：
  ```
  <router-link to="/settings/accounts">管理账号</router-link>
  ```
  样式与 banner 风格一致，保持低调（`text-sm` 下划线链接即可）。当 `authStatus.status !== "ready"` 时可以用稍微醒目的颜色（暖红或深金色）。

- [x] **步骤 3：提交**

  提交信息：`首页 auth banner 新增账号管理入口链接`

---

### 任务 7：端到端验证

**当前状态：** 已完成

**文件：** 不修改代码，只做验证

**意图：** 确保整个登录持久化流程能端到端工作。

- [x] **步骤 1：启动开发服务器**

  运行 `npm run dev`（在 monorepo 根目录），确保前后端都启动。

- [x] **步骤 2：访问账号管理页面**

  打开浏览器访问 `http://localhost:5173/settings/accounts`，确认页面正常显示，账号 default 的状态正确展示。

- [x] **步骤 3：触发登录**

  点击"登录"按钮，确认：
  - 后端返回 202
  - 浏览器窗口弹出（Playwright headed 模式）
  - 在浏览器中手动完成 Google 登录
  - 登录完成后，页面自动刷新（5 秒轮询），状态变为"已登录"

- [x] **步骤 4：验证静默刷新生效**

  检查 `~/.notebooklm/profiles/default/browser-user-data/` 目录不再为空（包含 Playwright 填充的 Chrome profile 文件）。

  重启服务器，确认认证状态仍为 `ready`（不需要重新登录）。

- [x] **步骤 5：测试 302 错误是否消失**

  手动删除 `~/.notebooklm/profiles/default/storage-state.json` 模拟 cookies 过期，然后触发一次 research 请求，观察是否触发 `refreshWithPersistentProfile()` 并成功恢复（因为 browser-user-data 有会话）。

---

## 自审检查结果

**规范覆盖：**
- ✅ 修复 302 错误 → 任务 1 + 任务 7 中验证
- ✅ 首次登录后持久化 browser profile → 任务 1 (`launchPersistentContext` headed 模式)
- ✅ 静默刷新生效 → 现有 `refreshWithPersistentProfile()` 在 browser-user-data 填充后自然生效，无需修改
- ✅ 多账号架构 → 所有接口按 `accountId` 参数化，当前只暴露 default
- ✅ 不存储 email/password → 整个流程无密码，全靠浏览器 profile
- ✅ 后端账号管理 API → 任务 2
- ✅ 前端账号管理页面 → 任务 4 + 5
- ✅ 首页入口 → 任务 6

**潜在风险：**
- `loginAccount` 是长时间操作（最长 5 分钟），后端用 fire-and-forget 异步处理，前端轮询感知结果，已在任务 2 中说明
- `exportPersistentContextState` 和 `extractCookieData` 在 `client.ts` 是私有函数，`login.ts` 需要独立实现这两步逻辑（代码量很少，不引入循环依赖）
- Windows 平台（当前开发环境）的 Playwright headed 模式需要确保 Playwright 已安装 Chromium：运行 `npx playwright install chromium` 如果尚未安装

---

## 远程部署场景下的友好登录方案

> **设计状态：** 已确定设计立场，待实施。本节只做设计讨论，不进入任务清单。

### 背景与动机

上述任务 1–7 中，`loginAccount` 以 Playwright headed 模式弹出浏览器窗口，这在**本机桌面环境**下运行良好。但当服务部署在无桌面的远程服务器（VPS、Docker 容器、云函数）时，"弹浏览器"完全无法工作。

核心问题：`notebooklm-kit` SDK 依赖 Google 网页会话 cookies（`storage-state.json`），没有公开 OAuth 端点，无法走标准的 server-side OAuth 流程。因此，远程场景下必须换一套思路——**不让服务器自己登录，而是让用户在本机登录，再把凭据安全传给服务器**。

### 为什么不能照搬 CLIProxyAPI 的 OAuth callback 流程

CLIProxyAPI 实现的是：远程服务生成 PKCE state → 把用户重定向到官方 OAuth 授权页 → 用户授权后 OAuth callback 带着 `code` 回来 → 服务端换取 `access_token`。

这套流程的前提是：目标服务有**公开的 OAuth 授权服务器**和**官方支持的 callback URI**。

NotebookLM/Google 网页登录两者都没有：
- `notebooklm-kit` 是逆向 Google 内部 batchexecute RPC，不走 OAuth；
- 认证载体是浏览器会话 cookies（`SAPISID`、`__Secure-1PSID` 等），不是 `access_token`；
- Google 不会为第三方应用颁发访问 NotebookLM 私有 RPC 的 OAuth 范围。

结论：CLIProxyAPI 的 OAuth callback 结构与我们的认证模型根本不兼容，不可照搬。

### 为什么不做 VNC / 远程浏览器

让服务器跑 VNC、noVNC、或容器内安装 Chrome + 远程桌面，只是把"弹浏览器"的问题推迟了一层：用户还是要连进去手动操作，但基础设施复杂度大幅增加（安全面暴露、镜像体积、维护成本）。

这不是用户体验问题的正确解，是绕开问题的过重方案。

### 设计立场："本机授权，远程接收"

**核心原则：** 登录动作永远发生在用户本机；远程服务只负责安全接收、验证、并激活凭据。

```
用户本机                         远程服务
  │                                  │
  │  npx notebooklm login            │
  │  → Google 登录 (浏览器)          │
  │  → 写入 ~/.notebooklm/           │
  │    storage-state.json            │
  │                                  │
  │  打开认证管理页面                 │
  │  上传 storage-state.json ────────▶ 接收文件
  │                                  │ 验证 cookies（含 SAPISID）
  │  ◀─── 实时显示验证结果 ──────────┤ 写入服务端 profiles/default/
  │                                  │ 更新 auth-meta → ready
```

### MVP 方案（管理员上传凭据）

**适用场景：** 管理员自己维护服务，熟悉命令行，愿意手动操作。

**流程：**
1. 管理员在本机运行 `npx notebooklm login`，完成 Google 登录后，本机生成 `~/.notebooklm/storage-state.json`。
2. 管理员登录服务后台（已有 admin auth 机制）。
3. 在 **认证管理页面**（`/settings/accounts`，已实现骨架）新增上传区域：
   - 支持两种方式：直接上传 `.json` 文件 / 粘贴 base64 或 JSON 文本。
   - 上传后立即调用后端验证接口。
4. 后端 `POST /api/auth/accounts/:accountId/upload-state`：
   - 解析上传的 JSON，验证是否包含 `SAPISID` cookie。
   - 验证通过：写入 `profiles/default/storage-state.json`，更新 auth-meta 为 `ready`。
   - 验证失败：返回具体错误（缺少字段、cookie 格式错误等）。
5. 前端实时显示验证结果（成功/失败/错误详情）。

**页面新增元素：**
- 当前 auth 状态 `missing` / `expired` 时，在卡片内显示"上传凭据"操作区。
- 文件拖拽区 + "或粘贴 JSON 文本"的 textarea，两种输入互斥，取最后一次操作。
- 提交按钮："验证并激活"。
- 结果区域：成功显示绿色"凭据已激活，状态：已登录"+ 过期时间估算（基于 cookie max-age 计算）；失败显示红色错误提示和排查指引。

**后端新增接口（MVP）：**
```
POST /api/auth/accounts/:accountId/upload-state
  body: { storageState: string }   // JSON 字符串
  200: { message: string; expiresAt?: string }
  400: { error: string; detail?: string }
  409: { error: "login_in_progress" }
```

### 下一阶段方案（一次性会话 / 短链上传）

**适用场景：** 把登录授权委托给非管理员的普通用户，或希望减少管理员手动操作。

**核心思路：** 管理员在后台生成一个有时效的临时上传会话（token），用户凭 token 访问一个受保护的简单上传页面，完成上传后页面自动失效，后台实时感知。

**流程：**
1. 管理员在认证管理页面点击"生成授权链接"。
2. 后端创建一次性 upload session：
   - 生成 `sessionId`（UUID）+ `expiresAt`（15 分钟）。
   - 存入内存或 SQLite（`auth_upload_sessions` 表）。
   - 返回链接：`https://your-server/auth/upload/:sessionId`。
3. 管理员把链接发给目标用户（或自己用）。
4. 用户在本机完成 `npx notebooklm login`，打开链接，上传 `storage-state.json`。
5. 后端验证 session 有效 + 文件合法，激活凭据，session 标记为已使用。
6. 管理员后台页面通过轮询或 SSE 实时看到状态变为"已登录"。

**数据模型（下一阶段，不进入 MVP）：**
```typescript
// auth_upload_sessions
{
  id: string;           // UUID，URL 中暴露的 token
  accountId: string;
  expiresAt: string;    // ISO 8601
  usedAt: string | null;
  createdBy: string;    // admin session id
}
```

**此方案的前置条件：**
- 服务有可对外暴露的 HTTPS 地址（用户可访问）。
- 后台已有 admin 认证机制（否则任何人都能生成 token，安全漏洞）。
- 若要"实时更新"，后端需支持 SSE 或 WebSocket；否则用前端轮询降级。

### 远程登录 UX 细节要求

无论 MVP 还是下一阶段，页面需要满足以下 UX 标准：

**用户在本机完成登录时的引导：**
- 页面提供可复制的命令行指引（`npx notebooklm login`），并说明该命令在本机运行，不在服务器上运行。
- 说明登录后文件的位置（`~/.notebooklm/storage-state.json` / Windows 对应路径）。
- 提供"如何找到这个文件"的折叠说明（不要默认展开，避免干扰有经验的用户）。

**上传与验证过程的状态反馈：**
- 上传中：按钮 loading 状态 + "验证中…"文字，禁止重复提交。
- 验证成功：绿色提示，显示"已激活，预计有效期至 [日期]"（基于 cookie `expires` 字段计算）。
- 验证失败：红色提示，具体说明哪个 cookie 缺失或格式错误，附上重新登录的建议步骤。
- 网络错误：区分网络错误与验证失败，给出不同提示。

**状态过期的主动提示：**
- 认证管理页面轮询时，若状态从 `ready` 变为 `expired`，主动在页面顶部显示警告横幅，不等用户刷新。

**文字语气：**
- 所有提示使用第一人称引导语气（"请在本机运行…"而不是"用户应运行…"）。
- 错误提示不出现技术术语堆砌，给出明确的下一步行动。

### 坑与注意事项

1. **`storage-state.json` 包含敏感 Google 会话 cookie**，上传接口必须在 admin auth 保护下，绝不能公开暴露。下一阶段的临时 token 方案也必须有短有效期（建议 ≤ 15 分钟）且一次性使用。
2. **cookie 有效期不固定**，`SAPISID` 通常数小时至几天不等，无法精确预测。页面显示"预计有效期"时需加"约"字，避免误导用户。
3. **`storage-state.json` 上传后需要同时清除本机已填充的 `browser-user-data/`**（如果远程服务此前曾使用 headed 登录），否则 `refreshWithPersistentProfile()` 会用旧的 profile 覆盖新 cookie，导致状态不一致。上传接口应记录此副作用并在操作日志中体现。
4. **同一账号同时存在"等待 headed 登录"和"上传 storage-state"两条路径**，后端需要协调：若 `loginInProgress` 为真，则拒绝上传（返回 409）；反之亦然。
5. **base64 输入路径**：部分用户可能更习惯复制粘贴而非上传文件，提供 textarea 时需要限制最大长度（`storage-state.json` 正常不超过 50KB），超出时提示错误。
6. **Windows 路径**：本机文件位于 `%USERPROFILE%\.notebooklm\storage-state.json`，页面引导文字需同时说明 macOS/Linux 和 Windows 路径，不能只写 `~/`。

### 待办

- [ ] 后端新增 `POST /api/auth/accounts/:accountId/upload-state` 接口（MVP）
- [ ] `AccountsView.vue` 新增上传凭据区块（文件上传 + JSON 粘贴两种输入）
- [ ] 上传成功后展示有效期估算（解析 cookie `expires` 字段）
- [ ] 上传接口与 `loginInProgress` 状态互斥协调
- [ ] （下一阶段）`auth_upload_sessions` 数据表 + 一次性 token 生成接口
- [ ] （下一阶段）临时上传页面（无需完整 admin auth，只需有效 session token）
- [ ] （下一阶段）管理员后台 SSE 或轮询实时感知上传完成

### 实施任务

本节细化 MVP 所需的最小实施任务，可直接拆给 implementer 子代理。

**任务 A：后端新增凭据上传接口**

文件：`server/src/routes/auth/index.ts`

意图：新增 `POST /api/auth/accounts/:accountId/upload-state`，接收 `{ storageState: string }` JSON 请求体（`storageState` 为 storage-state.json 的字符串内容），执行以下步骤：
1. 用 `JSON.parse` 解析，失败时返回 400（"不是有效的 JSON"）。
2. 从 `cookies` 数组中找 `name === "SAPISID"` 的条目，不存在则返回 400（"缺少必要的 SAPISID cookie，请重新运行 npx notebooklm login"）。
3. 若 `loginInProgress.has(accountId)`，返回 409（"已有登录流程进行中，请等待完成"）。
4. 写入 `profiles/:accountId/storage-state.json`（调用 `writeFileSync`）。
5. 更新 auth-meta 为 `ready`（调用 `writeAuthMeta`）。
6. 返回 200 `{ message: "凭据已激活", expiresAt: <cookie expires 字段，若有> }`。

响应类型：
```typescript
// 200
{ message: string; expiresAt?: string }
// 400
{ error: string }
// 409
{ error: string }
```

**任务 B：前端 API 客户端新增 `uploadStorageState` 方法**

文件：`client/src/api/client.ts`

新增：
```typescript
uploadStorageState(accountId: string, storageState: string): Promise<{ message: string; expiresAt?: string }>
// → POST /api/auth/accounts/:accountId/upload-state
// body: { storageState }
```

**任务 C：`AccountsView.vue` 新增上传凭据 UI 区块**

文件：`client/src/views/AccountsView.vue`

在账号卡片内，当 `account.status !== "ready"` 时，卡片底部展开上传区：
- 折叠说明（`<details>`）：说明本机登录步骤和文件路径（macOS/Linux + Windows 两个路径）。
- 文件拖拽 / 点击上传区（`<input type="file" accept=".json">`），选择文件后读取为文本。
- 或：`<textarea>` 粘贴 JSON 文本（最大 50KB，超出提示错误）。
- 两种输入互斥（最后一次操作优先，另一种清空）。
- "验证并激活"按钮：调用 `api.uploadStorageState(accountId, text)`，loading 期间禁用。
- 结果区域：成功 → 绿色文字；失败 → 红色文字 + 具体原因。
- 视觉风格延续现有"仿书页/档案页"方向，不引入新的颜色系统。

---

## 变更历史

| 日期 | 变更 |
|------|------|
| 2026-04-19 | 新增"远程部署场景下的友好登录方案"设计章节：明确"本机授权，远程接收"立场，说明为何不能照搬 CLIProxyAPI OAuth callback、为何不做 VNC；细化 MVP（管理员上传凭据）和下一阶段（一次性 token 短链）两种方案；补充 UX 细节要求、坑与注意事项、待办清单，以及可直接拆给实施代理的任务 A/B/C。 |
