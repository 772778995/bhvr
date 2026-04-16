# NotebookLM 单一数据源研究设计

**当前状态：** 已完成

## 设计结论

NotebookLM 保持唯一真相源，我们只保留自动研究编排和最终正式报告。

## 1. 背景

当前项目已经有两条相关能力线：

- 一条是现有的自动课题研究后端流程，使用本地 SQLite 持久化 `research_tasks` 和 `questions`
- 一条是新建的 `notebook/:id` workbench 壳页面，目前仍然依赖 stub notebook 数据

这两条线在 MVP 阶段帮助我们快速验证了界面和基础研究流程，但它们有一个明显问题：Notebook 原生数据被我们自己维护了一份副本，边界不够干净。

用户已经明确新的产品方向：

- `NotebookLM` 应该成为笔记、来源、问答的唯一真相源
- 我们的产品不再维护 Notebook 原生持久化数据
- 我们的产品只在 NotebookLM 之上增加两个能力：
  - 自动研究编排
  - 最终研究报告蒸馏与保存

因此，本次重构的目标不是继续扩展 stub workbench，也不是增强旧的本地任务落库模式，而是重构为“NotebookLM 单一数据源 + 我们自己的扩展层”。

## 2. 目标与非目标

### 2.1 目标

- 让 `notebook/:id` 页面直接对应 NotebookLM 的真实笔记 ID
- 让笔记详情、来源列表、问答记录都直接从 NotebookLM 读取
- 让自动研究成为该笔记上的一个系统功能，由后端驱动 NotebookLM 生成问答
- 让前端能够实时看到自动研究的步骤级运行状态
- 让正式课题研究报告由我们自己的模型生成，并只保存在我们自己的系统
- 尽量减少本地持久化内容，只保存我们真正拥有的数据资产

### 2.2 非目标

- 不继续维护 notebook/source/chat 的本地镜像表
- 不在 MVP 中支持用户直接自由聊天；MVP 阶段问答主要由系统自动研究生成
- 不在 MVP 中实现“用户手动新增问答并与 NotebookLM 双向编辑”的完整能力
- 不在 MVP 中承诺服务端重启后运行中的自动研究可无缝恢复
- 不在 MVP 中实现 NotebookLM 内部所有变化的真正订阅式同步
- 不在 MVP 中保存多版本报告历史

## 3. 核心产品边界

### 3.1 单一真相源原则

Notebook 原生数据以 NotebookLM 为唯一真相源，包括：

- 笔记基础信息
- 来源列表
- 问答记录

我们的系统不再持久化这些原生数据，不再尝试做副本同步，也不再把它们落到本地 SQLite 中作为正式记录。

### 3.2 笔记与研究课题的关系

- 一个 `NotebookLM 笔记` 就是一个研究课题容器
- `/notebook/:id` 中的 `id` 直接对应 NotebookLM 笔记 ID
- 不额外引入“我们的笔记 ID -> NotebookLM 笔记 ID”的映射层

开发调试阶段允许手动创建真实笔记并直接访问 `/notebook/:id`。但正式产品不应长期依赖手写 URL，而应在后续补充笔记列表或选择入口。

### 3.3 自动研究与报告的关系

产品分成两个清晰动作：

1. `自动研究`
   - 系统围绕该笔记自动生成并追加问答
   - 每次可先固定目标为 20 个自动问答
   - 再次点击自动研究时，继续向该笔记追加问答数据，不清理旧数据

2. `生成课题研究报告`
   - 读取该笔记中由自动研究沉淀下来的问答数据
   - 交给我们自己的模型蒸馏
   - 生成当前正式研究报告，并覆盖旧报告

没有自动研究问答资产时，不允许生成正式研究报告。

## 4. 总体方案

采用 `方案 A`：NotebookLM 单一真相源 + 我们只持久化最终报告。

### 4.1 NotebookLM 原生层

NotebookLM 负责：

- 笔记容器
- 来源管理
- 问答沉淀
- 自动研究过程中产生的问答结果保存

换句话说，自动研究本身也是该笔记的一部分。研究跑完后，NotebookLM 中的问答内容就是该笔记的正式问答资产。

### 4.2 我们的扩展层

我们的系统负责：

- 触发自动研究
- 驱动 NotebookLM 自动问答流程
- 向前端暴露步骤级实时运行状态
- 读取自动研究问答并生成最终正式研究报告
- 持久化当前正式研究报告

### 4.3 为什么不再保存 questions 明细

本次设计明确不再保存 NotebookLM 问答正文副本，原因是：

- 避免数据双写和漂移
- 避免用户在 NotebookLM 中操作后与本地状态不一致
- 让产品边界更清楚：NotebookLM 管原生内容，我们只管扩展产物

## 5. 页面与交互设计

### 5.1 页面归属

本次能力统一在现有 `GET /notebook/:id` 页面实现，不新增独立研究中心页面。

