# SOYM wiki quant adaptation

English | [中文](soym-quant.zh.md)

A fork-local adaptation of the harness for the [soym-wiki](https://github.com/SoyM/soym-wiki) quant research system: an Obsidian workspace holding Python factor/backtest scripts, a Node dashboard, and a local RAG knowledge base at `localhost:3456`.

## What the fork adds

- **`soym-quant` agent preset** ([`apps/cli/config/agent-presets/soym-quant/`](../../apps/cli/config/agent-presets/soym-quant/preset.yml)) — the full coding agent (same composition as `standard`) with a Chinese SOYM persona that pins the operating rules (RAG-first answering, signal layering, decision authorization, correction duty, the review gate, in-session commit discipline) and points at the workspace `AGENTS.md` for the full manual.
- **`@deepseek-ai/dsh-soym-quant` package** ([`packages/soym/soym-quant/`](../../packages/soym/soym-quant/README.md)) — the model-facing `soym_commit` tool that stages (`git add -A` or scoped `paths`) and commits the workspace with the real git binary, enforcing the in-session commit rule (铁律9).

## Run from the fork

```sh
pnpm install
pnpm dsh --profile ... # or run the CLI from the fork; the soym-quant preset
                       # appears in the agent-preset roster of this build
```

Run `dsh` with the soym-wiki checkout as the working directory so `tool-soym-commit`'s `workspace` (the process working directory) points at the right repository; the persona and the workspace `AGENTS.md` then cover the session together.

## Install into an existing deployment

The preset rows resolve `@deepseek-ai/dsh-soym-quant` from the dsh app's dependency surface, so a stock npm installation does not know it. To use the preset with a running deployment: build the fork, then either run `dsh` from the fork source, or copy `apps/cli/config/agent-presets/soym-quant/` into the user preset root (`$DSH_HOME/.agent-presets/soym-quant/`) and make the built package resolvable there. An npm-cache installation is overwritten on upgrade; the fork is the durable home.

## Tool reference

`soym_commit(message, paths?)` — see the [package README](../../packages/soym/soym-quant/README.md) for the schema, config fields (`workspace` required; `gitBin`, `timeoutMs`, `commitAll` defaulted), result shapes, and Model Experience.
