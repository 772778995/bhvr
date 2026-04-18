# NotebookLM 认证自动续期与持久化 Profile 设计

**当前状态：** 已完成

## 设计结论

单账号先落地，认证真相以持久化 profile 为准，运行时 client 只做可丢弃快照。

## 目标

为当前 NotebookLM 集成增加一个单账号 MVP 认证子系统，使服务在大多数会话过期场景下可以自动恢复，无需用户再次输入账号密码，并为未来多账号扩展预留清晰边界。

本设计的目标不是替换 NotebookLM SDK，而是在现有 `storage-state.json + SNlM0e token + NotebookLMClient` 模型之上，补齐持久化浏览器身份、后台保活、请求兜底刷新、以及明确的认证状态返回。

## 背景与当前问题

当前实现位于 `server/src/notebooklm/client.ts`，核心行为如下：

- 从 `~/.notebooklm/storage-state.json` 读取 cookies
- 请求 `https://notebooklm.google.com/` 提取 `SNlM0e` token
- 构造并缓存进程内 `sdkInstance`
- `getAuthStatus()` 仅检查本地 cookie 文件存在与 cookie 数量

当前问题有四个：

1. `getAuthStatus()` 把“认证文件存在”误判成“认证可用”
2. 进程内 `sdkInstance` 是长期缓存，重新登录后可能仍持有旧 cookies/token
3. 业务请求撞上过期时，常常直接表现成裸 `500`
4. 当前模型只有一个 `storage-state.json` 文件，不适合后续扩展多账号

## 范围

本设计覆盖：

- 单账号 MVP 的持久化认证 profile
- 自动静默续期机制
- 后台保活与请求侧兜底重试
- 服务端统一认证状态模型
- 前端认证错误呈现规则
- 为未来多账号预留接口

本设计不覆盖：

- 多账号并发调度
- 云端托管浏览器
- 绕过 Google 2FA / 风控 / 设备验证
- 改写 NotebookLM SDK 内部协议

## 设计原则

- 单账号先落地，但边界按未来多账号方式设计
- 持久化浏览器 profile 是长期身份来源
- 运行时 SDK client 只是短期快照，随时可销毁重建
- 后台保活和请求兜底同时存在
- 对前端暴露明确认证状态，不再返回模糊 `500`
- 遇到真正无法静默恢复的 Google 风控场景，明确退化为人工重新登录

## 总体架构

认证系统拆成两层。

### 1. 持久化浏览器身份层

服务维护一个专用浏览器 profile 目录，由程序自己管理并长期复用。该 profile 保存 Google/NotebookLM 登录态，作为认证恢复的长期来源。

在单账号 MVP 中，系统只维护一个逻辑账号槽位：`default`。

### 2. 运行时认证快照层

每次服务真正访问 NotebookLM 时，不再把进程内 `sdkInstance` 视为长期可信状态，而是把它当成基于当前 profile 快照构造出来的临时客户端。

当出现 `401`、`expired`、token 提取失败、或显式失效信号时：

- 销毁当前运行时 client
- 从持久化 profile 重新刷新 cookies/token
- 重建可用的 SDK client

## 存储结构

专用 profile 使用目录化结构，哪怕当前只有一个账号，也按可扩展结构组织：

```text
~/.notebooklm/
  profiles/
    default/
      browser-user-data/
      storage-state.json
      auth-meta.json
```

各文件职责如下：

- `browser-user-data/`
  - 持久化浏览器 profile
  - 保存 Google/NotebookLM 登录上下文
- `storage-state.json`
  - 当前导出的 cookies 快照
  - 供运行时 NotebookLM SDK 使用
- `auth-meta.json`
  - 保存认证状态、最近校验时间、最近刷新时间、最近错误、账号元信息

单账号 MVP 下，所有读写只针对 `profiles/default`。

## 状态模型

认证状态统一为以下几类：

- `missing`
  - 没有 profile，尚未初始化登录
- `ready`
  - profile 存在，最近校验成功，可正常访问 NotebookLM
- `refreshing`
  - 系统正在静默刷新认证
- `expired`
  - 当前会话不可用，但仍有机会通过静默刷新恢复