原因：

- 一个笔记就是一个研究课题容器
- 自动研究和正式报告都属于该笔记的扩展能力
- 用户心智最简单，也最快实现

### 5.2 页面分区

继续沿用当前已搭建的三栏 workbench 结构：

- 左栏：`来源`
- 中栏：`问答`
- 右栏：`Studio`

其中：

- 左栏和中栏展示 NotebookLM 原生数据
- 右栏作为我们扩展能力的控制台

### 5.3 Studio 职责

Studio 在这次重构后承担三个职责：

- 启动自动研究
- 展示自动研究步骤级运行状态
- 生成并展示当前正式研究报告入口/摘要

MVP 阶段，前端不开放用户自由发问；Notebook 问答内容以系统自动研究沉淀的数据为主。用户后续如果需要直接操作问答，也应通过我们系统封装的 NotebookLM 操作入口完成，以保证一致性。这一能力不在本次实现范围内。

## 6. 通信模型

### 6.1 操作通道

所有“触发动作”的请求都走普通 HTTP：

- 启动自动研究
- 生成正式报告
- 后续可能增加的删除问答、添加来源等动作

设计原则：

- 命令走 HTTP
- 不让前端直接接触 SDK
- 不让前端自己去轮询驱动 NotebookLM

### 6.2 观测通道

自动研究的运行态通过 `SSE` 推送给前端：

- 前端建立 `GET /api/notebooks/:id/research/stream`
- 后端持续推送步骤级运行事件
- 页面刷新或重新进入后，可重新建立 SSE 连接继续观察

### 6.3 为什么仍需要 SSE

SSE 不是用来“操作” NotebookLM，而是用来“观察”我们自己的编排流程。

换句话说：

- 前端通过 HTTP 命令触发后端动作
- 后端通过 SDK 操作 NotebookLM
- 后端再通过 SSE 把当前执行进度推给前端

因此 SSE 仍然是必要的，只是职责限定为长任务状态观测，而不是控制通道。

## 7. 真实可观测性的边界

这一点必须表述准确，避免对 SDK 能力做过度承诺。

### 7.1 能实时观测到的内容

MVP 中可以实时观测的是：

- 我们自己的自动研究编排状态
- 当前进行到第几步
- 当前正在生成第几问
- 当前正在等待第几问回答
- 已完成多少问
- 最近一次错误
- 研究是否完成

这些信息来源于我们的服务端 orchestrator，而不是 NotebookLM 的内部任务系统。

### 7.2 不能承诺的内容

不能把本次设计表述为“实时订阅 NotebookLM 内部所有状态变化”，因为仅靠现有 SDK，大概率做不到完整被动订阅。

因此 MVP 不承诺：

- 完整订阅 NotebookLM 所有消息变更事件
- 直接监听 NotebookLM 内部后台任务系统
- 在没有主动调用的前提下，被动收到所有 notebook 数据变化

### 7.3 Notebook 数据刷新策略

Notebook 问答区的数据更新优先采用以下方式：

- 每个关键步骤完成后，由前端重新调用 Notebook 读取接口刷新
- 必要时对当前笔记做轻量轮询校验

也就是说：

- 真正“实时”的是我们的运行态事件
- Notebook 原生数据展示则以“步骤后刷新”为主

## 8. 自动研究流程设计

### 8.1 执行模型

自动研究由服务端后台持续执行，用户页面无需保持在线。

只要服务端进程不挂掉，研究就可以继续执行。前端页面关闭、刷新、网络短暂断开都不应直接中止研究本身；用户回来后只需要重新连接 SSE。

### 8.2 基本流程

自动研究的 MVP 流程为：

1. 用户在 `notebook/:id` 页面点击“自动研究”
2. 前端发起 `POST /api/notebooks/:id/research/start`
3. 后端创建该笔记的一次运行实例，并开始循环驱动 NotebookLM
4. 每轮问答都由后端主动调用 SDK 完成
5. 每完成一步，后端向 SSE 推送步骤级状态
6. 前端收到状态后更新 Studio 区状态展示，并按需要刷新问答区

### 8.3 问答策略

MVP 先固定目标：

- 每次自动研究尝试追加 20 个自动问答

后续如果用户再次点击自动研究：

- 系统继续向该笔记追加新的自动研究问答
- 不清理旧问答
- 不阻止重复执行

### 8.4 自动研究的资产归属

自动研究产生的问答内容直接留在 NotebookLM 笔记中，并视为该笔记内容的一部分。

本次设计明确：

- 不把这些问答复制进本地 questions 表
- 不把这些问答另存为本地研究过程资产
- 以后生成报告时，直接从 NotebookLM 重新读取

## 9. 报告生成流程设计

### 9.1 触发方式

`生成课题研究报告` 与 `自动研究` 两者都支持，但 MVP 先按手动触发实现。

即：

