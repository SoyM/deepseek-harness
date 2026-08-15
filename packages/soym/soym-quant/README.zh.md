# @deepseek-ai/dsh-soym-quant

[English](README.md) | 中文

面向 SOYM wiki 量化系统的模型可见工具 `soym_commit`：用 git 完成工作区的暂存与提交，强制执行「代码/测试/配置改动须在本会话内提交」的操作纪律（SOYM 铁律9 —— auto-commit 只进数据产物，源码改动会被漏掉堆积）。

## 功能

在 `ctx.tools` 上注册一个工具 `soym_commit(message, paths?)`，在配置的 `workspace` 中调用真实 `git` 二进制：

1. 暂存：`git add -A`（传入 `paths` 时改为 `git add -- <paths>`）
2. 提交：`git commit -m <message>`
3. 回读：`git rev-parse HEAD` 取完整 hash

每一步都是独立子进程，捕获缓冲区上限 16 MiB，并受配置的超时约束；超时被杀或启动失败（找不到二进制）以退出码 1 返回并在输出中附上原因。返回给模型的合并输出截断到 4000 字符。

## 结果

- 提交成功：`{ ok: true, committed: true, hash, summary, output }`
- git 自身「nothing to commit」退出：`{ ok: true, committed: false, output }` —— 这是干净的报告而非失败，因为树已干净时「没有可提交内容」是合法答案
- 其他任何非零退出（暂存/提交失败、不是 git 仓库）：`{ ok: false, committed: false, output }`

`execute` 在任何子进程运行前拒绝空/纯空白 `message` 与显式空 `paths` 数组。

## 配置

`workspace` 必填 —— SOYM 仓库根目录是部署选择，绝不猜测。`gitBin`（默认 `git`）、`timeoutMs`（默认 60000）、`commitAll`（默认 true）可选；`commitAll: false` 强制每次调用显式给出 `paths`，否则响亮失败。默认值来自 schemastery `Config` schema 并由测试断言。

## 提交纪律

工具的存在意义：SOYM 操作手册（铁律9）要求源码改动在本会话内提交（合入前先过 review gate）。模型可见的工具描述逐字钉住了这条纪律。

## 导出形态

函数/命名空间插件：导出 `name` / `inject` / `Config` / `apply`，无 default 导出。多一个 `export default` 会让 Loader 的 `unwrapExports` 塌缩模块并丢掉 `inject`（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## Model Experience

### Tool schema

#### 模型看到什么

模型看到生成的 [`soym_commit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-soym-quant)：必填 `message`（祈使句提交主题）、可选 `paths`（限定暂存路径而非全树）。

#### Token 影响

工具可见的每次请求都有固定 schema 开销。

#### KV Cache 影响

定义与可见性不变时前缀稳定；插件生命周期或作用域限制可能使本 schema 的复用失效。

### Tool-call 历史与结果

#### 模型看到什么

每次调用在参数中保留 `message`（给出时含 `paths`）。成功返回精确文本 `Committed <7位hash>: <subject>` 或 `Working tree clean — nothing to commit.`；失败返回 `git failed: <捕获输出>`（git stderr/stdout 截断到 4000 字符）。稳定拒绝消息为 ``Error: soym_commit: `message` must be a non-empty commit subject`` 与 ``Error: soym_commit: `paths` must not be empty when given``。

#### Token 影响

结果大小受 4000 字符输出上限约束；参数保留至压缩。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀，不使既有 KV-cache 失效。

## Known Limitations and Deferred Work

- **仅无状态单次提交** —— 不支持一次 `paths` 之外的复杂暂存树、amend、push 或提交信息编辑；每次调用是对当前树的一次 add + commit
- **SOYM RAG、review gate 与决策授权仍停留在 shell 技能层** —— fork 有意只交付 commit 工具；其余操作纪律（铁律4/6/8）编码在 preset persona 与工作区指令中，见 Agent Note
- **不管理 git 身份** —— 仓库缺 `user.name`/`user.email` 时提交步骤以 git 自身报错失败
