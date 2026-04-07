# NotebookLM 认证自动刷新实施计划

> **面向智能体工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实施此计划。步骤使用复选框（`- [ ]` / `- [x]`）跟踪进度。

**当前状态：** 进行中

**目标：** 为 NotebookLM 增加一个单账号认证子系统，支持持久化专用浏览器 profile、后台自动刷新认证、认证失败时强制刷新并重试一次，并向前端返回明确的认证状态，而不是泄露原始 `500`。

**架构：** 保留当前 NotebookLM SDK 集成，但将认证拆分为“持久化 profile 层”和“可丢弃的运行时 client 层”。在服务端新增 auth manager，统一管理 profile 路径、认证元数据、刷新协调以及运行时 client 失效。路由层通过 manager 获取认证能力，而不是继续直接信任 `storage-state.json` 或长生命周期缓存的 SDK 实例。

**技术栈：** Node.js + TypeScript、Hono、`notebooklm-kit`、`~/.notebooklm/` 本地文件系统、现有 Vue 前端认证状态消费者。

---

## 当前进度

- [x] 已创建隔离 worktree：`.worktrees/auth-auto-refresh`
- [x] 已建立 `auth-profile` 磁盘模型与测试
- [x] 已建立 `auth-manager` 状态机骨架与测试
- [x] 已将 `client.ts` 改为经由 auth manager 管理运行时 client
- [x] 已把 `/api/auth/status` 升级为显式状态模型
- [x] 已把 notebook 路由中的不可恢复认证失败转换为显式 `401`
- [x] 已更新前端 `AuthStatus` 类型与首页状态提示
- [x] 已完成基于持久化 `browser-user-data` 的真实静默刷新主流程
- [ ] 尚未补齐所有手工认证生命周期验证
- [ ] 尚未按任务粒度提交 commit

---

## 范围确认

本计划仅覆盖单账号 MVP。

包含：

- `default` 账号的持久化认证 profile
- 后台健康检查与刷新
- 请求侧强制刷新与一次重试
- 显式认证状态模型与 `/api/auth/status` 升级
- 将 NotebookLM 认证失败从原始 `500` 转换为明确的 `401`

不包含：

- 多账号并发执行
- 云端托管浏览器 worker
- 保证绕过 Google 2FA / 风控挑战
- 替换 `notebooklm-kit` 内部实现

---

## 文件结构

### 后端

- 新建：`server/src/notebooklm/auth-profile.ts`
  - 文件系统路径助手与持久化 profile 元数据读写
- 新建：`server/src/notebooklm/auth-profile.test.ts`
  - profile 路径与元数据行为单测
- 新建：`server/src/notebooklm/auth-manager.ts`
  - 负责认证状态流转、刷新流程、single-flight 协调与运行时 client 生命周期
- 新建：`server/src/notebooklm/auth-manager.test.ts`
  - 负责刷新协调、失败阈值、缓存失效等单测
- 修改：`server/src/notebooklm/client.ts`
  - 不再直接持有长生命周期 auth 状态，改为消费 auth manager
- 修改：`server/src/notebooklm/index.ts`
  - 导出新的 auth manager 能力与新的认证状态类型
- 修改：`server/src/routes/auth/index.ts`
  - 返回更丰富的认证状态
- 修改：`server/src/routes/notebooks/index.ts`
  - 将 NotebookLM 认证失败转换为 `401`，并复用共享的 auth-aware 请求流
- 修改：`server/src/index.ts`
  - 服务启动时启动后台 auth 健康检查

### 前端

- 修改：`client/src/api/client.ts`
  - 更新认证状态类型
- 可能修改：`client/src/views/HomeView.vue`
  - 如果该处已经消费认证状态，则显示显式状态
- 修改：当前所有认证状态消费者
  - 显式解释 `ready`、`refreshing`、`reauth_required`、`error`

---

### 任务 1：增加持久化认证 Profile 存储模型

**文件：**
- 新建：`server/src/notebooklm/auth-profile.ts`
- 测试：`server/src/notebooklm/auth-profile.test.ts`

- [x] **步骤 1：定义持久化 profile 布局与元数据结构**

伪代码：