- 自动研究完成后，不自动生成正式报告
- 由用户再点击“生成课题研究报告”

### 9.2 输入范围

MVP 中生成报告时，只纳入由系统自动研究产生的问答资产，不纳入用户普通对话。

同时，MVP 阶段默认不开放用户普通自由对话，因此数据边界会更简单。

### 9.3 输出归属

最终正式研究报告只保存在我们自己的系统中，不回写 NotebookLM。

这是我们真正拥有的扩展资产，也是本地数据库在本次架构中的主要职责。

### 9.4 覆盖策略

同一个笔记允许多次生成正式报告。

规则：

- 重新生成时覆盖旧报告
- MVP 不做多版本历史保留

## 10. 后端组件边界

### 10.1 NotebookLM Gateway

职责：

- 封装 `notebooklm-kit`
- 隔离 NotebookLM SDK 细节
- 提供统一的 notebook 读取和操作能力

建议能力边界：

- 读取笔记信息
- 读取来源列表
- 读取问答记录
- 发起问答
- 后续扩展删除/修改问答、来源操作入口

### 10.2 Research Orchestrator

职责：

- 驱动自动研究流程
- 管理 20 轮自动问答推进
- 发出步骤级状态事件
- 处理认证失效、资源丢失、空响应、超时等错误

它负责流程，不负责 Notebook 原生数据持久化。

### 10.3 Research Runtime Registry

职责：

- 维护当前服务进程内的运行实例
- 管理每个笔记当前的研究运行态
- 维护 SSE 订阅者集合

需要保存的只是进程内运行态，例如：

- 当前是否在运行
- 当前步骤
- 已完成数量
- 最近错误
- 当前订阅连接

这不是持久化数据库，而是内存态注册表。

### 10.4 Report Service

职责：

- 从 NotebookLM 读取自动研究问答资产
- 调用我们自己的模型生成正式研究报告
- 持久化当前正式报告

## 11. 数据持久化设计

### 11.1 保留的数据

本地数据库只保留真正属于我们自己的扩展资产：

- 笔记对应的当前正式研究报告
- 报告生成时间
- 报告生成失败信息（如需要）
- 与报告展示直接相关的最小元数据

### 11.2 删除的数据职责

以下数据职责不再由本地 SQLite 承担：

- notebook 基础信息镜像
- 来源列表镜像
- 问答正文镜像
- 自动研究 questions 明细
- Notebook 原生会话记录

### 11.3 关于研究运行状态

用户已经明确：不做自动研究过程状态的本地持久化。

因此：

- 运行中状态仅存在于服务端内存 registry 中
- 前端通过 SSE 实时观察
- 这会换来更干净的单一数据源边界

同时必须接受一个现实约束：

- 服务端一旦重启，运行中的研究流程不保证无缝恢复

## 12. 接口设计

### 12.1 Notebook 读取接口

- `GET /api/notebooks/:id`
  - 读取笔记基础信息
- `GET /api/notebooks/:id/sources`
  - 读取来源列表
- `GET /api/notebooks/:id/messages`
  - 读取问答记录

这些接口直接对接 NotebookLM，不再返回 stub。

### 12.2 自动研究接口

- `POST /api/notebooks/:id/research/start`
  - 启动自动研究
- `GET /api/notebooks/:id/research/stream`
  - SSE，订阅步骤级运行状态

后续可预留：

- `POST /api/notebooks/:id/research/stop`
  - 停止自动研究

但该能力不要求在本次 MVP 首批实现中完成。

### 12.3 正式报告接口

- `POST /api/notebooks/:id/report/generate`
  - 从自动研究问答生成正式研究报告
- `GET /api/notebooks/:id/report`
  - 读取当前正式研究报告

### 12.4 错误响应原则

所有接口都应返回明确的业务错误，而不是仅依赖前端猜测：

- 未认证
- 笔记不存在/已删除
- 当前正在运行
- 没有足够问答资产，不能生成报告
- NotebookLM 调用失败
- 蒸馏模型调用失败

## 13. 前端数据流

### 13.1 页面初始加载

进入 `notebook/:id` 后，前端并行请求：

- notebook 基础信息
- 来源列表
- 问答记录
- 当前正式报告

同时，页面初始加载后始终建立该笔记对应的 `SSE` 订阅，不再增加“先查状态再决定是否订阅”的分支。

这样做的原因是：

- 降低前端状态判断复杂度
- 页面进入后即可统一接收运行中、失败、完成等事件
- 即使当前没有运行中的自动研究，保持一个空闲 SSE 连接也比多维护一套额外的探测逻辑更简单

### 13.2 启动自动研究

流程：

1. 点击“自动研究”
2. 前端发起 `POST /research/start`
3. 复用页面初始加载时已经建立的 `SSE` 订阅
4. Studio 区实时显示步骤级运行信息
5. 在关键步骤后刷新问答区

