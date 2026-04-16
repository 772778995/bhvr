# 快速找书来源适配器与可用性统计设计

**当前状态：** 已完成
**对应工作区：** .worktrees/2026-04-14-快速找书来源适配器与可用性统计-设计/
**工作区状态：** 未创建
**执行阶段：** 已完成
**当前负责会话：** opencode-gpt-5.4-book-sources

## 设计结论

`快速找书` 不再继续把书源写死在 `service.ts` 里，也不再依赖 `豆瓣 + metadata bridge + 微信读书` 这一套临时拼装。新的方向是：改为 `来源适配器注册表 + 逐源验证 + 全局可用性统计`，首批接入当前已验证可公开访问且可程序化解析的 `Anna's Archive`、`Open Library`、`Project Gutenberg`、`Z-Library Web` 四类来源；`wwwnav`、`Olib`、`网盘分发页`、`24h 搜书`、`鸠摩搜书`、`熊猫搜书` 以及不稳定镜像域不进入正式链路。

## 背景判断

- 当前 `server/src/book-finder/service.ts` 直接把查询路由、来源抓取、元数据桥接、微信读书补链、Markdown 渲染全部揉在一个文件里，继续往里塞新来源，只会越来越像垃圾堆。
- 用户要求“去掉之前所有书籍来源”，核心不是换一个网址就完事，而是把来源切换逻辑从写死脚本改成可扩展的适配器体系。
- 经过实际验证，没有一个同时满足“公开、稳定、中文强、结构化、可长期维护”的单一综合书籍接口。想一把梭成单源，是典型愿望代替现实。
- `wwwnav` 提供的大量链接本质是导航壳、镜像壳或客户端下载分发页，不是书籍 API。

## 外部来源验证结论

### 已验证可接入

#### 1. Anna's Archive 搜索页

- 可用入口：`https://annas-archive.gl/search?q={query}`
- 可解析字段：标题、作者、出版信息、语言、文件类型、文件大小、来源标签、详情页链接
- 角色：中英文广覆盖聚合补源
- 风险：无官方稳定 API 契约，镜像可能漂移，属于高风险公开站点
- 结论：可接，但必须隔离为独立适配器，并接受失败率高于官方公共源

#### 2. Open Library Search API

- 可用入口：`https://openlibrary.org/search.json?q={query}`
- 可解析字段：标题、作者、出版社、首次出版年、ISBN、subjects、封面、借阅/全文状态
- 角色：结构化公共书目主源之一
- 风险：中文覆盖一般，但 API 合规性和稳定性最好
- 结论：必须保留，并从“旧硬编码分支”改为正式适配器

#### 3. Project Gutenberg OPDS

- 可用入口：`https://www.gutenberg.org/ebooks/search.opds/?query={query}`
- 可解析字段：标题、作者、图书页、下载量、后续 OPDS 子条目
- 角色：英文公版书补源
- 风险：中文覆盖弱，不适合中文主检索
- 结论：适合做英文与公版书补充适配器

#### 4. Z-Library Web

- 可用入口：`https://z-lib.fm/s/{query}`
- 可解析字段：搜索页可拿到标题、作者、出版社、语言、年份、格式、文件大小、ISBN、详情页链接；详情页可补全描述、ISBN、出版信息
- 角色：中文与长尾书目高风险补源
- 风险：无官方稳定 API 契约，依赖公开页面结构，域名与页面结构未来可能漂移
- 结论：纳入正式链路，但必须标记为高风险适配器，参与统计、超时与降级，不能当唯一真源

### 已验证但不进入正式链路

#### 1. `z.wwwnav.com` / `olib.wwwnav.com` / `dianzishu.wwwnav.com`

- 这些页面提供的是导流和入口，不是可持续的书目接口
- 结论：不接入，最多作为人工调研入口

#### 2. Olib / 客户端下载页 / 网盘分享页

- 主要指向夸克、迅雷、百度网盘等下载分发，不是标准化搜索接口
- 结论：不接入

#### 3. 24h 搜书 / 鸠摩搜书 / 熊猫搜书

- 更像面向人类的聚合搜书页，未验证到稳定公开 API
- 结论：不接入

#### 4. Z-Library 镜像与不稳定域

- 历史上存在多个 `503`、强跳转或不可持续的镜像域
- 结论：只接当前已验证的公开 Web 入口；镜像域本身不进入正式链路

## 范围边界

本次实现只处理以下事项：

- 替换现有硬编码书源链路
- 建立统一的书源适配器注册表
- 为每个来源记录可用性统计
- 接入首批已验证来源并完成测试
- 总结新增来源适配器的项目 skill

本次不处理：

