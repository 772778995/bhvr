# NotebookLM 并发调用隔离

**状态：** 已完成（2026-04-17）

## 设计结论（一句话）

**按底层接口类型做 keyed queue，同类串行，跨类并行，auth 恢复单独串行。**

> ⚠️ **不推荐（已废弃）：全局互斥锁方案。** 旧方案将所有 NotebookLM 操作全部串行化，`generation.chat` 排队时会阻塞完全无关的 `notebooks.list`，严重过度串行，导致吞吐量不必要地下降。本次重新设计废弃此方案。

## 问题背景

NotebookLM SDK（`notebooklm-kit`）在同一进程中共享认证令牌和 cookie header。多个请求并发时，存在两类风险：

1. **同一接口家族并发**：Google 后端可能将相同类型的并发请求上下文混淆（例如两个 `generation.chat` 请求），导致结果串扰。
2. **auth 状态并发踩踏**：多个请求同时检测到 auth failure，并发地进行 invalidate/refresh，共享 `authManager` 状态会被互相覆盖。

## 为什么 worker FIFO 队列不够

`worker/queue.ts` 的 FIFO 队列保证了**任务级别**的串行（一个 research task 完成后才启动下一个），但无法处理：
- 同一 task 内部的多步操作（生成问题 → 逐一提问 → 汇总），这些步骤会被顺序发起
- 来自 HTTP API（`/api/research`、`/api/notebooks`）的独立请求与 worker 任务的并发
- 用户快速触发多个独立 API 调用时产生的并发

## 为什么不在 route 层处理互斥

route 层（Hono 路由处理）不应感知互斥，原因：
- route 层不了解"哪些底层接口需要互斥"，这是底层实现细节
- 若在每个路由 handler 各自加锁，key 定义会散落，容易遗漏
- route 层的职责是 HTTP 协议处理，不是 SDK 调用策略管理

**正确落点：** `server/src/notebooklm/client.ts` 的 `runNotebookRequest` 包装层——所有 NotebookLM 操作的唯一入口。

## operationKey 映射

所有导出函数必须在调用 `runNotebookRequest` 时传入正确的 `operationKey`，按**底层接口家族**分组，不按业务功能名定义。

| 导出函数 / 能力 | operationKey | 备注 |
|---|---|---|
| `sendNotebookChatMessage` | `generation.chat` | 主聊天接口，最高频，必须互斥 |
| `askNotebook` | `generation.chat` | 同上，内部调用相同 SDK 方法 |
| `askNotebookForResearch` | `generation.chat` | 同上 |
| `listNotebooks` | `notebooks.read` | 读操作，与写操作隔离 |
| `getNotebookDetail` | `notebooks.read` | 同上 |
| `ensureNotebookAccessible` | `notebooks.read` | 同上 |
| `createNotebook` | `notebooks.write` | 写操作 |
| `deleteNotebook` | `notebooks.write` | 写操作 |
| `getNotebookMessages` | `history.rpc` | 调用底层 rpc("hPTbtc") 和 rpc("khqZz") |
| `getNotebookSources` | `sources.read` | 读操作 |
| `getSourceProcessingStatus` | `sources.read` | 同上 |
| `addSourceFromUrl` | `sources.write` | 写操作 |
| `addSourceFromText` | `sources.write` | 写操作 |
| `addSourceFromFile` | `sources.write` | 写操作 |
| `deleteSource` | `sources.write` | 写操作 |
| `searchWebSources` | `sources.search` | 耗时长，独立 key 避免阻塞普通写入 |
| `addDiscoveredSources` | `sources.write` | 写操作 |
| `createArtifact` | `artifacts.write` | 写操作 |
| `getArtifact` | `artifacts.read` | 读操作 |
| `listArtifacts` | `artifacts.read` | 读操作 |

**auth 恢复流程**（invalidate / refresh / recreate client）使用独立的全局 `authFlowMutex`，与业务请求锁完全隔离，避免 refresh 时并发踩踏共享状态。

## 实现设计

### keyed request gate

最初评估了 `async-mutex` 的 `withTimeout(mutex, ms, E_TIMEOUT)` 方案，但发现一个不可绕过的问题：**timeout waiter 会 ghost acquire/release**——超时后调用方的 `finally` 已经执行，但 `withTimeout` 内部仍有一个 pending acquire 挂在 mutex 队列里；当 holder 释放后，ghost 会 acquire 然后立即 release，此时没有任何代码知道需要清理 Map，空闲 key 无法被精确删除。

因此最终 keyed queue 采用**手写 per-key Promise chain**，彻底消除 ghost acquire 问题。`authFlowMutex` 场景简单（无 timeout 需求），仍继续使用 `async-mutex` 的 `Mutex`。

