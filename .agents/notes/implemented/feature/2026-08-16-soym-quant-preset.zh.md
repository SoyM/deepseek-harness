# Agent Note: SOYM 量化 agent preset

Status: implemented

[English](2026-08-16-soym-quant-preset.md) | 中文

## Problem

SOYM wiki 量化系统（Obsidian 工作区：Python 因子/回测脚本、Node 仪表盘、本地 RAG 知识库）有自己的操作手册（`AGENTS.md` 铁律），通用 harness 没有把它编码进来。最尖锐的痛点是提交纪律：2026-08-12 实证 95 个源码文件悬在工作区未提交——auto-commit 只进数据产物（铁律9 正是从那次事件写下的）。fork 需要把手册规则变成一等能力的 preset 与工具。

## Decision

[SoyM/deepseek-harness](https://github.com/SoyM/deepseek-harness) fork 新增两样东西：

- **`soym-quant` agent preset**（`apps/cli/config/agent-presets/soym-quant/`）：`standard` 组合 + 中文 SOYM persona，钉住操作纪律（RAG 优先作答、信号分层、决策授权、纠错义务、单测门禁、会话内提交纪律），并指向工作区 `AGENTS.md` 作为完整手册。preset 只挂一行 SOYM 专属行 `tool-soym-commit`。
- **`@deepseek-ai/dsh-soym-quant` 包**（`packages/soym/soym-quant/`）：注册 `soym_commit(message, paths?)` 工具。通过 `node:child_process` 的 `execFile` 运行真实 git 二进制（无 shell、捕获有界、按命令超时），`git add -A`（或 `git add -- <paths>`）暂存、提交、`rev-parse HEAD` 回读。`workspace` 是必填配置字段（preset 用 `process.cwd()` 钉住）；`gitBin`、`timeoutMs`、`commitAll` 经 schemastery Config 给出默认值。git 的「nothing to commit」退出报告为 `{ ok: true, committed: false }` 而非失败；其他任何非零退出返回 `{ ok: false }` 并带截断输出。给模型的输出上限 4000 字符。

`soym` 包组及其单包加入仓库接线（tsconfig 通配、host aggregate 引用、`apps/cli` 依赖、packages 表），因为 shipped preset 的行通过 dsh 应用的依赖面解析插件。

## Alternatives considered

### 完整 SOYM 工具集包（RAG 咨询、RAG 健康、review gate、决策授权）

操作手册暗示五个自然工具。用户明确把 fork 范围收敛到只做提交工具；其余规则继续编码在 preset persona 与工作区 `AGENTS.md` 中，RAG 工作流继续走既有的 `.dsh/skills`（soym-rag-consult、soym-rag-watchdog）。这样 fork 的新增面最小、可审。

### 只做 skill（不建包、不建工具）

提交纪律可以继续作为 skill 教模型用 shell 跑 `git add -A && git commit`。一等工具在强制力上胜出：schema 校验的 message、有界输出、显式 workspace、干净的 nothing-to-commit 语义、模型可行动的稳定错误文本——这些都不是散文 skill 能保证的。

### 用 example leaf 而非 shipped preset

可运行的 `examples/soym-quant/` leaf 能演示组合，但不会出现在部署的 agent-preset 列表中。用户的诉求是 harness 适配，所以 preset 才是产品；cookbook 页记录从 fork 运行它的方法。

### 用 `dsh-subprocess` 服务执行 git

subprocess 能力族服务于带生命周期所有权的受管进程树。`soym_commit` 只需要「跑完收输出」，`node:child_process` 的 `execFile` 无服务依赖即可提供；用服务反而要求每个组合（包括 shipped preset 的 host 平面）都保证 provider，把一个无状态工具耦合到它用不到的能力上。

## Consequences

- fork 的 `soym-quant` preset 只有从 fork 源码运行 `dsh`（或部署里可解析构建产物）时才开箱即用；普通 npm 安装不认识 `@deepseek-ai/dsh-soym-quant`。cookbook 页写明这一点。
- 工具不做 push、amend 或复杂暂存树编排；每次调用就是一次 add + commit。git 身份是仓库自己的事。
- 包测试覆盖：单测（mock `execFile`，逐文件 100% 覆盖率）、真实临时 git 仓库上的真实 Loader 组合测试、真实仓库上的全 agent-loop 集成测试；只有模型是 mock 的。
- 其余铁律（RAG 咨询、review gate、决策授权）推迟到 persona/工作区层；本 note 把它们记为将来用户需要时的自然扩展。
