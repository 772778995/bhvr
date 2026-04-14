---
name: book-finder-source-adapter
description: Use when adding, replacing, or revalidating a fast book finder source in this repository, especially when a public source must be proven usable first, mapped into the adapter registry, counted in book_source_stats, and integrated without reviving legacy douban, weread, or metadata-bridge flows.
---

# Book Finder Source Adapter

## 概述

快速找书的书源接入不是“找个能搜的站点然后往 `service.ts` 里塞分支”。先验证来源，再接成适配器，并让 `success | empty | failure` 统计自然落到 `book_source_stats`。任何来源失败都只能影响自己，不能把整次检索拖下水。

## 何时使用

- 新增、替换或恢复一个快速找书来源
- 现有来源因为 API 或 DOM 漂移需要重写解析
- 调整 `supports()`、`sourceReliability` 或来源风险级别
- 判断某个公开站点能不能进入正式链路

**不用于：**

- 只改结果文案、排序 copy 或前端样式
- 只改 `BookWorkbenchView` 的消息展示，不碰来源本身

## 先看这些文件

- `docs/superpowers/specs/2026-04-14-快速找书来源适配器与可用性统计-设计-已完成.md`
- `server/src/book-finder/types.ts`
- `server/src/book-finder/adapters.ts`
- `server/src/book-finder/service.ts`
- `server/src/book-finder/service.adapter.test.ts`
- `server/src/routes/notebooks/index.test.ts`
- `server/src/db/book-source-stats.ts`
- `client/src/views/book-workbench-view.test.ts`

## 来源准入门槛

可以接入：

- 公开 API
- 稳定的公开 HTML 或 OPDS 页面
- 明确接受高风险页面抓取的公开来源

默认拒绝：

- 需要登录态、验证码、浏览器自动化或客户端的软件源
- 网盘分发页、客户端下载页、导航壳页面
- 不稳定镜像轮换、强跳转站、只有人工流程才能用的来源

如果新来源会改变正式支持列表、风险分级或拒绝边界，先同步更新最终 spec，再改代码。别拿过时文档当免死金牌。

## 实施顺序

1. **先验证真实来源，不要先写代码**

- 确认真实入口 URL、查询参数、可解析字段、风险级别
- 记录稳定选择器或结构模式
- 如果站点只能靠登录、验证码、镜像赌运气，直接停，不要硬接

2. **先写失败测试**

- 优先在 `server/src/book-finder/service.adapter.test.ts` 增加或修改测试
- 至少覆盖：`supports()` 路由、`success/empty/failure`、单源失败隔离、不得回退到 `douban` / `weread` / `metadata bridge`
- 凡是带详情页补全的两段式来源，必须覆盖“详情失败仍保留搜索页候选”和“详情抓取数量上限”
- 如果统计行为或路由行为变化，再补 `server/src/routes/notebooks/index.test.ts`

3. **实现适配器**

- 按当前仓库模式，在 `server/src/book-finder/adapters.ts` 中新增 `createXxxAdapter()`
- 注册到 `bookSourceAdapters`
- 明确实现 `id`、`label`、`reliability`、`supports()`、`search()`
- 所有网络请求都复用 `fetchWithTimeout`
- 详情页抓取必须有上限；详情失败时优先回退到搜索页候选，而不是把整源炸掉

4. **保持主流程通用**

- `server/src/book-finder/service.ts` 只保留通用聚合、去重、排序、Markdown 渲染
- 不要再往 `service.ts` 里加来源特例分支
- 只有当共享排序或标准化合同真的变化时，才动主流程

5. **不要另拉统计旁路**

- 路由已经通过 `recordBookSourceStat` 注入统计写入
- 适配器本身只负责返回候选或抛错
- 三态口径不能乱改：`success`、`empty`、`failure`

6. **如果输出形状变化，补前端兼容验证**

- 当前前端识别的是平铺书单消息，不是旧豆瓣链路字段
- 如果你改了 Markdown 结构，至少补跑 `client/src/views/book-workbench-view.test.ts`，再按需核对 `client/src/views/book-workbench-view.ts`

## `BookCandidate` 填充优先级

必须稳定提供：

- `id`
- `sourceId`
- `sourceLabel`
- `sourceReliability`
- `title`

强烈建议尽量补全：

- `authors`
- `publisher`
- `publishedYear`
- `description`
- `categories`
- `isbns`
- `infoLink`

按需补充：

- `previewLink`
- `averageRating`
- `ratingsCount`
- `ratingSourceLabel`
- `ratingScale`

别小看这些字段。排序、去重和最终渲染都直接吃这套数据；你只填一个标题，然后指望系统 magically 排对，属实想太多。

## 统计口径

- `success`：来源调用成功，且返回至少 1 条有效候选
- `empty`：来源调用成功，但没有有效候选
- `failure`：超时、HTTP 非 2xx、解析失败、请求异常
- `book_source_stats` 按 `source_id` 全局聚合，不按 notebook、query 或单次搜索拆分
- 只有 `success` 才会刷新 `lastSuccessAt`

写统计断言时，先按 `sourceId` 排序再比。适配器是并发执行的，数据库 `select()` 返回顺序不是契约，别再对着 SQLite 许愿它按你脑补的顺序排队。

## 可靠度建议

- 官方结构化公共 API：`85-90`
- 公共 OPDS 或结构化目录：`80-85`
- 无正式契约、但页面结构相对稳定的公开抓取源：`50-60`

不要给未知站点乱发 `100`。那不是自信，是给排序系统喂假药。

## 常见错误

**把旧链路偷偷接回来**

- 问题：重新依赖 `douban`、`weread`、`metadata bridge`
- 修复：新来源必须走 adapter registry，旧链路不得复活

**只写适配器，不注册 `bookSourceAdapters`**

- 问题：代码存在，但主流程根本不会调用
- 修复：实现后立即确认 registry 和 `supports()` 生效

**把空结果记成失败**

- 问题：可用性统计会失真
- 修复：只有请求或解析异常才算 `failure`

**详情页抓取失败就让整源报废**

- 问题：高风险来源会把整体命中率拖垮
- 修复：优先保留搜索页候选，详情补全失败只影响候选完整度

**改了 Markdown 形状却不看前端**

- 问题：后端自以为很优雅，前端直接认不出结果消息
- 修复：输出结构变化时补跑 `book-workbench-view` 相关测试

## 验证命令

在 `server/` 下：

```bash
npx tsx --test src/book-finder/service.adapter.test.ts
npx tsx --test src/book-finder/service.test.ts
npx tsx --test src/routes/notebooks/index.test.ts --test-name-pattern "book-finder/search records per-source availability stats"
npx tsx --test src/db/init.test.ts
npm run build
```

如果改了助手结果 Markdown 结构，再在 `client/` 下补跑：

```bash
npx tsx --test src/views/book-workbench-view.test.ts
```

## 完成定义

- 新来源已经先做真实验证，而不是代码写完才反向找证据
- 适配器已注册到 `bookSourceAdapters`
- `supports()`、失败隔离、统计口径都有测试覆盖
- 不会回退到旧 `douban` / `weread` / `metadata bridge` 链路
- 服务器验证命令通过
- 如果准入边界或风险分级变化，spec 已同步更新