```text
base = ~/.notebooklm/profiles/default/

profile files:
  browser-user-data/
  storage-state.json
  auth-meta.json

auth-meta:
  accountId
  status
  lastCheckedAt
  lastRefreshedAt
  error
```

要求：

- MVP 中账号 id 固定为 `default`
- 不向仓库工作区写入任何认证文件

- [x] **步骤 2：补充 profile helper 能力**

伪代码：

```text
getProfilePaths(accountId)
ensureProfileDirectories(accountId)
readAuthMeta(accountId)
writeAuthMeta(accountId, meta)
readStorageState(accountId)
writeStorageState(accountId, storageState)
```

要求：

- 缺失文件应映射为 `missing`，而不是通用异常
- 路径 helper 必须可预测、可测试

- [x] **步骤 3：为路径与元数据行为增加单测**

测试用例：

- 正确解析 `default` profile 路径
- 元数据不存在时返回 `missing`
- 认证元数据读写可回环
- 非法元数据返回显式错误状态

- [x] **步骤 4：运行定向验证**

执行：

- `node --import tsx --test src/notebooklm/auth-profile.test.ts`
- `npm run build --workspace server`

期望：

- 测试通过
- server 构建通过

- [ ] **步骤 5：提交**

```bash
git add server/src/notebooklm/auth-profile.ts server/src/notebooklm/auth-profile.test.ts
git commit -m "feat: add persisted notebook auth profile model"
```

---

### 任务 2：增加 Auth Manager 状态机与刷新协调

**文件：**
- 新建：`server/src/notebooklm/auth-manager.ts`
- 新建：`server/src/notebooklm/auth-manager.test.ts`
- 修改：`server/src/notebooklm/index.ts`

- [x] **步骤 1：定义运行时认证状态模型**

伪代码：

```text
AuthState =
  missing
  ready
  refreshing
  expired
  reauth_required
  error
```

要求：

- `ready` 表示最近一次校验通过，不等于“文件存在”
- 状态模型字段必须与批准规范一致

- [x] **步骤 2：定义 auth manager 职责**

伪代码：

```text
getAuthProfileStatus(accountId)
initAuthProfile(accountId)
refreshAuthProfile(accountId, reason)
invalidateAuthClient(accountId)
getAuthenticatedSdkClient(accountId)
startAuthHealthMonitor(accountId)
```

要求：

- 对外 API 保持 `accountId` 维度，但 MVP 中统一传 `default`
- 运行时 client 缓存应由 auth manager 持有，而不是 `client.ts`

- [x] **步骤 3：增加 single-flight 刷新与失败阈值策略**

伪代码：

```text
if refresh already running:
  await existing refresh promise

if recent failures exceed threshold within cooldown window:
  return reauth_required

else:
  mark refreshing
  attempt silent refresh
  update auth-meta
  resolve waiting callers
```

要求：

- 多个并发刷新触发必须合并为一次刷新操作
- 连续失败不能无限自旋

- [x] **步骤 4：增加刷新协调单测**

测试用例：

- 并发刷新调用共享同一个 in-flight promise
- 刷新成功后状态变为 `ready`
- 连续失败最终进入 `reauth_required`
- 运行时 client 失效后缓存会被清空

- [x] **步骤 5：运行定向验证**

执行：

- `node --import tsx --test src/notebooklm/auth-manager.test.ts`
- `npm run build --workspace server`

期望：

- 测试通过
- server 构建通过

- [ ] **步骤 6：提交**

```bash
git add server/src/notebooklm/auth-manager.ts server/src/notebooklm/auth-manager.test.ts server/src/notebooklm/index.ts
git commit -m "feat: add notebook auth manager with refresh coordination"
```

---

### 任务 3：将 NotebookLM Client 构建迁移到 Auth Manager 后面

**文件：**
- 修改：`server/src/notebooklm/client.ts`
- 修改：`server/src/notebooklm/index.ts`

- [x] **步骤 1：将底层 NotebookLM helper 与 auth 持有职责拆开**

伪代码：

```text
保留 helper:
  统一 source/detail/message 结构
  从 cookie header 提取 auth token

移除职责:
  长生命周期 sdkInstance 持有
  直接把 storage-state 作为最终认证真相
```

要求：