- 不提供盗版文件下载能力
- 不接入需要登录态、客户端、提取码或人工跳转的来源
- 不为高风险来源做复杂代理、反爬绕过或浏览器自动化
- 不在前端新增来源管理面板

## 推荐架构

### 1. 适配器边界

- 新增统一 `BookSourceAdapter` 接口，最少包含：
  - `id`
  - `label`
  - `supports(intent)`
  - `search(query, context)`
- 每个适配器只负责：请求单一来源、解析该来源、返回标准化 `BookCandidate[]`
- 任何来源失败都只影响自身，不得阻断整次找书

### 2. 来源注册表

- 由注册表统一维护默认启用来源与调用顺序
- 首批注册来源：
  - `anna-archive`
  - `open-library`
  - `project-gutenberg`
  - `z-library`
- `supports(intent)` 规则：
  - `anna-archive`：所有查询都可尝试
  - `open-library`：所有查询都可尝试，但英文权重更高
  - `project-gutenberg`：仅英文或明显非中文查询触发
  - `z-library`：所有查询都可尝试，但按高风险源处理

### 3. 聚合与排序

- 查询意图仍由现有 LLM 压缩模块生成 `searchText` 与 `languagePreference`
- 匹配到的适配器并发执行，逐源超时和错误隔离
- 结果聚合后继续使用标准化标题 + 首作者去重
- 排序优先级：
  - 标题匹配度
  - 作者匹配度
  - 来源可靠度
  - 元数据完整度
  - 是否存在公开详情页
- 新链路不再依赖 `豆瓣评分`、`微信读书推荐值`、`metadata bridge`

### 4. 可用性统计

- 新增全局持久化表，按 `source_id` 聚合统计，不按 notebook 拆
- 每次调用每个来源时都记录一次探测结果
- 状态定义：
  - `success`：来源调用成功，且返回至少 1 条有效候选
  - `empty`：来源调用成功，但无有效候选
  - `failure`：超时、网络错误、HTTP 非 2xx、解析失败
- 最少持久化字段：
  - `source_id`
  - `source_label`
  - `attempt_count`
  - `success_count`
  - `empty_count`
  - `failure_count`
  - `last_status`
  - `last_error`
  - `last_latency_ms`
  - `last_success_at`
  - `updated_at`
- 由这些聚合值可计算两类指标：
  - `availabilityRate = (success + empty) / attempts`
  - `effectiveHitRate = success / attempts`

### 5. 未来扩展约束

- 新增来源必须先做独立验证，再加适配器，不允许先写代码再找证据
- 新来源要满足至少一条：
  - 有公开 API
  - 有稳定公开页面结构可抓
  - 有明确的项目接受风险说明
- 任何来源若需要浏览器自动化、登录态、客户端、验证码或网盘提取码，默认拒绝进入正式链路

## 影响文件或模块

- `server/src/book-finder/service.ts`
- `server/src/book-finder/service.test.ts`
- `server/src/routes/notebooks/index.ts`
- `server/src/routes/notebooks/index.test.ts`
- `server/src/db/schema.ts`
- `server/src/db/index.ts`
- `server/src/db/migrate.ts`
- `server/src/db/` 下新增书源统计读写模块
- `.opencode/skills/` 下新增书源适配器 skill

## 验证方式与成功标准

- 书源调用不再触发 `豆瓣`、`微信读书`、`metadata bridge`
- 中文与英文查询都能返回来自新来源链路的有效结果
- 某单一来源失败时，整次搜索仍能返回其他来源结果或空态
- 每次搜索完成后，书源统计表都会更新对应来源的计数与最后状态
- 新增来源只需要新增适配器和注册表项，不需要继续修改主流程分支

## 风险与取舍

- `Anna's Archive` 覆盖好，但稳定性与风险都高，所以只能隔离、超时、降级，不能当唯一真源
- `Project Gutenberg` 合规但偏英文公版书，不适合承担中文主检索
- `Open Library` 结构最好，但中文一般，所以必须和聚合源搭配
- `Z-Library Web` 当前环境下可用，但它依然属于高风险页面抓取来源，只能作为补源，不能被误写成“官方综合接口”
- 这套设计牺牲了部分“中文热门书即时评分展示”，换来更清晰的边界和更可扩展的来源系统，这个交换是值的

## 自审结果

- 已明确本次是单任务设计，不需要再拆总览文档
- 已明确正式接入与拒绝接入的来源边界，没有把导航页硬装成 API
- 已明确可用性统计口径，避免后续各写各的“可用”定义
- 已明确新架构是适配器注册表，而不是继续在 `service.ts` 里叠条件分支
- 文件名状态与正文状态一致，且设计已稳定，可直接进入实现
