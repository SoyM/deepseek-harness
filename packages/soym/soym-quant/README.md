# @deepseek-ai/dsh-soym-quant

English | [中文](README.zh.md)

The model-facing `soym_commit` tool for the SOYM wiki quant system: stages and commits workspace changes with git, enforcing the operating rule that code, test, and config changes are committed in the session that made them (SOYM 铁律9 — auto-commit only covers data artifacts and lets source changes pile up uncommitted).

## What it does

Registers one tool, `soym_commit(message, paths?)`, on `ctx.tools`. It runs the real `git` binary in the configured `workspace`:

1. stage: `git add -A` (or `git add -- <paths>` when `paths` is given),
2. commit: `git commit -m <message>`,
3. read back: `git rev-parse HEAD` for the full hash.

Each step has its own subprocess with a bounded capture buffer (16 MiB) and the configured timeout; a timeout kill or a spawn failure (missing binary) resolves as exit code 1 with the reason appended to the output. Combined output returned to the model is capped at 4000 characters.

## Results

- A commit created: `{ ok: true, committed: true, hash, summary, output }`.
- Git's own "nothing to commit" exit: `{ ok: true, committed: false, output }` — a clean report, not a failure, because committing nothing is a legitimate answer for an already-clean tree.
- Any other nonzero exit (stage or commit failure, not a git repository): `{ ok: false, committed: false, output }`.

`execute` rejects an empty or whitespace-only `message` and an explicitly empty `paths` array before any subprocess runs.

## Configuration

`workspace` is required — the SOYM repository root is a deployment choice, never guessed. `gitBin` (default `git`), `timeoutMs` (default 60000), and `commitAll` (default true) are optional; `commitAll: false` forces every call to name `paths` explicitly and fails loud otherwise. Defaults come from the schemastery `Config` schema and are asserted by tests.

## Commit discipline

The tool exists because the SOYM operating manual (铁律9) requires in-session commits for source changes: `git add -A && git commit` in the session that made the changes, verified by the review gate before merging. The model-facing description pins this discipline verbatim.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `Config` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`soym_commit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-soym-quant): required `message` (imperative commit subject), optional `paths` (restrict staging instead of the whole tree).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains `message` (and `paths` when given) in its arguments. Success returns exactly `Committed <7-char hash>: <subject>` or `Working tree clean — nothing to commit.`; failure returns `git failed: <captured output>` with the git stderr/stdout bounded to 4000 characters. Stable rejections are ``Error: soym_commit: `message` must be a non-empty commit subject`` and ``Error: soym_commit: `paths` must not be empty when given``.

#### Token effect

Result size is bounded by the 4000-character output cap; arguments stay until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Stateless single-shot commits only** — no partial staging trees beyond one `paths` list, no amend, no push, no commit-message editing. Each call is one add + commit against the current tree.
- **The SOYM RAG, review-gate, and decision-authority workflows remain shell-level skills** — the fork deliberately ships only the commit tool for now; the other operating rules (铁律4/6/8) stay encoded in the preset persona and workspace instructions. See the Agent Note.
- **Git identity is not managed** — a repository without `user.name`/`user.email` fails the commit step with git's own error.