- `client.ts` 重新回到较低层 gateway 模块定位
- client 何时创建/销毁由 auth manager 决定

- [x] **步骤 2：定义运行时 client 获取流程**

伪代码：

```text
getAuthenticatedSdkClient(default):
  if runtime client cached and still valid -> return it
  else:
    load latest storage-state from profile
    fetch auth token
    build NotebookLMClient
    connect client
    cache runtime client
    return client
```

- [x] **步骤 3：运行定向验证**

执行：

- `npm run build --workspace server`

期望：

- server 构建通过
- notebook gateway 已能基于新的 auth manager 接口编译通过

- [ ] **步骤 4：提交**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "refactor: route notebook sdk client creation through auth manager"
```

---

### 任务 4：增加后台健康检查与静默刷新流程

**文件：**
- 修改：`server/src/notebooklm/auth-manager.ts`
- 修改：`server/src/index.ts`

- [x] **步骤 1：定义后台健康检查生命周期**

伪代码：

```text
on server startup:
  start monitor for account default

monitor loop:
  every N interval
    check auth health
    if degraded and recoverable:
      refresh silently
    if unrecoverable:
      mark reauth_required
```

要求：

- 轮询必须足够轻量
- 后台检查不能产生重叠刷新操作

- [x] **步骤 2：定义静默刷新行为**

伪代码：

```text
silent refresh:
  launch browser context with browser-user-data
  try access notebooklm/google
  export latest storage-state
  refresh auth-meta
  invalidate runtime client
```

要求：

- 静默刷新必须复用持久化浏览器 user data
- 碰到明确 challenge 流时，返回 `reauth_required`，不能自旋

当前结果：

- 已接入后台 monitor 和请求侧 refresh orchestration
- 已通过 `launchPersistentContext(browser-user-data)` 复用持久化浏览器 profile
- 已在刷新后重新导出 `storage-state.json` 并重新提取 token
- 保留 `RefreshClient` 作为持久化浏览器刷新失败时的回退路径

- [x] **步骤 3：运行定向验证**

执行：

- `npm run build --workspace server`

手工验证：

- 使用已初始化 profile 启动服务
- 确认 monitor 启动不会导致服务启动崩溃

当前结果：

- server 编译通过
- monitor 已在启动入口接入
- 真实手工生命周期验证尚未完成

- [ ] **步骤 4：提交**

```bash
git add server/src/notebooklm/auth-manager.ts server/src/index.ts
git commit -m "feat: add background notebook auth health monitor"
```

---

### 任务 5：增加请求侧强制刷新与一次重试

**文件：**
- 修改：`server/src/notebooklm/client.ts`
- 修改：`server/src/notebooklm/auth-manager.ts`
- 修改：`server/src/routes/notebooks/index.ts`

- [x] **步骤 1：定义 auth-aware 请求包装器**

伪代码：

```text
runNotebookRequest(operation):
  try operation with authenticated client
  if auth failure:
    invalidate runtime client
    force refresh
    retry operation once
  if retry fails with auth issue:
    raise explicit auth error
```

要求：

- 每个请求最多自动重试一次
- 仅对可识别的认证失败进行自动重试

- [x] **步骤 2：将包装器应用到 notebook 操作**

已覆盖操作：

- notebook detail
- notebook list
- source list
- notebook ask/chat
- access check

要求：

- 路由层保持轻量，重试策略应位于路由层以下

- [x] **步骤 3：将认证失败转换为显式路由响应**

伪代码：

```text
if auth manager returns reauth_required or refresh_failed:
  return 401 with explicit errorCode
else:
  preserve existing non-auth error behavior
```

- [x] **步骤 4：运行定向验证**

执行：

- `node --import tsx --test src/notebooklm/client.refresh.test.ts src/routes/notebooks/index.test.ts`
- `npm run build --workspace server`

手工验证：

- 模拟过期 runtime client
- 确认首次请求会触发 refresh 与重试
- 确认不可恢复认证返回 `401` 而不是原始 `500`

当前结果：

- 路由测试已覆盖“401 后清缓存重连”和“不可恢复 auth 返回 401”
- 新增测试已覆盖“复用 browser-user-data 并导出最新 storage-state”
- server 构建通过

- [ ] **步骤 5：提交**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/auth-manager.ts server/src/routes/notebooks/index.ts
git commit -m "feat: retry notebook requests after auth refresh"
```