### 13.3 生成正式报告

流程：

1. 点击“生成课题研究报告”
2. 前端发起 `POST /report/generate`
3. 成功后重新请求 `GET /report`
4. 在 Studio 中展示当前报告摘要或入口

### 13.4 页面上的按钮策略

MVP 至少应区分这些按钮状态：

- 自动研究：可点击 / 运行中禁用
- 生成报告：有自动研究问答资产后可点击
- 查看报告：有当前正式报告时显示

## 14. 错误处理与边界情况

### 14.1 认证类错误

例如：

- NotebookLM 登录失效
- cookie 过期

表现：

- 笔记读取失败
- 自动研究无法启动

前端应明确提示用户重新认证，而不是只显示通用报错。

### 14.2 资源类错误

例如：

- 笔记不存在
- 笔记被删除
- 目标资源不可访问

表现：

- 详情页无法加载
- 运行中研究在下一步失败

### 14.3 运行类错误

例如：

- 某一步提问失败
- NotebookLM 空响应
- 超时
- 中断

表现：

- SSE 推送 `failed` 事件
- 附带最近一步错误信息

### 14.4 报告类错误

例如：

- 自动研究问答不足
- 我们自己的模型生成失败

表现：

- 自动研究和正式报告是两个独立动作
- 即使报告失败，NotebookLM 中的问答资产仍然保留
- 用户可再次点击生成正式报告

### 14.5 已确认支持的边界情况

MVP 先明确支持：

- 页面刷新或关闭后重新进入，重新连接 SSE 观察运行态
- 同一笔记重复点击自动研究，在未运行时允许再次启动并继续追加问答
- 在运行中笔记被删除时，中止流程并推送失败
- 在运行中认证失效时，中止流程并推送失败
- 没有自动研究问答资产时禁止生成报告
- 重新生成报告时覆盖旧报告

## 15. 测试策略

### 15.1 后端测试重点

- NotebookLM gateway 的错误映射
- orchestrator 的步骤推进与事件发出
- runtime registry 的连接注册、广播、清理
- report service 的输入校验与失败分支

### 15.2 集成测试重点

- 启动自动研究后可收到 SSE 步骤事件
- 某一步失败时可收到失败事件
- 研究执行期间 notebook 读取接口仍可正常读取最新数据
- 没有问答资产时报告生成被拒绝
- 成功生成报告后可通过 `GET /report` 读取

### 15.3 前端测试重点

- `notebook/:id` 页面正常加载真实 notebook 数据
- 自动研究启动后 Studio 状态区实时变化
- 问答区在关键步骤后刷新
- 报告生成按钮在不满足条件时禁用或给出明确提示
- 认证失败、笔记缺失、运行失败等错误态清晰可见

## 16. MVP 验收标准

本次重构完成后，应满足以下标准：

- `/notebook/:id` 的 `id` 直接对应真实 NotebookLM 笔记 ID
- 笔记详情、来源、问答都来自 NotebookLM，而不是 stub 或本地镜像
- 自动研究可由后端启动，并在同一笔记内追加自动问答
- 前端可通过 SSE 看到步骤级运行状态
- 页面刷新后可重新连接运行态观察
- 没有自动研究问答资产时不能生成正式报告
- 正式报告由我们自己的模型生成，并只保存在我们系统中
- 再次生成报告时覆盖旧报告
- 本地数据库不再保存 Notebook 原生 questions 明细

## 17. 后续演进方向

本次设计之后，合理的后续扩展方向包括：

1. 增加笔记列表/选择入口，而不是依赖手写 URL
2. 为 NotebookLM 操作补充删除问答、删除来源等受控入口
3. 支持用户通过我们系统手动新增问答
4. 引入可恢复的研究运行机制，降低服务端重启影响
5. 增加报告手动编辑与继续 AI 改写能力
6. 增加报告版本历史

这些方向都应建立在本次“NotebookLM 单一真相源”边界已经稳定的前提下。


---

# NotebookLM 单一数据源研究实施计划

> **面向智能体工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 未开始

**目标：** 将 `notebook/:id` 工作台从 stub 数据重构为 NotebookLM 直连模式，并实现服务端驱动的自动研究、SSE 实时观测，以及只保存最终正式报告的扩展层。

**架构：** Notebook 原生数据全部改为通过后端 gateway 直连 NotebookLM；自动研究由服务端 orchestrator 在内存 runtime registry 中推进，并通过 SSE 向前端暴露步骤级状态；本地数据库缩减为仅保存当前正式研究报告，不再保存 Notebook 原生问答副本。

**技术栈：** Vue 3 + vue-router + TypeScript + Vite、Hono + TypeScript、`notebooklm-kit`、Drizzle ORM + SQLite、Server-Sent Events

---

## 文件结构

### Backend

- Modify: `server/src/notebooklm/client.ts`
  - 补充 Notebook 读取能力，统一封装 NotebookLM SDK 调用