- `reauth_required`
  - 静默恢复失败，需要人工重新登录
- `error`
  - 认证系统内部异常，例如 profile 损坏、浏览器自动化失败、状态文件损坏

`ready` 不是“文件存在”，而是“最近一次真实认证校验成功”。所有状态均为**持久化快照**，由后台保活器或请求兜底链路写入 `auth-meta.json` 并缓存在内存中；读取状态时不会对 NotebookLM 发实时探针。因此 `reauth_required` 信号是可靠的（检测到失效后即写入），但 `ready` 表示“上次已知可用”，不是实时 SLA 保证——两次保活心跳之间，外部 Google 会话可能已在服务侧未知的情况下失效。

## 刷新机制

刷新机制由两条链路组成，并且同时存在。

### 1. 后台保活链路

服务启动后，启动一个轻量的认证保活器，按固定周期对当前账号执行健康检查。

健康检查包括：

- 能否从持久化 profile 恢复 cookies
- 能否访问 NotebookLM 首页并提取 `SNlM0e`
- 必要时做一次轻量可访问性校验

行为规则：

- 校验成功：状态为 `ready`
- 校验失败但可恢复：进入 `refreshing`
- 连续多次失败：进入 `reauth_required`

后台保活的目标是尽量不让业务请求直接撞上过期。

### 2. 请求兜底链路

任意 NotebookLM 业务请求一旦命中以下错误之一：

- `401`
- `expired`
- token 提取失败
- 明确的认证不可用错误

系统不直接把错误抛给业务路由，而是执行：

1. 标记当前运行时 client 失效
2. 触发一次强制刷新
3. 刷新成功后自动重建 client
4. 对当前业务请求自动重试一次

如果重试仍失败，则向调用方返回明确认证错误。

## 并发与保护机制

为避免并发请求同时触发多次刷新，系统必须实现单飞刷新机制。

### 单飞刷新

同一账号在同一时刻只允许一个刷新任务执行。

如果多个请求同时发现认证失效：

- 第一个请求发起刷新
- 其他请求等待该刷新任务结果
- 刷新成功后共享结果继续执行
- 刷新失败后统一收到失败结果

### 冷却与失败阈值

为避免死循环和风控，系统需要：

- 对连续失败设置短冷却窗口
- 记录失败次数
- 达到阈值后，将状态设置为 `reauth_required`

一旦进入 `reauth_required`，系统不再无穷重试，而是要求人工重新登录。

## 登录入口设计

登录入口分为两类。

### 1. 初始化登录

用于首次建立 `default` profile。

流程：

- 启动带有专用 `browser-user-data/` 的浏览器上下文
- 用户完成一次 Google / NotebookLM 登录
- 登录成功后导出 `storage-state.json`
- 写入 `auth-meta.json`
- 将状态置为 `ready`

### 2. 静默刷新

用于后台保活或请求兜底。

流程：

- 复用已有 `browser-user-data/` 启动浏览器上下文
- 尝试无人工交互访问 Google / NotebookLM
- 重新导出最新 cookies 到 `storage-state.json`
- 重新提取 `SNlM0e`
- 更新 `auth-meta.json`
- 刷新运行时 client

如果 Google 主登录态仍有效，这个流程通常可以静默成功。

如果 Google 触发以下情况，系统不能保证静默成功：

- 2FA
- 设备确认
- 异地风险验证
- 明确要求重新输入密码

此时状态必须转为 `reauth_required`。

## 未来多账号扩展边界

虽然当前只支持单账号 MVP，但系统内部接口应按 `accountId` 维度组织。

推荐预留以下接口：

- `initAuthProfile(accountId)`
- `refreshAuthProfile(accountId, reason)`
- `getAuthProfileStatus(accountId)`
- `getAuthenticatedSdkClient(accountId)`
- `invalidateAuthClient(accountId)`

在当前 MVP 中：

- 业务层统一使用 `accountId = default`
- profile 目录只存在 `profiles/default`
- 不实现多账号并发调度

这样未来扩展多账号时，只需把默认常量替换成显式账号选择，不需要推翻现有认证架构。

## 服务端接口行为

### `/api/auth/status`

该接口必须从“文件存在检查”升级为“真实认证状态查询”。

