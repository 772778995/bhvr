# 音频单槽位与远端唯一化设计

**当前状态：** 进行中

## 设计结论

音频产物不再沿用“可长期保留多条 artifact 历史并按旧 artifactId 继续轮询/补取”的统一模型，而改为每个 notebook 只维护一个当前音频槽位；远端 NotebookLM 侧同时最多保留一个 audio overview，本地仅保留当前成功音频和当前任务状态，失败任务不得污染历史可用音频。

## 问题归因

当前实现为了绕过 NotebookLM 音频 overview 的 notebook 级歧义，在创建新音频前删除远端旧 audio。但本地仍保留多条 audio artifact entry，并继续按旧 artifactId 轮询、补取、渲染。这导致本地条目与远端真实资源失配：旧 audio 远端已删除，本地条目仍显示 creating/ready；`getArtifact(oldArtifactId)` 可能返回 not found、错误状态，甚至类型错乱。用户看到的现象包括音频状态不更新、列表观感异常、失败条目混入、历史报告似乎“消失”等。

## 目标

1. 每个 notebook 同时只允许一个音频任务进行中。
2. 远端 NotebookLM 同时只保留一个 audio overview。
3. 本地只保留一个“当前音频”条目，而不是多条 audio 历史。
4. 如果 NotebookLM 成功但本地下载/落盘失败，立即删除远端音频，任务标记失败，不覆盖已有成功音频。
5. 报告等其它产物继续保留多条历史，不受 audio 单槽位策略影响。

## 后端方案

### 1. 创建互斥

`POST /api/notebooks/:id/artifacts` 在 `type === "audio"` 时先检查本地该 notebook 是否已存在处于进行中的音频任务。若存在，则直接返回 `409`，拒绝新的音频创建。

进行中的定义：本地 audio entry 状态为 `creating`。

### 2. 单槽位替换

创建新音频前：

- 删除远端 NotebookLM 侧所有 audio artifacts，保证 overview 唯一。
- 删除或覆盖本地旧的 audio artifact entry，保证列表中只保留一个当前音频槽位。

本地推荐采用“复用旧 audio entry 行”的方式：

- 如果 notebook 已存在 audio entry，则在创建新音频前把该 entry 重置为 `creating`、清空旧 `artifact_id` / `file_path` / `content_json` / `error_message` / `title`，再写入新的 `artifact_id`。
- 如果不存在，则插入新 audio entry。

这样前端列表不会不断新增无效 audio 历史，状态也能稳定绑定到同一条本地 entry。

### 3. 成功路径

音频 READY 后：

- 优先通过 notebook-level overview RPC 获取音频字节。
- 仅在 overview 不返回字节时，再尝试 artifact-specific URL fallback。
- 下载内容必须经过 MIME 和 HTML 守卫校验，禁止把登录页或其它 HTML 当成音频存盘。
- 成功落盘后，将单槽位 audio entry 标记为 `ready` 并写入 `file_path`。

### 4. 失败路径

若出现以下任一情况：

- NotebookLM 返回 FAILED
- overview 与 fallback 都无法得到真实音频字节
- 下载到 HTML/登录页

则：

- 删除这次新建的远端 audio artifact
- 本地当前 audio entry 标记为 `failed`
- 不生成新的历史 audio entry

## 前端方案

### 1. 列表语义

报告列表继续展示所有 `research_report` 历史，但 audio 永远只显示单条当前音频项。

### 2. 详情页逻辑

移除当前为多条 audio 历史存在而加上的 repair/workaround 逻辑：

- `audioRepairAttemptedEntryId`
- 本地 merge repair entry 状态
- 旧 artifactId 反复补取

详情页对 audio 的判断简化为：

- `ready + fileUrl`：可播放
- `creating`：生成中
- `failed`：生成失败

### 3. 状态刷新

生成音频后，前端仍通过现有列表刷新/轮询机制更新唯一 audio entry，但目标始终是同一条本地 entry，而不是不断追加新 audio 历史。

## 清理范围

需要删除前面为多条 audio artifact workaround 引入的代码与测试，包括但不限于：

- 前端 detail panel 的 audio repair 状态管理与 merge helper
- 不再符合新语义的“旧 audio artifact 仍可后补文件”逻辑
- 针对多条本地 audio 历史的兼容判断

保留：

- overview 优先的音频字节获取逻辑
- HTML 登录页守卫
- 远端创建前清理旧 audio 的逻辑

## 验证

1. notebook 连续生成两个音频时，列表中始终只显示一个 audio entry。
2. 新音频创建期间再次点击生成，后端返回 `409`，前端提示已有音频任务进行中。
3. 新音频成功时，列表状态从 `creating` 变 `ready`，无需手动刷新。
4. 新音频失败时，列表状态变 `failed`，不会残留旧远端 audio 与多条本地 audio 历史。
5. 研究报告列表仍完整显示，不受 audio 单槽位策略影响。