- Modify: `server/src/notebooklm/index.ts`
  - 重新导出新增的 gateway 能力
- Modify: `server/src/routes/notebooks/index.ts`
  - 从 stub 路由改为真实 notebook 读取接口 + 自动研究 + SSE + 报告接口
- Create: `server/src/routes/notebooks/validate.ts`
  - notebook id 校验和通用错误响应辅助
- Create: `server/src/routes/notebooks/sse.ts`
  - SSE 响应写入辅助和事件格式化
- Create: `server/src/research-runtime/types.ts`
  - 运行态、事件、步骤枚举等类型
- Create: `server/src/research-runtime/registry.ts`
  - 进程内 runtime registry，管理每个笔记的当前研究实例和订阅者
- Create: `server/src/research-runtime/orchestrator.ts`
  - 自动研究编排逻辑，按固定 20 轮推进
- Create: `server/src/report/schema.ts`
  - 正式报告领域类型和读写边界
- Create: `server/src/report/service.ts`
  - 报告生成与持久化逻辑
- Modify: `server/src/db/schema.ts`
  - 增加或重构为“当前正式报告”表；标记旧 `research_tasks/questions` 为待移除职责
- Modify: `server/src/db/migrate.ts`
  - 增加正式报告表迁移
- Modify: `server/src/index.ts`
  - 根接口说明更新；必要时接入新的模块初始化

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - 从 stub view-model 改为真实 notebook/report/runtime 类型和请求方法
- Create: `client/src/api/sse.ts`
  - SSE 连接封装与事件解析
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - 页面初始加载真实 notebook 数据，并始终建立 SSE 订阅
- Modify: `client/src/components/notebook-workbench/StudioPanel.vue`
  - 从“建设中占位”改为自动研究控制 + 状态展示 + 报告入口
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`
  - 以真实 NotebookLM 问答展示为主，刷新时保留稳定渲染
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - 以真实 NotebookLM 来源展示为主
- Modify: `client/src/components/notebook-workbench/NotebookTopBar.vue`
  - 仅在必要时调整文案/动作，保持轻量
- Modify: `client/src/utils/not-implemented.ts`
  - 缩减为后续未实现动作专用；不再负责自动研究主路径

### Existing Modules To Sunset Carefully

- Read/Assess: `server/src/routes/research/index.ts`
- Read/Assess: `server/src/worker/research.ts`
- Read/Assess: `server/src/worker/recovery.ts`

这些旧模块在本次实施中不要粗暴删除。先停止新页面对它们的依赖，再决定是否保留兼容路径或在后续计划中移除。

---

## Task 1: Replace Notebook Stub Reads With NotebookLM Gateway Reads

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Create: `server/src/routes/notebooks/validate.ts`
- Modify: `client/src/api/notebooks.ts`

- [ ] **Step 1: Inspect notebooklm-kit capability surface already used in this repo**

Read:

- `server/src/notebooklm/client.ts`
- existing `notebooklm-kit` usage in current codebase

Expected outcome:

- 确认可直接复用的能力边界，例如：`listNotebooks`、单轮 `chat`
- 明确哪些读取能力需要先通过 SDK 补齐封装，哪些需要保守降级

- [ ] **Step 2: Add NotebookLM gateway read helpers in `server/src/notebooklm/client.ts`**

伪代码：

```text
getNotebook(notebookId):
  connect client
  call sdk notebook detail/list capability
  normalize to { id, title, description, updatedAt }

getNotebookSources(notebookId):
  connect client
  read notebook sources
  normalize to Source[]

getNotebookMessages(notebookId):
  connect client
  read notebook conversation/messages if SDK supports it
  if capability is partial, return normalized subset and document omissions
```

要求：

- 不把 SDK 返回原样泄漏到 route 层
- 错误统一转成明确的业务错误
- 保持 notebook id 直接使用路由参数，不引入映射表

- [ ] **Step 3: Extract notebook id validation and route helpers into `server/src/routes/notebooks/validate.ts`**

伪代码：

```text
getNotebookId(raw):
  trim raw
  if empty -> invalid

requireNotebookId(context, handler):
  validate id
  call handler(id)
```

要求：

- 把现有 `index.ts` 里的 notebook id 校验从主路由文件中抽出
- 保持当前 auth gating 逻辑可复用

- [ ] **Step 4: Replace stub GET routes with real gateway-backed GET routes**

伪代码：

```text
GET /api/notebooks/:id
  -> gateway.getNotebook(id)

GET /api/notebooks/:id/sources
  -> gateway.getNotebookSources(id)

GET /api/notebooks/:id/messages
  -> gateway.getNotebookMessages(id)
