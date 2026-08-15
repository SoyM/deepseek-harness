/**
 * Model-facing `soym_commit` tool for the SOYM wiki quant system: stages and commits
 * workspace changes with git, enforcing the operating rule that code, test, and
 * config changes are committed in the session that made them. Named exports preserve
 * loader injection metadata.
 * @module @deepseek-ai/dsh-soym-quant
 */

import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'soym-quant'
export const inject = ['tools']

/** Plugin config: where and how `soym_commit` stages and commits. */
export interface Config {
  /** Repository root the tool stages and commits in. Required — the SOYM workspace is deployment-specific. */
  workspace: string
  /** Git executable. Defaults to `git`. */
  gitBin?: string
  /** Per-command timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
  /** Stage the whole tree (`git add -A`) when no paths are given. Defaults to true. */
  commitAll?: boolean
}

/** Schemastery configuration for the soym-quant consumer. */
export const Config: z<Config> = z.object({
  workspace: z.string().required(),
  gitBin: z.string().default('git'),
  timeoutMs: z.number().default(60_000),
  commitAll: z.boolean().default(true),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** One git subprocess outcome. */
interface RunResult {
  /** Process exit code; 1 when the process was killed by the timeout. */
  code: number
  /** Captured stdout. */
  stdout: string
  /** Captured stderr, plus a timeout marker or spawn failure when either occurred. */
  stderr: string
}

/** Cap on the combined output returned to the model. */
const OUTPUT_CAP_CHARS = 4000

/** Git's own "nothing to commit" exit (1) is a clean report, not a failure. */
const NOTHING_TO_COMMIT = /nothing to commit|no changes added to commit/i

/** The model-facing description, pinned verbatim and asserted by tests. */
const DESCRIPTION =
  'Commit pending changes in the SOYM wiki workspace as one git commit. Run it '
  + 'in the same session that made the changes: the SOYM operating rule (铁律9) '
  + 'requires code/test/config changes to be committed in-session — auto-commit '
  + 'only covers data artifacts and lets source changes pile up uncommitted. '
  + 'With no `paths`, the whole tree is staged (`git add -A`); pass `paths` to '
  + 'commit a subset. A commit with nothing staged reports committed=false '
  + 'instead of failing.'

/**
 * Run one git subprocess to completion and capture its output. Timeout kills and
 * spawn failures (missing binary, oversized output) resolve as exit code 1 with
 * the failure reason appended to stderr.
 * @param bin - the git executable.
 * @param args - command arguments.
 * @param cwd - working directory.
 * @param timeoutMs - per-command timeout in milliseconds.
 * @returns the process outcome.
 */
function run(bin: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(bin, [...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ code: 0, stdout, stderr })
        return
      }
      const timedOut = error.killed === true
      const spawnFailed = typeof error.code !== 'number'
      resolve({
        code: typeof error.code === 'number' ? error.code : 1,
        stdout,
        stderr: [
          stderr,
          ...(timedOut ? [`soym_commit: command timed out after ${timeoutMs}ms`] : []),
          ...(spawnFailed ? [error.message] : []),
        ].join('\n'),
      })
    })
  })
}

/** Bound and join the captured streams for the model. */
function combined(result: RunResult): string {
  const output = `${result.stdout}${result.stderr}`.trim()
  if (output.length <= OUTPUT_CAP_CHARS) return output
  return `${output.slice(0, OUTPUT_CAP_CHARS)}\n… (output truncated)`
}

/**
 * Stage and commit per the tool contract. A commit that has nothing staged is a
 * clean `{ ok: true, committed: false }` report; any other nonzero git exit is
 * a failure carrying the captured output.
 * @param config - resolved deployment config.
 * @param message - trimmed commit subject.
 * @param paths - explicit staging paths, or undefined for the whole tree.
 * @returns the tool result.
 */
async function stageAndCommit(config: ResolvedConfig, message: string, paths: string[] | undefined): Promise<CommitOutput> {
  const addArgs = paths !== undefined ? ['add', '--', ...paths] : config.commitAll ? ['add', '-A'] : null
  if (addArgs === null) {
    return { ok: false, committed: false, output: 'soym_commit: commitAll is disabled and no paths were given' }
  }
  const add = await run(config.gitBin, addArgs, config.workspace, config.timeoutMs)
  if (add.code !== 0) {
    return { ok: false, committed: false, output: combined(add) }
  }
  const commit = await run(config.gitBin, ['commit', '-m', message], config.workspace, config.timeoutMs)
  if (commit.code === 0) {
    const head = await run(config.gitBin, ['rev-parse', 'HEAD'], config.workspace, config.timeoutMs)
    const hash = head.code === 0 ? head.stdout.trim() : undefined
    return {
      ok: true,
      committed: true,
      ...(hash !== undefined ? { hash } : {}),
      summary: message,
      output: combined(commit),
    }
  }
  if (commit.code === 1 && NOTHING_TO_COMMIT.test(combined(commit))) {
    return { ok: true, committed: false, output: combined(commit) }
  }
  return { ok: false, committed: false, output: combined(commit) }
}

/** What `soym_commit` returns to the model. */
export interface CommitOutput {
  /** Whether the operation completed as intended (including a clean nothing-to-commit report). */
  ok: boolean
  /** Whether a commit was created. */
  committed: boolean
  /** Full commit hash when a commit was created. */
  hash?: string
  /** The committed subject line. */
  summary?: string
  /** Combined, bounded git output. */
  output: string
}

/**
 * Register the `soym_commit` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's explicit commit policy.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  ctx.tools.register(defineTool({
    name: 'soym_commit',
    description: DESCRIPTION,
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'Commit subject in imperative mood, e.g. "fix: correct PIT backtest date window".',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional paths to stage instead of the whole tree (git add -- <paths>).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          committed: { type: 'boolean', required: true },
          hash: { type: 'string' },
          summary: { type: 'string' },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.committed
          // `summary` is always set on the committed branch (stageAndCommit
          // pins it to the trimmed message), so no fallback is needed here.
          ? `Committed ${value.hash !== undefined ? value.hash.slice(0, 7) : '(unknown hash)'}: ${value.summary}`
          : value.ok
            ? 'Working tree clean — nothing to commit.'
            : `git failed: ${value.output}`,
      }],
    },
    async execute(args) {
      const message = args.message.trim()
      if (message.length === 0) {
        throw new Error('soym_commit: `message` must be a non-empty commit subject')
      }
      if (args.paths !== undefined && args.paths.length === 0) {
        throw new Error('soym_commit: `paths` must not be empty when given')
      }
      return stageAndCommit(resolved, message, args.paths)
    },
    presentCall: args => ({ card: 'generic', title: 'Commit SOYM changes', kind: 'other', rawInput: args.message }),
  }))
}