返回内容至少应包括：

- `status`
- `lastCheckedAt`
- `lastRefreshedAt`
- `error`（如有）
- `accountId`

该接口不应再以 `authenticated: true/false` 这种二值形式表达复杂状态。

### Notebook 业务接口

所有依赖 NotebookLM 的业务接口都应遵守同一规则：

- 遇到认证失效时，先内部刷新并重试一次
- 如果仍失败，返回明确认证错误
- 不再向前端泄露裸 `500`

推荐认证失败结果统一返回：

- HTTP `401`
- 明确错误码，例如 `AUTH_REAUTH_REQUIRED`、`AUTH_REFRESH_FAILED`

## 前端表现

前端对认证状态分三级处理。

### 1. 自动恢复，不打扰用户

适用场景：

- 会话轻微过期
- token 失效但 profile 可恢复

表现：

- 前端无感
- 用户只看到请求稍慢，不需要重新登录

### 2. 轻提示

适用场景：

- 正在刷新认证
- 后台保活短时间连续失败但尚未进入 `reauth_required`

表现：

- 显示轻量提示，例如“正在恢复 NotebookLM 连接”
- 不阻塞页面主要交互

### 3. 明确要求重新登录

适用场景：

- `reauth_required`
- profile 损坏
- Google 明确要求再次人工验证

表现：

- 页面收到明确认证状态
- 显示清晰 CTA，提示用户重新登录 NotebookLM
- 不再展示模糊 500 或“加载失败”这类不透明错误

## 成功标准

该子项目完成后，应满足以下标准：

1. 服务重启后，通常无需再次输入账号密码
2. 大多数会话过期场景可自动恢复
3. 业务请求命中过期后，可自动刷新并重试一次
4. 前端不再因认证过期收到裸 `500`
5. 真正无法恢复时，前端收到明确重新登录信号
6. 当前单账号实现不阻碍后续多账号扩展

## 测试与验证策略

测试分三层。

### 1. 单元测试

覆盖：

- 认证状态机转换
- 单飞刷新逻辑
- 失败阈值与冷却逻辑
- client 失效后重建逻辑

### 2. 集成测试

覆盖：

- 模拟过期 cookies
- 业务请求触发刷新并自动重试
- 刷新失败时返回 `401` 和明确错误码
- `/api/auth/status` 返回真实状态而不是文件存在假阳性

### 3. 手动验证

验证路径：

- 首次初始化登录成功
- 重启服务后仍可访问 NotebookLM
- 人为制造旧 client 失效，请求可自动恢复
- 真正会话失效时，系统进入 `reauth_required`
- 前端正确展示“需要重新登录”而不是裸 `500`

## 风险与边界说明

这个方案能显著提高自动恢复能力，但不能承诺绝对静默成功。

原因在于：

- Google 账号体系和 NotebookLM 并非公开稳定 API
- notebooklm-kit 依赖逆向协议，Google 行为可能变化
- 2FA、设备验证、风控挑战是外部系统行为，无法在本项目中强行规避

因此本设计的承诺是：

- 在可恢复场景中尽量全自动
- 在不可恢复场景中快速、明确、可诊断地退化为人工重新登录

而不是承诺永远不需要人工干预。

## Docker / 服务器部署下的登录与保活策略

### 核心约束：服务器不能替代人工完成 Google 登录

NotebookLM 登录基于 Google 账号体系，本质是一个带有浏览器指纹、Cookie、2FA 等多因素的交互式 Web 会话。在无头服务器或 Docker 容器中，不存在可靠的方式自动完成完整的 Google 登录流程。尝试这一路径大概率会触发 Google 风控，导致账号被临时封禁或要求额外验证。

**与上文"登录入口设计"的关系：** 上文描述的"初始化登录"和"静默刷新"依赖持久化 `browser-user-data/` 目录，适用于有条件运行 Playwright 浏览器自动化的本地或受控环境。在 Docker / 无头服务器场景下，**不应依赖浏览器自动化**，而是采用本章节描述的纯 HTTP + Secret 注入路径。

**运维边界说明：** 本系统基于网页会话的非官方链路运行，不持有 Google 官方 API 密钥，无法承诺在所有 Google 安全策略变更下永久免人工维护。