```

要求：

- `GET /chat/messages` 迁移为 `GET /messages`，与 spec 保持一致
- 移除这三个读接口对 `stub-data.ts` 的依赖
- 先不要把 studio/report/research-start 混进本任务

- [ ] **Step 5: Update client notebook API methods to match the new read routes**

伪代码：

```text
notebooksApi.getNotebook(id)
notebooksApi.getSources(id)
notebooksApi.getMessages(id) -> /api/notebooks/:id/messages
```

要求：

- 保持统一响应解包逻辑
- 不再依赖旧的 `chat/messages` 路径

- [ ] **Step 6: Run targeted verification**

Run:

- `npm run build --workspace server`
- `npm run build --workspace client`

Expected:

- server 构建通过
- client 构建通过
- notebook 读取接口编译通过，未再引用 stub-only 路径

- [ ] **Step 7: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts server/src/routes/notebooks/index.ts server/src/routes/notebooks/validate.ts client/src/api/notebooks.ts
git commit -m "feat: read notebook workbench data from NotebookLM"
```

---

## Task 2: Introduce Report-Only Persistence

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/migrate.ts`
- Create: `server/src/report/schema.ts`
- Create: `server/src/report/service.ts`
- Modify: `server/src/routes/notebooks/index.ts`

- [ ] **Step 1: Define the minimal report persistence shape**

伪代码：

```text
research_reports:
  notebook_id (pk or unique)
  report_markdown
  generated_at
  error_message nullable
```

要求：

- 一条笔记只保留一份当前正式报告
- 不增加版本历史
- 不保存 questions / answers 正文副本

- [ ] **Step 2: Update Drizzle schema to include the report table**

伪代码：

```text
export const researchReports = sqliteTable("research_reports", { ... })
```

要求：

- 字段名使用 `snake_case`
- 与 spec 中“覆盖旧报告”模型一致
- 不在此步删除旧表，先新增新职责表

- [ ] **Step 3: Extend `server/src/db/migrate.ts` with the new table migration**

伪代码：

```text
CREATE TABLE IF NOT EXISTS research_reports (...)
```

要求：

- 保持现有启动迁移方式
- 不破坏已有数据库文件

- [ ] **Step 4: Add `server/src/report/service.ts` to read/write the current report**

伪代码：

```text
getReport(notebookId)
saveReport(notebookId, reportMarkdown, generatedAt, errorMessage?)
clearReportError(notebookId)
```

要求：

- service 只处理“正式报告”资产
- 不在这里直接实现蒸馏模型调用

- [ ] **Step 5: Add `GET /api/notebooks/:id/report` route**

伪代码：

```text
GET /api/notebooks/:id/report
  -> reportService.getReport(id)
```

要求：

- 没有报告时返回清晰空结果，不返回 500
- 响应结构保持与其他 route 一致

- [ ] **Step 6: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- 新表 schema 和 route 编译通过
- 迁移文件无语法错误

- [ ] **Step 7: Commit**

```bash
git add server/src/db/schema.ts server/src/db/migrate.ts server/src/report/schema.ts server/src/report/service.ts server/src/routes/notebooks/index.ts
git commit -m "feat: persist only current research reports"
```

---

## Task 3: Build Research Runtime Registry And SSE Plumbing

**Files:**
- Create: `server/src/research-runtime/types.ts`
- Create: `server/src/research-runtime/registry.ts`
- Create: `server/src/routes/notebooks/sse.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Create: `client/src/api/sse.ts`

- [ ] **Step 1: Define runtime event and state types**

伪代码：

```text
ResearchRuntimeState:
  notebookId
  status: idle | running | failed | completed
  step: starting | generating_question | waiting_answer | refreshing_messages | completed | failed
  completedCount
  targetCount
  lastError?

ResearchRuntimeEvent:
  type
  timestamp
  payload
```

要求：

- 只定义步骤级状态，不做问题正文快照
- 事件命名要能直接被前端消费

- [ ] **Step 2: Implement in-memory runtime registry**

伪代码：

```text
registry.get(notebookId)
registry.start(notebookId)
registry.update(notebookId, patch)
registry.fail(notebookId, error)
registry.complete(notebookId)
registry.subscribe(notebookId, listener)
registry.unsubscribe(notebookId, listener)
```

要求：

- 每个笔记只维护一个当前运行实例
- registry 负责广播给订阅者
- 不落库

- [ ] **Step 3: Add SSE helper functions in `server/src/routes/notebooks/sse.ts`**

伪代码：

```text
openSse(c)
sendEvent(stream, eventName, data)
sendHeartbeat(stream)
closeSse(stream)
```

要求：

- 事件格式统一
- 考虑浏览器断开后的清理逻辑

- [ ] **Step 4: Add `GET /api/notebooks/:id/research/stream` route**

伪代码：

```text
route opens SSE
subscribe current notebook runtime
immediately emit current state snapshot
forward future state changes
cleanup on disconnect
```

要求：

- 满足“页面初始加载后始终建立 SSE 订阅”
- 没有运行中的研究时也保持可连接，并返回 idle snapshot

