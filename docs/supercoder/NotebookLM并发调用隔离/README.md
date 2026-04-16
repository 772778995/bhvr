# NotebookLM 并发调用隔离

**状态：** 进行中

## 设计结论

**推荐：全局互斥锁方案。** 在 worker 层面确保同一时刻只有一个 notebook 操作执行，避免多请求并发导致的上下文串扰。实现最简单、风险最低。

## 问题分析

**根因：** NotebookLM SDK (`NotebookLMClient`) 在同一进程中共享认证令牌和 cookie header，多个 notebook 发起并发请求时，Google 后端可能将请求上下文混淆，导致返回结果写入错误的 notebook。

**现状：**
- `auth-manager.ts` 使用单例模式维护 `runtime.client`，所有请求共用同一个 SDK 实例
- `client.ts` 的 `runNotebookRequest` 每次调用共享的 client，无隔离
- worker 队列虽然是 FIFO 单线程，但每个 research task 内部会顺序执行多步（生成问题 → 问问题 → 汇总），每步都可能触发并发

**现象：** 用户 A 在笔记 A 点击生成总结，用户 B 在笔记 B 同时生成总结 → 结果写入错误的笔记。

## 设计决策

### 方案 A：全局互斥锁（推荐）

在 `notebooklm/client.ts` 入口处添加一个 mutex，确保任意时刻只有一个 notebook 请求在执行。

- 优点：实现最轻量，无需改动 SDK 或 client 复用逻辑
- 缺点：完全串行化，吞吐量受限于单请求延迟
- 适用场景：NotebookLM API 本身有每日 50 次配额限制，吞吐量不是瓶颈

```typescript
// notebooklm/client.ts
const requestMutex = new AsyncMutex();

async function runNotebookRequest<T>(operation: (client: NotebookLMClient) => Promise<T>): Promise<T> {
  return requestMutex.runExclusive(async () => {
    // 原有逻辑不变
    const client = await getClient();
    try {
      return await operation(client);
    } finally {
      // 确保释放后短暂等待，避免 Google 服务端太快响应到下一个请求
      await new Promise(r => setTimeout(r, 100));
    }
  });
}
```

实现要点：
1. 引入 `async-mutex` 或自行实现简单 mutex
2. 在所有 notebooklm API 入口（`runNotebookRequest`）加锁
3. 释放后加 100ms 缓冲，降低服务端状态残留概率

### 方案 B：Client 实例池

为每个 notebookId 创建独立 client 实例，按需缓存。

- 优点：真正的并行处理
- 缺点：每个实例都维护独立连接，资源消耗大；需要解决 token 刷新时的同步问题
- 风险：NotebookLM 后端可能仍按 IP 或 cookie 会话维度隔离，并发仍可能冲突

### 方案 C：任务级串行化

在 worker 队列层面确保同一 notebook 的任务不并发（但不同 notebook 可并行）。

- 缺点：无法解决"同一 notebook 同一时刻多请求"的场景；如果用户快速多次点击，仍会并发
- 优点：比全局锁更细粒度

**结论：** 考虑到每日 50 次配额限制，方案 A 的吞吐量和资源成本完全可接受。优先实现全局互斥锁。

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | 多用户并发调用 notebooklm 接口出现结果串扰 |

## 坑 / 注意事项

- 添加锁后需要监控请求总时长变化
- 锁内部不要做耗时操作，避免阻塞其他请求
- 需要处理锁内部异常，确保锁正确释放

## 待办

## 实施任务

> 使用 supercoder:subagent-coordination 逐任务实施。

### 任务 1：添加互斥锁依赖

**文件：** `server/package.json`

- [ ] 添加 `async-mutex` 依赖
- [ ] 运行 `npm install`

### 任务 2：在 client.ts 实现互斥锁

**文件：** `server/src/notebooklm/client.ts:613`

- [ ] 导入 `Mutex` from `async-mutex`
- [ ] 在模块级创建 `const requestMutex = new Mutex()`
- [ ] 修改 `runNotebookRequest` 使用 `requestMutex.runExclusive`
- [ ] 释放后添加 100ms 缓冲

### 任务 3：验证

- [ ] 启动服务，手动触发两个 research task 并发
- [ ] 确认结果写入正确的笔记
- [ ] 运行 `npm run build` 确保类型检查通过