### 推荐路径：本地一次人工登录 + Secret 注入

**推荐流程如下：**

1. **本地完成一次初始登录**

   在有浏览器的本地机器或受控环境中运行：

   ```bash
   npx notebooklm login
   ```

   登录成功后，Google 会话持久化在 `~/.notebooklm/storage-state.json` 中。

2. **将 `storage-state.json` 作为 Secret 注入部署环境**

   将文件内容注册为 Docker Secret 或平台 Secret（如 GitHub Actions Secret、Kubernetes Secret、Railway/Fly.io 的环境 Secret 等），在容器启动时将其挂载到预期路径：

   ```
   ~/.notebooklm/storage-state.json
   ```

   若平台不支持直接挂载文件，可将文件内容作为环境变量传入，在服务启动时写入上述路径。**注意：** 当前代码尚未实现对环境变量路径的读取，这是后续实现建议；约定的环境变量名可使用 `NOTEBOOKLM_STORAGE_STATE_PATH`，但该变量目前并不存在于项目中。

   **不要将 `storage-state.json` 提交到代码仓库。**

3. **运行时依赖现有 HTTP Token 刷新能力维持可用**

   服务启动后，通过 `storage-state.json` 中的 Cookies 请求 NotebookLM 首页，提取 `SNlM0e` token，完成运行时认证。这是纯 HTTP 链路，无需浏览器，只要 Google 会话仍然有效即可正常工作。

4. **接受会话终将失效的现实，依赖失效检测与人工再授权流程**

   Google 会话不会永久有效。失效时，系统需要能检测到这一事实，停止队列，告警，等待运维人员重新注入有效的 `storage-state.json`。

### 设计决策

**明确推荐：**

- 本地一次人工登录，获取有效的 `storage-state.json`
- 将该文件作为 Secret 注入 Docker / 服务器，而非硬编码或提交到仓库
- 系统在 `storage-state.json` 有效期内通过纯 HTTP 运作，不依赖浏览器自动化
- 会话失效后，系统进入 `reauth_required` 状态，任务队列暂停，等待人工重新提供凭据

**明确不推荐：**

- **不推荐将服务器自动化登录当作主路径。** 在无头服务器上试图自动完成 Google 完整登录流程，几乎必然触发风控，且无法处理 2FA、设备确认等挑战。这是一条无法稳定维护的路径。

- **不推荐依赖 keepalive / 定时 ping 来续命 Google 会话。** 向 NotebookLM 发送定时 ping 请求并不等同于刷新 Google 会话的有效期。Google 会话生命周期由 Google 服务端控制，伪活跃操作无法可靠地延长它。将系统可用性寄托在这一机制上是自欺欺人。

- **不推荐期望通过 OAuth / Service Account 解决 NotebookLM 登录。** NotebookLM 当前没有公开 API，也不接受 Service Account 或 OAuth Access Token。notebooklm-kit 使用的是逆向出来的 Google 内部 RPC 协议，依赖的是浏览器用户会话的 Cookies，与 OAuth 机制完全不兼容。

### 会话失效后的系统行为

当系统检测到 Google 会话已失效（`401`、token 提取失败、或多次健康检查失败），应执行以下流程：

1. **检测：** 认证状态转为 `reauth_required`，停止触发新的 NotebookLM API 调用。
2. **暂停队列：** Worker 停止从任务队列中取出新任务；正在进行中的任务若已命中认证错误，则将**研究任务状态**（非认证状态机状态）标记为 `paused`，不直接失败，以便会话恢复后可重新调度。`paused` 属于任务队列层，与上文认证状态模型（`reauth_required`、`ready` 等）属于不同层次。**不再使用 `auth_error` 作为独立任务状态**——失败原因通过 `failed` 状态附带的 `failureReason: "auth_failure"` 字段表达，仅用于超时的 `paused` 任务最终放弃时。
3. **告警：** 通过日志、指标或外部告警通道（如 webhook）发出明确信号，说明认证失效需要人工处理。
4. **人工再授权：** 运维人员在本地重新执行 `npx notebooklm login`，获取新的 `storage-state.json`，更新 Secret 并重启（或热重载）服务。
5. **恢复：** 服务读取新凭据，认证状态恢复为 `ready`，Worker 继续处理队列中的 `paused` 任务。

