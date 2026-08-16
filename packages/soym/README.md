# soym/ — SOYM wiki quant adaptation

English | [中文](README.zh.md)

Fork-local adaptation of the harness for the SOYM wiki quant research system (an Obsidian workspace with Python factor/backtest scripts, a Node dashboard, and a local RAG knowledge base). This group hosts model-facing tools that encode the system's operating rules as first-class harness capabilities.

| Package | Role | ctx key |
|---|---|---|
| [`soym-quant/`](soym-quant/README.md) (`@deepseek-ai/dsh-soym-quant`) | `soym_commit` — stages and commits the workspace with git, enforcing the in-session commit discipline (铁律9). | registers on `ctx.tools` |
| [`soym-evolve/`](soym-evolve/README.md) (`@deepseek-ai/dsh-soym-evolve`) | `soym_learn` / `soym_recall` — cross-session experience journal: persist verified lessons at session end, inject them at the next session's start. | registers on `ctx.tools` |

The shipped `soym-quant` agent preset (`apps/cli/config/agent-presets/soym-quant/`) composes this package with the SOYM persona; the [cookbook guide](../../docs/cookbook/soym-quant.md) explains the whole adaptation.
