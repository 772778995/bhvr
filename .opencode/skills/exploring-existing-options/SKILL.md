---
name: exploring-existing-options
description: "在功能设计、技术选型或考虑自研之前使用，用于系统化探索 GitHub、Context7、npm、PyPI 等现成方案，并按质量、活跃度和维护信号筛选候选项。"
---

> **迁移说明：** 此 skill 的执行逻辑已迁移至 `@explore` 专用子代理。主代理应通过派遣 `@explore` 子代理来执行探索任务，而非直接加载此 skill。此文件保留作为内部参考文档。

# exploring-existing-options

先扫市场，再谈自研。目标不是凑一篇中立综述，而是给出带判断的候选清单：哪些能直接集成，哪些只是陪跑，哪些应该淘汰。

## 何时使用

- 在 brainstorm、技术选型、build-vs-buy 或架构决策之前
- 用户要求你"先探索现成方案"、"看看 GitHub/npm/pip/文档"
- 你怀疑第三方库、框架或服务已经覆盖了大部分需求
- 你需要判断某个生态里的主流做法，而不是直接拍脑袋自研

**不使用当：**

- 问题纯粹是内部业务规则或仓库私有约定，外部现成方案几乎不相关
- 用户明确要求只讨论当前仓库内部实现，不考虑外部依赖或模式

## 输出

调研结束后返回：

- **推荐** — 1-2 个真正值得继续看的候选项
- **次选** — 可行但有明显短板的候选项
- **淘汰** — 明确不推荐的候选项及淘汰理由
- **质量信号** — 维护新鲜度、生态采用度、文档/API 质量、项目匹配度
- **探索结论** — 对 build-vs-buy 的推荐输入：更像是直接集成 / 在现有方案上扩展 / 没有合格方案再考虑自研；不要停在中立综述
- **边界** — 这是上游 brainstorm/选型流程的决策输入，不替代最终设计方向拍板

## 工作流

1. **识别搜索面** — 先看任务和项目线索，决定该搜哪些来源
2. **并行搜候选项** — GitHub、Context7、包注册表彼此独立，尽量并行
3. **做质量筛选** — 不要只看 stars；检查维护、采用、文档和适配度
4. **形成 shortlist** — 给出推荐、次选、淘汰和探索结论，供上游形成最终方向

不是每个任务都要命中所有来源。搜索面由问题决定：开源库优先 GitHub + registry，闭源 SaaS/商业产品优先官网与产品文档，GitHub 只作为辅助信号。

## 搜索面

### GitHub

- 开源候选默认优先搜 GitHub：用 `gh search repos` 找项目、库和参考实现
- 如果候选主要是闭源 SaaS、商业产品或官方文档站，官网/产品文档优先，GitHub 只作为辅助信号
- 对 serious candidates 检查：README、项目结构、最近 push/release、是否 archived、issues/PR 是否还有生命迹象、examples 是否真实
- 对通用基础设施类库，默认优先看 `stars 1k+` 且最近半年仍有维护的项目
- 对细分垂直库，`stars` 可以低一些，但必须用更强的文档、registry 信号和维护节奏来补

### Context7

- 对 serious candidates 用 Context7 查官方文档、API 设计和代码示例
- Context7 用来判断：文档质量、能力覆盖、API 粗糙度、最佳实践，而不是复制营销文案
- 没有 Context7 资料时，明确说没有；不要假装已经核过官方文档

### JS/TS 生态：npm

当项目或需求明显落在 JS/TS 生态时，除了 GitHub 还要搜 npm。常见线索：`package.json`、`tsconfig.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lockb`。

- 搜 npm 候选项，不要只搜 GitHub 仓库
- 对 serious candidates 检查 registry 元数据：发布时间线、最近版本、license、repository、maintainers、`types`/`typings`、`engines`、模块格式
- 如果环境允许，补充官方 npm download API 的近期下载量信号
- TypeScript 项目优先考虑自带类型、类型质量明确、最近仍在发版的包

### Python 生态：PyPI