### Secret 注入方式参考

| 部署方式 | 推荐注入方法 |
|---|---|
| Docker Compose | `secrets:` 挂载或 bind mount 到容器内固定路径 |
| Kubernetes | `Secret` 资源挂载为文件或注入为环境变量 |
| Railway / Fly.io | 平台 Secret 注入为环境变量，服务启动时写入到临时文件路径 |
| GitHub Actions | `secrets` + 部署 step 中写入文件 |

无论哪种方式，`storage-state.json` 的文件内容不能出现在代码仓库中，也不能出现在构建日志里。

## 再授权与告警最小闭环设计

### 设计结论

不搞复杂通知平台，也不先做 UI 管理页面，先做最小闭环。最小闭环的目标是：让系统在认证失效时**可观测、可暂停、可恢复**，而不是把失败当普通业务错误闷头重试。

### 动机

上文"会话失效后的系统行为"已描述了检测 → 暂停 → 告警 → 人工再授权 → 恢复这条链路的语义，但缺少每个环节的具体实现决策，无法作为开发依据。本章节补充这些决策，形成可直接落地的最小闭环规格。

### 最小闭环四件事

以下四件事构成最小闭环，缺一不可：

#### 1. 健康检查暴露 auth 状态

`/api/health` 或等价健康接口必须包含认证状态，不能只返回 HTTP 200 掩盖已失明的服务。

**必须暴露的最关键 auth 信息：**

```json
{
  "auth": {
    "status": "ready | refreshing | expired | reauth_required | missing | error",
    "lastCheckedAt": "<ISO8601 时间戳，最近一次校验时间>",
    "reauthRequiredSince": "<ISO8601 时间戳，进入 reauth_required 的时间，仅该状态下存在>"
  }
}
```

`lastRefreshedAt`、`error` 详细信息等保留在 `/api/auth/status`，健康检查只暴露监控必需的最小字段。

**重要边界：** 健康检查不对 NotebookLM 发实时探针，返回的是内存中缓存的最新持久化状态。这意味着 `reauth_required` 是可靠的失效信号，但 `ready` 只代表"上次已知可用"，不是实时 SLA 保证。外部监控系统可通过 `auth.status !== "ready"` 判断服务"活着但已失明"。

#### 2. auth 路由提供受保护的人工再授权入口

当状态为 `reauth_required` 时，运维人员需要通过 API 提交新的 `storage-state.json` 来触发认证恢复，而不必重启服务。

**接口规格：**

- 路径：`POST /api/auth/reauth`
- 保护方式：`Authorization: Bearer <ADMIN_SECRET>` 请求头校验，`ADMIN_SECRET` 从环境变量读取；未配置 `ADMIN_SECRET` 时该接口返回 `503 Not Configured`，不允许无保护暴露
- 输入：请求体为 JSON，仅支持 base64 方式：
  - `{ "storageState": "<base64 编码的 storage-state.json 文件内容>" }`
  - 不支持本地路径输入——接受服务器本地路径会引入路径遍历风险，且在容器化部署中无实际必要
- 触发行为：
  1. 校验输入格式有效（JSON 可解析、包含 `cookies` 字段）
  2. 将新内容写入 profile 的 `storage-state.json`
  3. 触发运行时 client 重建（调用与"请求兜底链路"相同的刷新流程）
  4. 返回刷新后的认证状态；成功则 `status` 应为 `ready`

**注意事项：** 该接口不负责验证新凭据是否真正有效——它只负责写入并触发刷新；真实可用性由刷新流程的结果状态反映。不要在接口层做 NotebookLM 探活，避免接口响应超时。

#### 3. worker 在 `reauth_required` 时停止拉取新任务

**Worker 行为规则：**

- 每次取任务前，先检查认证状态
- 若状态为 `reauth_required` 或 `error`，本次轮询跳过取任务，写入结构化日志（level: warn，含 `authStatus` 字段），进入下一轮等待
- 不将认证失效当作普通任务失败处理，不触发业务级重试逻辑

**队列中已有任务的处理（明确推荐）：**

