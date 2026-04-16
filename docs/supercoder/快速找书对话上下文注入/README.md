# 快速找书对话上下文注入

**状态：** 进行中

## 设计结论

在 `POST /api/notebooks/:id/book-finder/search` 中，把最近 N 条用户消息（仅用户侧，跳过 assistant 回复）拼接进 `parseIntent` 的 LLM prompt，让 LLM 能理解上下文意图（如"再推荐几本"、"要中文版的"等短句）。

## 动机

当前每次 search 是独立的意图解析 + 书目搜索，用户输入"再推荐几本"或"换成中文版"这类承接上一条的短句时，LLM 拿不到上文，无法正确解析意图，导致搜索失败或结果无关。用户期望的体验与普通聊天 AI 一致——对话是连续的。

## 设计决策

### 只注入用户历史，不注入 assistant 回复

assistant 的回复是书目列表（Markdown 格式），内容冗长且对意图解析无帮助。注入后会占用大量 token 且可能干扰 LLM 的 JSON 输出（特别是 `parseIntent` 要求输出纯 JSON）。  
**只注入用户一侧的前 N 条历史（N = 5）**，作为 `conversationContext` 传入。

### 实现位置：服务端路由层，不改 `service.ts`

`service.ts` 的 `findBooksForQuery` 不感知历史，职责单一保持不变。  
路由 handler（`book-finder/search`）负责：1）读取该 notebook 最近 5 条 `book_finder` source 的 user 消息；2）把历史拼成文字上下文；3）把 `query + context` 一起传入 `parseIntent`。

具体做法：在 `findBooksForQuery` 入口处的 `query` 参数前面拼接上下文前缀：
```
[对话上下文]
用户之前问过：
- 深度学习入门书
- 要有实战代码的

[当前问题]
再推荐几本
```

这样 `parseIntent` 的 LLM 接到的 `content` 包含完整上下文，输出的 searchText/keywords 就能正确理解承接意图。

### 历史条数：最近 5 条用户消息

- 5 条足以覆盖一段连续对话，不会超出 LLM context 窗口
- 不需要 DB schema 改动（`chat_messages` 中 `source = 'book_finder'` + `role = 'user'` 的记录已存在）

### 不推荐的方向

- ~~在 `service.ts` 的 `parseIntent` 增加 `history` 参数~~ —— `service.ts` 专注于无状态的查询意图解析，混入 DB 读取会破坏单一职责且测试变复杂
- ~~在 `requestModelJson` 中增加多轮 message array~~ —— 代价高，改动面大；简单拼前缀已足够，LLM 理解上下文的能力不依赖真正多轮格式

## 涉及文件

- 修改 `server/src/routes/notebooks/index.ts`（`book-finder/search` handler，读取历史并拼接 query）

## 变更历史

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-04-16 | 初始设计 | — |

## 坑 / 注意事项

- `listChatMessages(id, ["book_finder"])` 返回全部 book_finder 消息（含 assistant），需 `.filter(r => r.role === "user")` 后取最后 5 条
- 拼接格式要简洁，避免干扰 `parseIntent` 的 JSON 输出指令（只在 user content 中追加，system prompt 不变）
- 历史注入只影响 `parseIntent` 的意图理解，真正的搜索 query 在 `normalizeSearchText` 阶段可能被覆盖——考虑把 `conversationQuery`（历史+当前）作为 `originalQuery` 的 fallback，确保在 intent 解析失败时搜索词也能退化到当前 query（不退化到历史）

## 实施任务

### 任务 1：路由层注入用户历史上下文

**文件：**
- 修改 `server/src/routes/notebooks/index.ts`（`notebooks.post("/:id/book-finder/search"` handler）
- 修改 `server/src/routes/notebooks/index.test.ts`（相关 book-finder 测试）

**意图：** 在调用 `findBooksForQuery` 前，读取最近 5 条用户历史，构造带上下文的 query 字符串传给 service

- [ ] 在 `book-finder/search` handler 中，`findBooksForQuery` 调用前，通过 `listChatMessages(id, ["book_finder"])` 读取历史
- [ ] 过滤 `role === "user"` 的记录，取最后 5 条（不含本次新插入的），提取 `.content`
- [ ] 新建 `buildBookFinderQueryWithHistory(query, userHistory)` 辅助函数：当 `userHistory.length > 0` 时，返回拼接了上下文前缀的字符串；为空时直接返回 `query`
- [ ] 用拼接后的 query 调用 `findBooksForQuery`，但持久化到 DB 的用户消息仍使用原始 `query`（已在 `findBooksForQuery` 调用前 insert）
- [ ] 新增测试：当已有 2 条 book_finder user 历史时，`buildBookFinderQueryWithHistory` 的输出包含历史前缀
- [ ] 运行 `npm test --workspace=server` 通过