- [ ] **Step 5: Add a small frontend SSE wrapper**

伪代码：

```text
connectResearchStream(notebookId, handlers)
  create EventSource
  parse message payload
  expose close()
```

要求：

- 前端不直接在 view 中散写 EventSource 解析逻辑
- 对断线和非法消息做最小保护

- [ ] **Step 6: Run targeted verification**

Run:

- `npm run build --workspace server`
- `npm run build --workspace client`

Expected:

- SSE 路由和前端封装都通过类型检查

- [ ] **Step 7: Commit**

```bash
git add server/src/research-runtime/types.ts server/src/research-runtime/registry.ts server/src/routes/notebooks/sse.ts server/src/routes/notebooks/index.ts client/src/api/sse.ts
git commit -m "feat: add notebook research runtime SSE plumbing"
```

---

## Task 4: Implement Server-Driven Auto Research Orchestration

**Files:**
- Create: `server/src/research-runtime/orchestrator.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Define the MVP orchestration loop shape before coding**

伪代码：

```text
startAutoResearch(notebookId):
  if runtime already running -> reject
  mark runtime starting
  repeat until 20 turns:
    generate or derive next question
    emit generating_question
    ask notebook
    emit waiting_answer -> progress
    optionally trigger message refresh hint
  mark completed
```

要求：

- 这一步先固定“20 轮追加问答”的目标
- 不在本任务实现停止/暂停/恢复

- [ ] **Step 2: Implement the orchestrator using the runtime registry**

伪代码：

```text
orchestrator.start(notebookId)
  validate auth and notebook existence
  create runtime entry
  run async loop
  update registry at each step
  on error -> fail runtime
```

要求：

- 路由触发后立即返回，不阻塞 HTTP 请求直到 20 轮完成
- 研究流程由服务端后台继续运行

- [ ] **Step 3: Add the start endpoint `POST /api/notebooks/:id/research/start`**

伪代码：

```text
POST /research/start
  if running -> 409
  else start orchestrator and return accepted
```

要求：

- 返回值要让前端知道启动成功
- 避免重复启动同一笔记的并行研究

- [ ] **Step 4: Make notebook reads and orchestrator share the same gateway normalization**

伪代码：

```text
route layer never calls SDK directly
orchestrator uses gateway.askNotebook(...)
route reads use gateway.getNotebookMessages(...)
```

要求：

- 不让 SDK 逻辑分散在多个地方
- 错误统一由 gateway/orchestrator 归一化

- [ ] **Step 5: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- start route、orchestrator、gateway 改动编译通过

- [ ] **Step 6: Commit**

```bash
git add server/src/research-runtime/orchestrator.ts server/src/routes/notebooks/index.ts server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "feat: orchestrate auto research from the notebook route"
```

---

## Task 5: Generate Final Reports From NotebookLM Research Data

**Files:**
- Modify: `server/src/report/service.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Read/Reuse: existing model invocation module if one already exists; otherwise add a narrow adapter in a new file under `server/src/report/`

- [ ] **Step 1: Define the report generation contract**

伪代码：

```text
generateReport(notebookId):
  load notebook messages
  filter to auto-research messages only
  if insufficient -> reject
  call our model
  save current report
```

要求：

- 明确“没有自动研究问答资产时不能生成报告”
- 覆盖旧报告，不保留版本历史

- [ ] **Step 2: Implement message selection rules for report input**

伪代码：

```text
isAutoResearchMessage(message):
  use system-owned metadata / role / naming convention available from NotebookLM integration

collectResearchCorpus(messages):
  return only eligible messages
```

要求：

- 这里必须把“如何识别自动研究问答”做成明确规则
- 如果 SDK 当前拿不到足够元信息，需要在本任务里同时定义一个最小可执行约束

- [ ] **Step 3: Add `POST /api/notebooks/:id/report/generate` route**

伪代码：

```text
POST /report/generate
  validate notebook id
  call reportService.generateReport(id)
  return success or business error
```

要求：

- 失败时返回明确业务错误，不返回模糊 500
- 成功时不必直接回传整篇报告，可让前端再 `GET /report`

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- report route 与 report service 编译通过

- [ ] **Step 5: Commit**

```bash
git add server/src/report/service.ts server/src/routes/notebooks/index.ts server/src/report
git commit -m "feat: generate and store current notebook research reports"
```

---

## Task 6: Rewire The Notebook Workbench Frontend To Real Data And SSE

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/components/notebook-workbench/StudioPanel.vue`
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
- Modify: `client/src/components/notebook-workbench/NotebookTopBar.vue`
- Modify: `client/src/utils/not-implemented.ts`
- Create or Modify: any small local view-model helpers needed under `client/src/`

- [ ] **Step 1: Update client-side types to reflect real notebook + runtime + report models**

伪代码：

```text
Notebook
Source
ChatMessage
ResearchRuntimeState
ResearchRuntimeEvent
ResearchReport
```

要求：

- 删除只服务 stub 的 `ResearchEntry` 依赖
- 与后端接口字段保持一致

- [ ] **Step 2: Change the workbench page to load real notebook data and report data in parallel**

伪代码：

```text
on route change:
  load notebook
  load sources
  load messages
  load report
  keep existing stale-request protection