- 正在进行中的任务，若命中认证错误（`401` / token 提取失败），将任务状态置为 `paused`，不置为 `failed`
- `paused` 任务在认证状态恢复为 `ready` 后可被重新调度
- 不推荐直接置为 `failed`：认证失效是基础设施问题，不是任务本身的业务错误，直接失败会丢失用户已触发的研究请求
- 不推荐在 `reauth_required` 期间保留任务为 `running`：会造成进度误导和超时混乱

**认证恢复后 worker 的唤醒行为（明确推荐）：**

- 再授权接口成功刷新状态回到 `ready` 后，必须主动触发一次 worker 轮询唤醒，不能依赖下次定时轮询自然触发
- 推荐实现：再授权流程完成后发出内部事件（如 `auth:ready`），worker 监听该事件并立即执行一次取任务逻辑
- `paused` 任务恢复调度时，按原有 FIFO 顺序处理，不需要重新排序

#### 4. 进入 `reauth_required` 时发告警

**告警优先级与降级路径：**

- 优先：向配置的 webhook URL 发送 HTTP POST（JSON body，包含 `event: "reauth_required"`、`timestamp`、`service` 字段）
- 降级：如果未配置 webhook，输出结构化错误日志（level: error，含 `event: "reauth_required"`、`timestamp`、`authStatus` 字段）
- **不允许两条路径都不走**——告警是最小闭环的必要组成，沉默失败等于服务死掉外部看不见

**webhook 配置方式：** 从环境变量 `REAUTH_WEBHOOK_URL` 读取。未设置则降级为日志。不提供其他告警渠道（email、企业微信等），这些属于后续扩展。

**告警时机：** 状态首次进入 `reauth_required` 时触发一次，不在每次保活轮询失败时重复告警（避免告警风暴）。

### 故意不做的东西，及理由

| 不做的事 | 理由 |
|---|---|
| 复杂管理 UI 页面 | 再授权是低频运维操作，API 接口足够；UI 页面会引入大量前端状态管理和权限 UI 工作，投入产出不合理 |
| email / SMS / 企业微信等告警渠道 | webhook 可对接任意下游（如 Slack、PagerDuty、自建系统），无需在服务端集成各渠道 SDK |
| worker 在 `reauth_required` 时继续重试 | 继续重试会消耗 Google 会话配额、制造误导性日志、掩盖真正的认证问题；`reauth_required` 的语义就是"人工介入前不应继续" |
| 多账号告警路由 | 当前只有单账号 MVP，告警不需要区分账号维度 |
| 自动拉取新 `storage-state.json` | 拉取凭据的方式高度依赖部署环境（Secret Manager、Vault、文件挂载等），最小闭环不耦合具体凭据管理方案 |

### 坑与注意事项

- `ADMIN_SECRET` 未设置时再授权接口必须返回不可用，而不是退化为无保护开放——否则任何人都可以替换凭据
- webhook 发送失败不应阻塞认证状态机的流转；告警是通知渠道，不是认证流程的一部分
- `paused` 状态的任务重新调度时，应检查任务是否已超时（如创建时间过老），若超时则置为 `failed` 并附上 `auth_failure` 原因，而不是无限期保留 `paused`
- 健康检查接口不应做实时 NotebookLM 探活（网络 IO）——应读取内存或 `auth-meta.json` 中的缓存状态，避免健康检查本身成为慢查询

## 实施任务

本章节将最小闭环设计拆分为可独立交付的实施任务，每项任务包含涉及文件、意图和验收标准。

### 任务 1：健康检查暴露 auth 状态快照

**涉及文件：** `server/src/routes/health.ts`（或等价健康路由文件）、`server/src/notebooklm/client.ts`（提供状态读取接口）

**意图：** 让外部监控系统能通过 `/api/health` 感知认证状态，区分"服务活着但已失明"与"服务正常可用"两种情况。

**实现要点：**
1. 在 `/api/health` 响应中新增 `auth` 字段，包含 `status`、`lastCheckedAt`、`reauthRequiredSince`（仅 `reauth_required` 状态下存在）
2. auth 信息从内存缓存或 `auth-meta.json` 读取，**不发实时 HTTP 探针**
3. `status` 使用状态模型中定义的枚举值之一

