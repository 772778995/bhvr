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

`ready` 不是“文件存在”，而是“最近一次真实认证校验成功”。

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
