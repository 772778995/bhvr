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
