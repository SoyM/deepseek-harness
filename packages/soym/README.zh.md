# soym/ — SOYM wiki 量化适配

[English](README.md) | 中文

面向 SOYM wiki 量化研究系统的 fork 本地适配（Obsidian 工作区：Python 因子/回测脚本、Node 仪表盘、本地 RAG 知识库）。本组托管把系统操作纪律编码为一等 harness 能力的模型可见工具。

| 包 | 角色 | ctx key |
|---|---|---|
| [`soym-quant/`](soym-quant/README.md)（`@deepseek-ai/dsh-soym-quant`） | `soym_commit` —— 用 git 暂存并提交工作区，强制会话内提交纪律（铁律9） | 注册于 `ctx.tools` |
| [`soym-evolve/`](soym-evolve/README.md)（`@deepseek-ai/dsh-soym-evolve`） | `soym_learn` / `soym_recall` —— 跨会话经验日志：会话结束时持久化已验证经验，下一次会话开始时注入 | 注册于 `ctx.tools` |

随 fork 发布的 `soym-quant` agent preset（`apps/cli/config/agent-presets/soym-quant/`）将本包与 SOYM persona 组合在一起；整体适配说明见 [cookbook 指南](../../docs/cookbook/soym-quant.md)。
