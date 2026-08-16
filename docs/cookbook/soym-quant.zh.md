# SOYM wiki 量化适配

[English](soym-quant.md) | 中文

面向 [soym-wiki](https://github.com/SoyM/soym-wiki) 量化研究系统的 fork 本地适配：Obsidian 工作区，含 Python 因子/回测脚本、Node 仪表盘与 `localhost:3456` 的本地 RAG 知识库。

## fork 新增了什么

- **`soym-quant` agent preset**（[`apps/cli/config/agent-presets/soym-quant/`](../../apps/cli/config/agent-presets/soym-quant/preset.yml)）—— 功能完整的编码 Agent（与 `standard` 相同的组合），persona 换成中文 SOYM 身份并钉住操作纪律（RAG 优先作答、信号分层、决策授权、纠错义务、单测门禁、会话内提交），指向工作区 `AGENTS.md` 作为完整手册。
- **`@deepseek-ai/dsh-soym-quant` 包**（[`packages/soym/soym-quant/`](../../packages/soym/soym-quant/README.md)）—— 模型可见工具 `soym_commit`：用真实 git 二进制暂存（`git add -A` 或限定 `paths`）并提交工作区，强制执行会话内提交纪律（铁律9）。
- **`@deepseek-ai/dsh-soym-evolve` 包**（[`packages/soym/soym-evolve/`](../../packages/soym/soym-evolve/README.md)）—— 跨会话经验闭环：`soym_learn` 在会话结束时把已验证的经验写入 `.dsh/experience/`，`soym_recall` 在下一次会话开始时注入这些经验，让系统跨会话学习，而不是每次都从头重新踩坑。

## 从 fork 源码运行

```sh
pnpm install
pnpm dsh --profile ... # or run the CLI from the fork; the soym-quant preset
                       # appears in the agent-preset roster of this build
```

以 soym-wiki 检出目录作为工作目录运行 `dsh`，让 `tool-soym-commit` 的 `workspace`（进程工作目录）指向正确的仓库；persona 与工作区 `AGENTS.md` 共同覆盖会话。

## 装进已有部署

preset 的行通过 dsh 应用的依赖面解析 `@deepseek-ai/dsh-soym-quant`，普通 npm 安装不认识它。要在一个正在运行的部署里使用：先构建 fork，然后要么从 fork 源码运行 `dsh`，要么把 `apps/cli/config/agent-presets/soym-quant/` 拷进用户 preset 根目录（`$DSH_HOME/.agent-presets/soym-quant/`）并让构建产物可被解析。npm-cache 安装会在升级时被覆盖；fork 才是持久归宿。

## 工具参考

`soym_commit(message, paths?)` —— schema、配置字段（`workspace` 必填；`gitBin`、`timeoutMs`、`commitAll` 有默认值）、结果形态与 Model Experience 见[包 README](../../packages/soym/soym-quant/README.md)。

`soym_learn(category, title, body)` / `soym_recall(category?)` —— 见 [soym-evolve 包 README](../../packages/soym/soym-evolve/README.md)。经验日志位于工作区 `.dsh/experience/`，默认随 git 追踪。
