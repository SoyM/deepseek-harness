# @deepseek-ai/dsh-soym-evolve

English | [中文](README.zh.md)

Cross-session experience loop for the SOYM wiki quant system: `soym_learn` persists a verified lesson into the git-tracked journal at `<workspace>/.dsh/experience/`, and `soym_recall` reads the most recent lessons back so the next session starts on the previous session's shoulders.

The loop closes the gap between "the session learned something" and "the system knows it": without it, every fresh session re-learns the same traps — a verified conclusion from one session is lost when the session ends. With it, lessons become durable, reviewable, git-diffable knowledge.

## What it does

Registers two model-facing tools on `ctx.tools`:

- **`soym_learn(category, title, body)`** — appends one lesson to today's journal file (`.dsh/experience/YYYY-MM-DD.md`), creating the directory and file as needed. Each lesson is a markdown block:

  ```markdown
  ## [category] title

  body
  ```

  The tool returns `{ ok, file, entriesInFile, chars }` so the model (and the UI) can confirm persistence.

- **`soym_recall(category?)`** — reads the most recent `recallDays` daily files, parses every lesson block, optionally filters by category, and returns `{ ok, lessons, text, total, reason? }`. Lessons are sorted newest day first; `text` is the combined, `maxRecallChars`-bounded body the model can quote directly. An empty journal reports `total: 0` with a `reason`, never an error.

## When to call each tool

- **`soym_recall` at session start** — before answering investment or framework questions, so verified conclusions (falsified approaches, working parameters, process traps) are in context.
- **`soym_learn` at session end** — for any non-trivial finding: a verified conclusion, a trap avoided, a decision and why, a parameter that worked. Keep the body specific and actionable (numbers and reasoning, not vibes).

The tool descriptions pin these semantics verbatim; the preset persona should reference them (see the `soym-quant` preset for the persona pattern).

## Configuration

`workspace` is required — the SOYM repository root is a deployment choice, never guessed. Optional fields:

| Field | Default | Meaning |
|---|---|---|
| `journalDir` | `.dsh/experience` | Journal directory, relative to the workspace. |
| `recallDays` | `7` | How many most-recent daily files `soym_recall` reads. |
| `maxRecallChars` | `6000` | Cap on the combined recall text returned to the model. |

Defaults come from the schemastery `Config` schema and are asserted by tests.

## Storage format

- One file per day: `.dsh/experience/YYYY-MM-DD.md` (local date).
- Each lesson is a `## [category] title` markdown block followed by a blank line and the body.
- The journal is git-tracked by default (it lives inside the workspace), so lessons are diffable and reviewable like any other wiki content. If you prefer it untracked, add `.dsh/experience/` to `.gitignore` — the tools do not care either way.
- File names are timezone-local; the date is computed at write time, not derived from the environment clock.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `Config` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

Pure journal functions (`journalDirOf`, `appendLesson`, `readLessons`) are exported for direct unit testing without a tool runtime.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`soym_learn` and `soym_recall` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-soym-evolve): `soym_learn` requires `category` (string), `title` (string), and `body` (string); `soym_recall` takes an optional `category` (string) filter.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains its arguments. `soym_learn` success returns exactly `Lesson persisted to <file> (<n> entries, <chars> chars).`; empty required fields reject with ``Error: soym_learn: `category` must be non-empty`` (and the matching `title`/`body` messages). `soym_recall` renders the bounded lesson text, or the journal's `reason` when it is empty (e.g. `journal does not exist yet — nothing to recall`).

#### Token effect

`soym_learn` result size is bounded by the journal block the model writes; `soym_recall` text is capped by `maxRecallChars` (default 6000). Arguments stay until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Plain markdown journal, not a query engine** — `soym_recall` returns the most recent `recallDays` daily files with optional category filtering; there is no full-text search, tag taxonomy, or cross-file deduplication. Lessons are deduplicated by the human editor, not by the tools.
- **Recall window is date-based, not lesson-count-based** — a day with many lessons and a day with one weigh equally in the window.
- **No automatic session-end capture** — the tools persist what the model calls them with; the preset persona should direct `soym_learn` at session end, but nothing in this package forces it.
- **Concurrent writers are last-write-wins** — two sessions appending to the same day file race on read-modify-write; the SOYM wiki is single-user, so this is accepted rather than locked.