```

要求：

- 保留当前 route-change stale request guard
- 不再请求旧的 stub research entry 和 studio tools endpoint，除非仍有明确展示价值

- [ ] **Step 3: Always establish the notebook SSE subscription after initial page load**

伪代码：

```text
watch notebookId:
  close old stream
  connect new stream immediately
  update local runtime state from SSE events
```

要求：

- 满足已修订的 spec 13.1
- 即使当前没有运行中的研究，也建立 SSE 连接

- [ ] **Step 4: Rework Studio panel from placeholder mode to control/status mode**

伪代码：

```text
StudioPanel props:
  runtimeState
  currentReport
  onStartResearch
  onGenerateReport

render:
  start button
  runtime summary
  report action / summary
```

要求：

- 自动研究按钮在运行中禁用
- 没有问答资产时，生成报告按钮禁用或明确提示
- 保持页面结构仍是右侧 Studio 控制台

- [ ] **Step 5: Trigger data refreshes at key points**

伪代码：

```text
on runtime progress milestone:
  refetch messages

on report generated:
  refetch report
```

要求：

- 遵守 spec 中“真正实时的是运行态，Notebook 数据以步骤后刷新为主”

- [ ] **Step 6: Shrink `not-implemented` usage to only genuinely unfinished actions**

伪代码：

```text
automatic research path -> real implementation
generate report path -> real implementation
other unfinished buttons -> showNotImplemented(...)
```

要求：

- 不要让自动研究和报告按钮继续走建设中提示
- 剩余未接入动作仍复用统一反馈

- [ ] **Step 7: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- 页面构建通过
- SSE、并行加载、按钮状态逻辑无类型错误

- [ ] **Step 8: Commit**

```bash
git add client/src/api/notebooks.ts client/src/api/sse.ts client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench client/src/utils/not-implemented.ts
git commit -m "feat: connect notebook workbench to real notebook data and runtime"
```

---

## Task 7: Verify End-To-End Behavior And Preserve Existing Paths Safely

**Files:**
- Modify only if verification reveals issues

- [ ] **Step 1: Run full build verification**

Run:

- `npm run build --workspace server`
- `npm run build --workspace client`

Expected:

- server PASS
- client PASS

- [ ] **Step 2: Run repository test command**

Run:

- `npm test`

Expected:

- existing test/build pipeline passes, or any failure is investigated before completion

- [ ] **Step 3: Smoke-check notebook route behavior manually**

Checklist:

```text
open /notebook/<real-notebook-id>
confirm notebook details load from NotebookLM
confirm sources render
confirm messages render
confirm SSE connection establishes without requiring a running task
click start auto research and confirm Studio state changes
refresh page and confirm SSE reconnects
click generate report only after enough research data exists
confirm report can be read after generation
```

- [ ] **Step 4: Smoke-check error conditions manually**

Checklist:

```text
use invalid notebook id -> confirm clear error state
simulate auth expiry or missing login -> confirm clear auth error
try generating report before research corpus exists -> confirm business error
```

- [ ] **Step 5: Assess whether old `/api/research` and worker code remain needed immediately**

Checklist:

```text
confirm new notebook workbench path no longer depends on old research routes
if old routes are still exposed, document whether they are legacy-only
do not remove legacy code in verification unless removal is already proven safe
```

- [ ] **Step 6: Commit any final fit-and-finish fixes**

```bash
git add .
git commit -m "fix: polish notebook single-source research flow"
```

仅在验证阶段产生实际修复时执行此提交；若无改动则跳过。

---

## Self-Review Checklist

在执行前，先对照 spec 做一次快速核对：

- `/notebook/:id` 是否直接对应真实 NotebookLM 笔记 ID
- Notebook 详情、来源、问答是否全部来自 NotebookLM，而不是 stub 或本地镜像
- 页面初始加载后是否始终建立 SSE 订阅
- 自动研究是否由服务端后台驱动，而不是依赖页面在线
- SSE 是否只负责运行态观测，而不是操作通道
- 正式报告是否只保存在我们自己的系统中
- 本地数据库是否只增加/保留正式报告资产，而不是继续保存 questions 正文
- 重新生成报告是否覆盖旧报告
- 旧 `/api/research` 路径是否已与新页面解耦，但没有被鲁莽删除

再做一次占位词扫描，确保计划中没有：

- 占位符类字样
- “实现细节后补”
- 引用未定义 route、type、service 名称

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-03-notebooklm-single-source-research.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