**验收：**
- `/api/health` 返回 `auth.status` 字段，值为合法状态枚举
- 当认证状态为 `reauth_required` 时，`auth.reauthRequiredSince` 字段存在且为 ISO8601 时间戳
- 健康检查响应时间不受 NotebookLM 网络延迟影响

---

### 任务 2：受保护的人工再授权接口

**涉及文件：** `server/src/routes/auth.ts`、`server/src/notebooklm/client.ts`（提供 invalidate + reload 接口）

**意图：** 提供一个运维可用的热重载凭据入口，使运维人员无需重启服务即可更新 `storage-state.json` 并触发认证恢复。

**实现要点：**
1. 新增路由 `POST /api/auth/reauth`
2. 读取请求头 `Authorization: Bearer <token>`，与环境变量 `ADMIN_SECRET` 比对；不匹配返回 `401`；`ADMIN_SECRET` 未配置返回 `503 Not Configured`
3. 请求体格式：`{ "storageState": "<base64>" }`；base64 解码后校验为合法 JSON 且包含 `cookies` 字段；否则返回 `400`
4. 将解码后的内容写入 `~/.notebooklm/profiles/default/storage-state.json`
5. 调用运行时 client 的 invalidate + refresh 流程重建 SDK 实例
6. 触发内部 `auth:ready` 事件（供 worker 监听）
7. 返回刷新后的认证状态

**验收：**
- 未携带 token 时返回 `401`
- `ADMIN_SECRET` 未配置时返回 `503`
- 提交合法 base64 storageState 后，认证状态变为 `ready`（假设凭据有效）
- 提交损坏的 base64 或缺少 `cookies` 字段时返回 `400`

---

### 任务 3：worker 暂停与恢复

**涉及文件：** `server/src/worker/`（队列调度逻辑）、数据库 schema（任务状态枚举）

**意图：** 让 worker 在认证失效时安全暂停，在认证恢复后主动恢复，而不是闷头重试或永久卡死。

**实现要点：**
1. worker 每次取任务前检查认证状态；若为 `reauth_required` 或 `error`，跳过本次取任务并写结构化 warn 日志（含 `authStatus` 字段）
2. 正在执行中的任务若命中认证错误（`401` / token 提取失败），将任务状态置为 `paused`，不置为 `failed`
3. `paused` 任务在认证恢复后可重新调度；若任务创建时间超过配置阈值（建议默认 24 小时），置为 `failed` 并附 `failureReason: "auth_failure"`
4. worker 监听内部 `auth:ready` 事件，收到后立即触发一次取任务轮询，不等待定时器
5. 数据库 schema 新增 `paused` 状态枚举值；`failureReason` 作为可选字段而非独立状态

**验收：**
- 认证状态为 `reauth_required` 时，worker 不从队列取新任务，日志出现 warn 级别的 `authStatus` 记录
- 任务因认证错误中断后状态变为 `paused`，不变为 `failed`
- 再授权成功后，`paused` 任务被重新调度，不需要手动触发
- 超时的 `paused` 任务（超过阈值）自动置为 `failed` 并附 `failureReason`

---

### 任务 4：`reauth_required` 告警

**涉及文件：** `server/src/notebooklm/client.ts` 或认证状态机所在文件（状态转换处）、可选新增 `server/src/notebooklm/alert.ts` 封装告警逻辑

**意图：** 状态首次进入 `reauth_required` 时通知运维人员，使服务失明不会在沉默中被忽视。

**实现要点：**
1. 在认证状态机从非 `reauth_required` 转入 `reauth_required` 时触发告警（仅首次，不在每次保活失败时重复）
2. 读取环境变量 `REAUTH_WEBHOOK_URL`；若已配置，向该 URL 发送 HTTP POST，body 包含 `{ "event": "reauth_required", "timestamp": "<ISO8601>", "service": "<服务标识>" }`
3. 若 `REAUTH_WEBHOOK_URL` 未配置，写 error 级别结构化日志，包含相同字段
4. webhook 发送失败不阻塞状态机流转，错误单独记录