---

### 任务 6：将 `/api/auth/status` 升级为真实认证状态

**文件：**
- 修改：`server/src/routes/auth/index.ts`
- 修改：`server/src/notebooklm/index.ts`
- 修改：`client/src/api/client.ts`

- [x] **步骤 1：定义新的 auth status 响应结构**

伪代码：

```text
AuthStatusResponse:
  accountId
  status
  lastCheckedAt
  lastRefreshedAt
  error
```

要求：

- 替换旧的布尔 `authenticated` 模型
- 字段名与批准规范保持一致

- [x] **步骤 2：将 `/api/auth/status` 连接到 auth manager**

伪代码：

```text
GET /api/auth/status:
  return getAuthProfileStatus(default)
```

- [x] **步骤 3：更新前端认证状态消费者类型**

伪代码：

```text
client api AuthStatus:
  停止使用 authenticated/storageStateExists/cookieCount
  改用显式 status enum
```

- [x] **步骤 4：运行定向验证**

执行：

- `npm run build --workspace server`
- `npm run build --workspace client`

期望：

- 两端构建通过
- 前端已经基于新的 auth status 结构编译通过

- [ ] **步骤 5：提交**

```bash
git add server/src/routes/auth/index.ts server/src/notebooklm/index.ts client/src/api/client.ts
git commit -m "feat: expose explicit notebook auth status states"
```

---

### 任务 7：增加前端认证 UX，覆盖刷新中与需重新登录状态

**文件：**
- 修改：当前认证状态消费者视图
- 大概率修改：`client/src/views/HomeView.vue`
- 如工作台入口消费认证状态，也可一并修改

- [x] **步骤 1：识别当前 auth status 消费者**

伪代码：

```text
find all uses of api.getAuthStatus()
map each place to one of:
  passive display
  gating behavior
  startup check
```

要求：

- 不要假设只有 HomeView 消费状态
- UI 文案简短、明确

- [x] **步骤 2：定义各状态的 UI 行为**

伪代码：

```text
ready -> no warning
refreshing -> show light notice
reauth_required -> show explicit relogin CTA
error -> show failure message
missing -> show setup/login required message
```

- [x] **步骤 3：运行定向验证**

执行：

- `npm run build --workspace client`

手工验证：

- 确认 UI 能区分 `refreshing` 与 `reauth_required`

当前结果：

- client 构建通过
- HomeView 已显示显式状态提示
- 手工界面验证尚未完成

- [ ] **步骤 4：提交**

```bash
git add client/src/views/HomeView.vue
git commit -m "feat: surface notebook auth refresh states in ui"
```

---

### 任务 8：端到端验证与回归检查

**文件：**
- 不要求新增源码文件，除非需要记录验证说明

- [x] **步骤 1：运行完整构建验证**

执行：

- `npm run build`

期望：

- monorepo 构建通过

- [x] **步骤 2：运行服务端 auth 测试**

执行：

- `node --import tsx --test src/notebooklm/auth-profile.test.ts src/notebooklm/auth-manager.test.ts src/notebooklm/client.refresh.test.ts src/routes/notebooks/index.test.ts`

期望：

- auth 相关单测通过

- [ ] **步骤 3：执行手工认证生命周期检查**

手工清单：

- 首次 profile 初始化可用
- 服务重启后仍能保留登录态
- 过期 runtime client 可自动恢复
- 不可恢复会话能产生 `reauth_required`
- notebook 接口在不可恢复 auth 失败时返回 `401` 而不是原始 `500`

- [ ] **步骤 4：提交**

```bash
git add .
git commit -m "test: verify notebook auth auto-refresh flow"
```

---

## 自检

- 规范覆盖：计划已经覆盖持久化 profile 存储、认证状态模型、后台 monitor、请求重试、路由行为和前端认证状态消费。
- 占位符检查：实现指导仍以伪代码和任务步骤表达，没有把细节偷渡成未验证承诺。
- 类型一致性：`default`、`reauth_required`、`refreshing`、`lastCheckedAt`、`lastRefreshedAt` 在任务描述中保持一致。
