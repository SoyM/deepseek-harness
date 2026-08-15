# Agent Note: SOYM quant agent preset

Status: implemented

English | [中文](2026-08-16-soym-quant-preset.zh.md)

## Problem

The SOYM wiki quant system (an Obsidian workspace with Python factor/backtest scripts, a Node dashboard, and a local RAG knowledge base) runs its own operating manual (`AGENTS.md` 铁律) that a generic harness does not encode. The sharpest failure was commit discipline: on 2026-08-12, 95 source files sat uncommitted in the workspace because auto-commit only covers data artifacts (铁律9 was written from that incident). The fork needs a preset and tooling that make the manual's rules first-class.

## Decision

The [SoyM/deepseek-harness](https://github.com/SoyM/deepseek-harness) fork ships two additions:

- **`soym-quant` agent preset** (`apps/cli/config/agent-presets/soym-quant/`): the `standard` composition with a Chinese SOYM persona that pins the operating rules (RAG-first answering, signal layering, decision authorization, correction duty, review gate, in-session commit discipline) and points at the workspace `AGENTS.md` for the full manual. The preset mounts one SOYM-specific row, `tool-soym-commit`.
- **`@deepseek-ai/dsh-soym-quant` package** (`packages/soym/soym-quant/`): registers the `soym_commit(message, paths?)` tool. It runs the real git binary through `node:child_process` `execFile` (no shell, bounded capture, per-command timeout), stages with `git add -A` (or `git add -- <paths>`), commits, and reads back `rev-parse HEAD`. `workspace` is a required config field (the preset pins it to `process.cwd()`); `gitBin`, `timeoutMs`, and `commitAll` default via the schemastery Config. Git's "nothing to commit" exit reports `{ ok: true, committed: false }` instead of failing; any other nonzero exit returns `{ ok: false }` with bounded output. Output to the model is capped at 4000 characters.

The `soym` package group and its single package join the repo wiring (tsconfig wildcards, host aggregate reference, `apps/cli` dependency, packages table) because shipped preset rows resolve plugins through the dsh app's dependency surface.

## Alternatives considered

### A full SOYM toolset package (RAG consult, RAG status, review gate, decision authority)

The operating manual suggests five natural tools. The user explicitly scoped the fork to the commit tool only; the other rules stay encoded in the preset persona and the workspace `AGENTS.md`, and the RAG workflows keep working as the existing `.dsh/skills` (soym-rag-consult, soym-rag-watchdog). This keeps the fork's new surface minimal and reviewable.

### Skills-only (no package, no tool)

The commit discipline could stay a skill instructing the model to run `git add -A && git commit` through the shell. A first-class tool wins on enforcement: schema-validated message, bounded output, explicit workspace, clean nothing-to-commit semantics, and stable error text the model can act on — none of which a prose skill guarantees.

### An example leaf instead of a shipped preset

A runnable `examples/soym-quant/` leaf would demonstrate the composition but not appear in the deployment's agent-preset roster. The user's request is a harness adaptation, so the preset is the product; the cookbook page documents running it from the fork.

### The `dsh-subprocess` service for git execution

The subprocess capability family exists for managed process trees with lifecycle ownership. `soym_commit` needs plain run-to-completion with captured output, which `node:child_process` `execFile` provides without a service dependency; using the service would also require every composition (including the shipped preset's host plane) to guarantee the provider, coupling a stateless tool to a capability it does not use.

## Consequences

- The fork's `soym-quant` preset works out of the box only when `dsh` runs from the fork source (or the built package is resolvable in the deployment); a stock npm installation does not know `@deepseek-ai/dsh-soym-quant`. The cookbook page states this.
- The tool performs no push, amend, or partial-tree orchestration; each call is one add + commit. Git identity is the repository's responsibility.
- The package is covered by unit tests (mocked `execFile`, 100% per-file coverage), a real-Loader composition test over a real temporary git repository, and a full agent-loop integration test over a real repository; only the model is mocked.
- The remaining 铁律 (RAG consult, review gate, decision authorization) are deferred to the persona/workspace layers; the note records them as the natural next tools if the user wants them later.
