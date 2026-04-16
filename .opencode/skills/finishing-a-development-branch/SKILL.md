---
name: finishing-a-development-branch
description: 当实现完成、所有测试通过，你需要决定如何集成工作时使用 —— 通过呈现合并、PR 或清理的结构化选项来指导完成开发工作
---

# finishing-a-development-branch

## 概述

通过呈现清晰的选项并处理选择的工作流来指导完成开发工作。

**核心原则：** 验证测试 → 呈现选项 → 执行选择 → 清理。

**开始时宣布：** "我正在使用 finishing-a-development-branch skill 来完成这项工作。"

## 流程

### 步骤 1：验证测试

**在呈现选项之前，验证测试通过：**

```bash
# 运行项目的测试套件
npm test / cargo test / pytest / go test ./...
```

**如果测试失败：**
```
测试失败（<N> 个失败）。必须在完成之前修复：

[显示失败]

在测试通过之前无法继续合并/PR。
```

停止。不要继续到步骤 2。

**如果测试通过：** 继续到步骤 2。

### 步骤 2：确定基础分支

```bash
# 尝试常见的基础分支
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

或者问："这个分支从 main 分出 —— 正确吗？"

### 步骤 3：呈现选项

呈现正好这 4 个选项：

```
实现完成了。你想怎么做？

1. 本地合并回 <base-branch>
2. 推送并创建 Pull Request
3. 保持分支原样（我稍后处理）
4. 放弃这项工作

哪个选项？
```

**不要添加解释** - 保持选项简洁。

### 步骤 4：执行选择

#### 选项 1：本地合并

```bash
# 切换到基础分支
git checkout <base-branch>

# 拉取最新
git pull

# 合并功能分支
git merge <feature-branch>

# 在合并结果上验证测试
<test command>

# 如果测试通过
git branch -d <feature-branch>
```

然后：如果存在隔离 workspace，则执行步骤 5 清理它

#### 选项 2：推送并创建 PR

```bash
# 推送分支
git push -u origin <feature-branch>

# 创建 PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## 摘要
<2-3 个更改要点>

## 测试计划
- [ ] <验证步骤>
EOF
)"
```

然后：如果存在隔离 workspace，则执行步骤 5 清理它

#### 选项 3：保持原样

报告："保持分支 <name>。Workspace 保留在 <path>。"

**不要清理 workspace。**

#### 选项 4：放弃

**首先确认：**
```
这将永久删除：
- 分支 <name>
- 所有提交：<commit-list>
- Workspace 在 <path>

输入 'discard' 确认。
```

等待精确确认。

如果确认：
```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

然后：如果存在隔离 workspace，则执行步骤 5 清理它

### 步骤 5：清理 Workspace（如存在）

**对于选项 1、2、4：如果当前工作是在隔离 workspace 中完成的：**

清理该任务使用的隔离 workspace：

```bash
# 删除该工作区目录
npx rimraf <workspace-path>
```

**对于选项 3：** 保留 workspace；如果当前并没有隔离 workspace，则无需任何清理。

## 快速参考

| 选项 | 合并 | 推送 | 保留 Workspace | 清理分支 |
|------|------|------|---------------|----------|
| 1. 本地合并 | ✓ | - | - | ✓ |
| 2. 创建 PR | - | ✓ | ✓ | - |
| 3. 保持原样 | - | - | ✓ | - |
| 4. 放弃 | - | - | - | ✓ (强制) |

## 常见错误

**跳过测试验证**
- **问题：** 合并坏代码，创建失败的 PR
- **修复：** 在呈现选项之前始终验证测试

**开放式问题**
- **问题：** "我下一步该做什么？" → 模糊
- **修复：** 呈现正好 4 个结构化选项

**假定 workspace 总是存在**
- **问题：** 在没有隔离 workspace 的会话里，步骤 5 不可执行或语义含混
- **修复：** 只有当前工作实际使用了隔离 workspace 时才执行清理

**放弃时没有确认**
- **问题：** 意外删除工作
- **修复：** 要求输入 "discard" 确认

## Commit 消息规则

**所有 commit 消息必须使用中文，并且使用 `type: 描述` 格式。** `type` 仅使用常见前缀，如 `fix`、`feat`、`chore`、`docs`、`refactor`、`test`、`ci`。

```bash
# 正确
git commit -m "fix: 修正用户认证流程"
git merge <feature-branch> -m "feat: 合并用户认证功能"

# 错误
git commit -m "add user authentication"
git commit -m "修正用户认证流程"
```

PR 标题同样使用 `type: 中文描述`；`--body` 内容使用中文撰写。

## 红线

**永远不要：**
- 在测试失败的情况下继续
- 不验证结果上的测试就合并
- 没有确认就删除工作
- 没有明确请求就强制推送
- 使用英文撰写 commit 消息或 PR 标题

**始终：**
- 在呈现选项之前验证测试
- 呈现正好 4 个选项
- 选项 4 需要输入确认
- 只在隔离 workspace 实际存在时清理它
- 用中文撰写所有 commit 消息和 PR 标题

## 集成

**被调用：**
- **subagent-driven-development**（步骤 7）- 所有任务完成后

**配合：**
- 无