```typescript
// 每个 key 一条 Promise chain，串行执行，无 ghost acquire
interface ChainEntry {
  tail: Promise<void>;  // 当前队列尾，新请求 attach 到这里
  pending: number;      // 等待或执行中的 caller 数，为 0 时删除 key
}

function createKeyedRequestGate(timeoutMs = 120_000): KeyedRequestGate {
  const map = new Map<string, ChainEntry>();

  async function run<T>(key, operation) {
    const entry = map.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    entry.pending += 1;
    map.set(key, entry);

    // 把自己附加到队列尾，通过 slotResolve 控制何时放行下一个 caller
    let slotResolve: () => void;
    const slot = new Promise<void>((r) => { slotResolve = r; });
    const prevTail = entry.tail;
    entry.tail = prevTail.then(() => slot);

    let timedOut = false;
    const turnPromise = prevTail.then(() => {
      if (timedOut) { slotResolve(); throw E_TIMEOUT; } // 已超时则立即放行并报错
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => { timedOut = true; reject(E_TIMEOUT); }, timeoutMs)
    );

    try {
      await Promise.race([turnPromise, timeoutPromise]);
    } catch (err) {
      if (err === E_TIMEOUT) {
        entry.pending -= 1;
        if (entry.pending === 0) map.delete(key);
        throw E_TIMEOUT;
      }
      throw err;
    }

    try {
      return await operation();
    } finally {
      slotResolve();          // 释放队列槽，唤醒下一个 caller
      entry.pending -= 1;
      if (entry.pending === 0) map.delete(key);
    }
  }

  return { run, activeKeyCount: () => map.size };
}
```

### auth flow 独立串行

auth 恢复流程（`getClient()` / `invalidateAuthClient` / `refreshAuthProfile`）使用独立的全局 `authFlowMutex`（`async-mutex` 的 `Mutex`），与业务请求的 keyed queue 完全隔离。这里不需要 timeout，`Mutex` 足够。

```typescript
const authFlowMutex = new Mutex(); // 全局唯一，仅用于 auth 状态读写

// 获取 client 时在 authFlowMutex 内保护
const client = await authFlowMutex.runExclusive(() => getClient());

// auth retry 时同样在 authFlowMutex 内做 invalidate/refresh
const retryClient = await authFlowMutex.runExclusive(async () => {
  await authManager.invalidateAuthClient(...);
  await authManager.refreshAuthProfile(...);
  return getClient();
});
```

### quota 在实际执行时消费

chat 类函数（`askNotebook` / `askNotebookForResearch` / `sendNotebookChatMessage`）使用 `let quotaConsumed = false` 闭包变量保护：quota check 和 `consumeQuota()` 在 operation callback 内执行，且只在首次执行时触发。即使 auth retry 导致 callback 被重跑，quota 也只扣一次。

### 空闲 key 清理

基于 `pending` 计数（等待 + 执行中的 caller 数量）精确删除：
- 每次 `run()` 入口：`entry.pending += 1`
- 每次 `run()` 出口（成功 / 异常 / 超时）：`entry.pending -= 1`，若 `=== 0` 则 `map.delete(key)`
- 超时路径：caller 的 `finally` 减计数并尝试删除；若此时 holder 仍在执行（pending > 0），holder 的 `finally` 会在之后再做一次删除检查

不再依赖 `mutex.isLocked()` 判断——Promise chain 实现下没有 mutex，也不需要。

### 超时保护

使用 `Promise.race([turnPromise, timeoutPromise])` 实现：
- `turnPromise`：前一个 caller 释放队列槽后 resolve
- `timeoutPromise`：`timeoutMs` 毫秒后 reject `E_TIMEOUT`
- 超时时设置 `timedOut = true` flag；当 `turnPromise` 最终触发时（holder 释放后），检查 flag，若已超时则立即调用 `slotResolve()` 放行后续 waiter，**不会执行 operation**，也**不会 ghost acquire**

## 当前实现范围

本轮实现：
- ✅ per-operation keyed queue（按 operationKey 串行，跨 key 并行）
- ✅ auth flow lock（独立全局 mutex 保护 auth 状态读写）
- ✅ 120 秒超时保护
- ✅ 空闲 key 清理
- ✅ quota 移入实际执行阶段

本轮**不**实现：
- 分布式锁（多进程 / 多实例部署不在当前范围）
- 无限复杂的队列治理（优先级、取消等）
- per-notebook 粒度隔离（当前保守分组已足够）

## 实施任务

- [x] 更新设计文档（本文件），废弃全局锁方案
- [x] 先写失败测试（`client.chat.test.ts`），覆盖 keyed queue 行为
- [x] 实现 `client.ts`：引入 `OperationKey` 类型、keyed mutex、authFlowMutex、quota 移位
- [x] 运行测试验证红→绿
- [x] `npm run build --workspace server` 通过类型检查

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计，采用全局互斥锁方案 | 多用户并发调用 notebooklm 接口出现结果串扰 |
| 2026-04-17 | 重新设计：废弃全局锁，改为按接口类型隔离的 keyed queue + auth flow lock | 旧方案过度串行，`generation.chat` 排队阻塞无关操作；新方案同类串行，跨类并行，auth 恢复单独串行 |

## 坑 / 注意事项

- `async-mutex` 的 `runExclusive` 第二个参数是 priority，**不是** timeout——不要把超时时间传进去
- `withTimeout(mutex, ms)` 超时后 waiter 仍在 mutex 内部队列里（ghost acquire/release），`isLocked()` 无法可靠判断队列是否清空；**keyed gate 已改为手写 Promise chain，不再使用 `withTimeout`**
- `authFlowMutex` 仅保护 `getClient()` 和 invalidate/refresh 调用，不应包裹整个 operation 执行，否则退化为全局锁
- quota 必须在进入 keyed queue 并轮到自己执行后才消费（在 operation callback 内），排队等待期间超时的请求不会消耗 quota；`quotaConsumed` 闭包变量确保 auth retry 重跑 callback 时不重复计费
- `getNotebookMessages` 内部的多个 `listNotebookHistoryMessages` 调用必须顺序 `await`，不能 `Promise.all`——它们都属于 `history.rpc` 家族，整个 `getNotebookMessages` 已在同一把 keyed queue 槽里串行执行