**验收：**
- 配置 `REAUTH_WEBHOOK_URL` 后，状态进入 `reauth_required` 时 webhook 收到 POST 请求
- 未配置时，日志中出现 error 级别含 `event: reauth_required` 的结构化日志
- 状态多次在 `reauth_required` 停留时，告警只触发一次（首次转入时）
- webhook 超时或失败不影响认证状态的后续流转

## 待办

以下条目是本设计尚未对应具体实现代码的方向，面向后续迭代：

- [ ] `server/src/notebooklm/client.ts`：将 `getAuthStatus()` 从"文件存在检查"升级为真实 HTTP 健康检查（访问 NotebookLM 首页并校验 `SNlM0e` 提取是否成功）
- [ ] `server/src/worker/`：在 Worker 取任务前增加认证状态前置检查；若状态为 `reauth_required` 或 `error`，跳过本轮取任务并写入结构化 warn 日志（含 `authStatus` 字段）；监听 `auth:ready` 内部事件，认证恢复后立即触发一次主动唤醒而非等待下次定时轮询
- [ ] 任务状态模型：新增 `paused`（因认证失效而暂停）状态；`paused` 任务在认证恢复后可重新调度；超时的 `paused` 任务置为 `failed` 并附 `auth_failure` 原因
- [ ] `server/src/routes/auth.ts`：`/api/auth/status` 返回统一认证状态模型，包含 `status`、`lastCheckedAt`、`lastRefreshedAt`、`error`
- [ ] `server/src/routes/auth.ts`：新增 `POST /api/auth/reauth` 受保护的再授权入口，仅接受 base64 编码的 `storageState` 字段输入，由 `ADMIN_SECRET` 环境变量保护；未配置 `ADMIN_SECRET` 时返回 `503 Not Configured`
- [ ] `server/src/routes/health.ts`（或等价位置）：`/api/health` 暴露 `auth.status`、`auth.lastCheckedAt`、`auth.reauthRequiredSince`（仅 `reauth_required` 时）三个字段
- [ ] 会话失效告警：进入 `reauth_required` 时触发一次告警；优先向 `REAUTH_WEBHOOK_URL` 发送 POST；未配置则写结构化 error 日志；不重复告警
- [ ] 文档：补充运维 Runbook，说明 `storage-state.json` 失效后的具体操作步骤（重新登录、通过 `/api/auth/reauth` 更新凭据、确认恢复）
- [ ] 后台保活器：明确其职责边界——只做健康检查与状态维护，不做伪 keepalive；失败达到阈值后应直接进入 `reauth_required` 而不是无限重试

## 变更历史

| 日期 | 内容 |
|---|---|
| 2026-04-19 | 补充 Docker / 服务器部署下的登录策略、`storage-state.json` Secret 注入方式、为什么不推荐服务器自动登录与 keepalive 续命、会话失效后的系统行为（检测 → 暂停队列 → 告警 → 人工再授权 → 恢复）；新增"待办"章节；新增"变更历史"章节 |
| 2026-04-19 | 修复三处表述歧义：环境变量路径读取改为"后续实现建议"并标注变量名 `NOTEBOOKLM_STORAGE_STATE_PATH` 尚未实现；`paused`/`auth_error` 明确为任务队列层状态，与认证状态机区分；补充 cross-reference 说明服务器场景不依赖 browser-user-data 浏览器自动化 |
| 2026-04-19 | 新增"再授权与告警最小闭环设计"章节：明确健康检查必须暴露的 auth 字段、受保护再授权入口规格（`POST /api/auth/reauth` + `ADMIN_SECRET` + base64 输入）、worker 在 `reauth_required` 时暂停取任务的行为规则、队列中 `paused` 任务的推荐处理方式、告警优先级与降级路径（webhook 优先 → 结构化日志）、故意不做的东西及理由；更新"待办"章节为具体可操作条目 |
| 2026-04-19 | 收紧设计边界：移除再授权入口的本地路径输入支持（保留仅 base64 方式）；明确健康检查与状态模型中 `ready` 为持久化快照而非实时探活结果；补充认证恢复后 worker 主动唤醒行为；统一任务状态层语义（废弃 `auth_error` 独立状态，改用 `failed + failureReason`）；新增"实施任务"章节 |