当项目或需求明显落在 Python 生态时，除了 GitHub 还要搜 PyPI。常见线索：`pyproject.toml`、`requirements*.txt`、`poetry.lock`、`Pipfile`。

- 搜 PyPI 候选项，或先从 GitHub/文档里识别包名，再回到 PyPI 验证元数据
- 对 serious candidates 检查 PyPI 元数据：release timeline、classifiers、支持的 Python 版本、project URLs、wheel/sdist 情况
- 如果下载量没有可靠来源，就明确说没有，不要编造
- Python 项目优先考虑最近仍在发版、版本支持清晰、仓库还在维护、文档和 examples 完整的包

### 其它生态

- 如果项目明显属于别的生态，也按同样原则去对应 registry 查：例如 crates.io、RubyGems、NuGet、Maven Central、Packagist
- 不要因为 skill 里没列到某个 registry，就退回只看 GitHub stars

## 质量门

| 维度 | 要检查什么 |
|------|------------|
| **维护新鲜度** | 最近 push/release 是否还活着；fast-moving 工具默认看 6 个月内，稳定工具默认看 12 个月内；更久要有明确理由 |
| **生态采用度** | GitHub stars、dependents、registry 下载量或生态提及度；按赛道判断，不要迷信单一指标 |
| **文档与 API** | README 是否完整、Context7/官方 docs 是否清晰、examples 是否真实、API 是否粗糙 |
| **生态适配度** | TS 类型、Python classifiers、运行时支持、license、deprecated/archived/security 信号 |
| **项目匹配度** | 真正需要的功能覆盖多少、集成成本多高、缺口是否能接受 |

**质量底线：**

- 已归档、已废弃、长时间无人维护、license 不合规的包，直接淘汰
- 如果一个库在 GitHub 很热，但 registry 发版停滞、类型糟糕、运行时不兼容，也不要推荐
- 如果一个库 stars 不高，但 registry 使用广、发版稳定、文档好、能力匹配，可以保留为 serious candidate

## 形成 shortlist

- shortlist 不是候选项大杂烩，只保留真正值得比较的 2-4 个
- 如果已有方案覆盖了 80% 以上需求，默认推荐集成或轻度扩展，不要急着自研
- 如果没有一个候选项达到质量门，直接说没有，不要为了显得周全硬塞次优方案
- 输出必须按主观排序：`推荐`、`次选`、`淘汰`

## 常见错误

- **只看 GitHub stars** — 这会漏掉 registry 里的真实采用度和发版健康度
- **只看 docs 不看 registry** — 文档顺眼不代表包还活着
- **只搜 GitHub 不搜 npm/PyPI** — 对 JS/TS 或 Python 来说，这是探索不完整
- **把陈旧包和活跃包并列比较** — 这是假平衡
- **下载量没有可靠来源却照样写** — 这是编造，不是探索
- **明明现成方案够用，还继续往自研方向包装** — 这是在替用户合理化炫技

## 红线 - 停止装懂

- "GitHub 上看着不错，registry 我就不看了"
- "README 挺完整，应该没问题"
- "PyPI 下载量不好找，我先随便写个大概"
- "这个库两年没发版，但 stars 很高，应该没关系"
- "我先把所有候选项都列上，后面再说推荐"

**所有这些意味着：** 你的探索还不够扎实。停下，补齐 registry、维护和文档信号，再给 shortlist。

## 快速参考

| 来源 | 作用 | 重点信号 |
|------|------|----------|
| **GitHub** | 看仓库生命力和项目结构 | stars、最近 push/release、archived、issues/PR、examples |
| **Context7** | 看官方文档和 API | API 设计、能力覆盖、最佳实践、docs 清晰度 |
| **npm** | 看 JS/TS 包真实可用性 | 发布时间线、下载量、types、engines、license、maintainers |
| **PyPI** | 看 Python 包真实可用性 | 发布时间线、classifiers、Python 支持、project URLs、wheel/sdist |

## 结论

探索不是信息搬运。你是在做第三方方案尽调。

搜全、筛严、排序、下判断。然后把结果交给上游的 brainstorm 或选型流程来形成最终设计方向，而不是把一堆链接扔给用户自己消化。
