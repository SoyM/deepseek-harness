/**
 * Cross-session experience loop for the SOYM wiki: `soym_learn` persists a
 * verified lesson into `<workspace>/.dsh/experience/`, and `soym_recall` reads
 * the most recent lessons back so the next session starts on the previous
 * session's shoulders. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-soym-evolve
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'soym-evolve'
export const inject = ['tools']

/** Plugin config: where the experience journal lives and how much recall returns. */
export interface Config {
  /** Repository root the experience journal lives under. Required — the SOYM workspace is deployment-specific. */
  workspace: string
  /** Journal directory relative to the workspace. Defaults to `.dsh/experience`. */
  journalDir?: string
  /** How many most-recent daily files `soym_recall` returns. Defaults to 7. */
  recallDays?: number
  /** Cap on the combined recall text returned to the model. Defaults to 6000 characters. */
  maxRecallChars?: number
}

/** Schemastery configuration for the soym-evolve consumer. */
export const Config: z<Config> = z.object({
  workspace: z.string().required(),
  journalDir: z.string().default('.dsh/experience'),
  recallDays: z.number().min(1).default(7),
  maxRecallChars: z.number().min(500).default(6000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** What `soym_learn` returns to the model. */
export interface LearnOutput {
  /** Whether the lesson was persisted. */
  ok: boolean
  /** Path of the journal file the lesson was appended to, relative to the workspace. */
  file: string
  /** Number of lessons stored in that journal file after this write. */
  entriesInFile: number
  /** Total characters in that journal file after this write. */
  chars: number
}

/** One journaled lesson read back by `soym_recall`. */
export interface Lesson {
  /** Day the lesson was journaled, ISO date. */
  date: string
  /** Category keyword, e.g. `rag`, `backtest`, `process`. */
  category: string
  /** Short lesson title. */
  title: string
  /** Lesson body. */
  body: string
  /** Journal file the lesson came from, relative to the workspace. */
  source: string
}

/** What `soym_recall` returns to the model. */
export interface RecallOutput {
  /** Whether the journal was readable. */
  ok: boolean
  /** Lessons returned, newest day first. */
  lessons: Lesson[]
  /** Combined lesson text (bounded by maxRecallChars). */
  text: string
  /** Total lessons stored in the journal across the recall window. */
  total: number
  /** Why the journal was empty or unreadable, when applicable. */
  reason?: string
}

const DESCRIPTION_LEARN =
  'Persist one verified lesson from this session into the SOYM experience journal '
  + '(`.dsh/experience/`, git-tracked). Call it at the END of a session (or after '
  + 'a non-trivial finding): something the system or a future session must not '
  + 're-learn the hard way — a verified conclusion, a trap avoided, a decision '
  + 'and why, a parameter that worked. Keep the body specific and actionable; '
  + 'prefer "the fixed fusion weight is 0.67, regime time-vary was falsified" '
  + 'over "tuned the model". Lessons are injected into future sessions by '
  + '`soym_recall`.'

const DESCRIPTION_RECALL =
  'Read the most recent lessons from the SOYM experience journal (`.dsh/experience/`, '
  + 'git-tracked) so this session starts on previous sessions\' shoulders. Call it '
  + 'at the START of a session on the SOYM wiki, before answering investment or '
  + 'framework questions: the journal holds verified conclusions, traps, and '
  + 'process lessons a fresh session would otherwise re-learn the hard way. '
  + 'Pass `category` to filter to one area (rag / backtest / process / data / ...).'

/** Local date as YYYY-MM-DD (timezone-independent — journal files key by day). */
function todayIso(): string {
  return isoOf(new Date())
}

/** Date → local YYYY-MM-DD. */
function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Escape a title/category for a markdown heading line. */
function headingSafe(text: string): string {
  return text.replace(/[#\n\r]/g, ' ').trim()
}

/**
 * Journal directory resolved against the workspace.
 * @param config - resolved deployment config.
 * @returns the absolute journal directory path.
 */
export function journalDirOf(config: ResolvedConfig): string {
  return resolve(config.workspace, config.journalDir)
}

/**
 * Append one lesson to today's journal file (`YYYY-MM-DD.md`), creating the
 * directory and file as needed.
 * @param config - resolved deployment config.
 * @param category - lesson category keyword.
 * @param title - short lesson title.
 * @param body - lesson body.
 * @returns the learn outcome.
 */
export async function appendLesson(config: ResolvedConfig, category: string, title: string, body: string): Promise<LearnOutput> {
  const dir = journalDirOf(config)
  const date = todayIso()
  const file = join(dir, `${date}.md`)
  await mkdir(dir, { recursive: true })
  const block = [
    '',
    `## [${headingSafe(category)}] ${headingSafe(title)}`,
    '',
    body.trim(),
  ].join('\n')
  const previous = await readFile(file, 'utf8').catch(() => '')
  const next = previous.trimEnd() + block + '\n'
  await writeFile(file, next, 'utf8')
  // next 必含刚追加的块，match 恒非 null；?? 0 仅类型收窄
  /* v8 ignore next 1 -- next 恒含刚追加的块，match 非 null，?? 0 的 fallback 不可达 */
  const entries = next.match(/^## \[/gm)?.length ?? 0
  return {
    ok: true,
    file: relative(config.workspace, file).split(sep).join('/'),
    entriesInFile: entries,
    chars: next.length,
  }
}

/**
 * Read lessons from the most recent journal files.
 * @param config - resolved deployment config.
 * @param category - optional category filter; when given, only lessons whose
 *   heading carries that category are returned.
 * @returns the recall outcome.
 */
export async function readLessons(config: ResolvedConfig, category?: string): Promise<RecallOutput> {
  const dir = journalDirOf(config)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return { ok: true, lessons: [], text: '', total: 0, reason: 'journal does not exist yet — nothing to recall' }
  }
  const daily = files
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
  // 按日期窗口过滤（recallDays 个自然日，而非最近 N 个文件）
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (config.recallDays - 1))
  const cutoffIso = isoOf(cutoff)
  const windowed = daily.filter(f => f.slice(0, 10) >= cutoffIso)

  const lessons: Lesson[] = []
  for (const file of windowed) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => '')
    const date = file.slice(0, 10)
    const blocks = text.split(/(?=^## \[)/m)
    for (const block of blocks) {
      // 正则两捕获组在 match 成功时必存在；逐位守卫以满足 lint 的非空断言禁令
      const m = block.match(/^## \[([^\]]+)\]\s*(.+)$/m)
      const blockCategory = m?.[1]
      const title = m?.[2]
      if (m === null || blockCategory === undefined || title === undefined) continue
      if (category !== undefined && blockCategory !== category) continue
      lessons.push({
        date,
        category: blockCategory,
        title,
        body: block.slice(m[0].length).trim(),
        source: relative(config.workspace, join(dir, file)).split(sep).join('/'),
      })
    }
  }
  lessons.sort((a, b) => b.date.localeCompare(a.date))

  const text = lessons
    .map(l => `[${l.date}] (${l.category}) ${l.title}\n${l.body}`)
    .join('\n\n')
    .slice(0, config.maxRecallChars)
  return { ok: true, lessons, text, total: lessons.length }
}

/**
 * Register `soym_learn` and `soym_recall` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's journal policy.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig

  ctx.tools.register(defineTool({
    name: 'soym_learn',
    description: DESCRIPTION_LEARN,
    parameters: {
      category: {
        type: 'string',
        required: true,
        description: 'Category keyword, e.g. rag / backtest / process / data / framework.',
      },
      title: {
        type: 'string',
        required: true,
        description: 'Short imperative or noun-phrase lesson title.',
      },
      body: {
        type: 'string',
        required: true,
        description: 'Specific, actionable lesson body with numbers and the reasoning.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file: { type: 'string', required: true },
          entriesInFile: { type: 'number', required: true },
          chars: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Lesson persisted to ${value.file} (${value.entriesInFile} entries, ${value.chars} chars).`,
      }],
    },
    async execute(args) {
      const category = args.category.trim()
      const title = args.title.trim()
      const body = args.body.trim()
      if (category.length === 0) throw new Error('soym_learn: `category` must be non-empty')
      if (title.length === 0) throw new Error('soym_learn: `title` must be non-empty')
      if (body.length === 0) throw new Error('soym_learn: `body` must be non-empty')
      return appendLesson(resolved, category, title, body)
    },
    presentCall: args => ({ card: 'generic', title: 'Persist SOYM lesson', kind: 'other', rawInput: args.title }),
  }))

  ctx.tools.register(defineTool({
    name: 'soym_recall',
    description: DESCRIPTION_RECALL,
    parameters: {
      category: {
        type: 'string',
        description: 'Optional category filter; when given, only lessons in that category are returned.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          lessons: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: 'string', required: true },
                category: { type: 'string', required: true },
                title: { type: 'string', required: true },
                body: { type: 'string', required: true },
                source: { type: 'string', required: true },
              },
            },
            required: true,
          },
          text: { type: 'string', required: true },
          total: { type: 'number', required: true },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.total === 0) {
          // readLessons 的空日志路径恒返回 reason；右侧 fallback 仅类型收窄
          /* v8 ignore next -- total===0 时 reason 恒有值（readLessons 空日志返回 reason），fallback 不可达 */
          return [{ type: 'text', text: value.reason ?? 'No lessons in the recall window.' }]
        }
        return [{ type: 'text', text: `${value.total} lessons:\n\n${value.text}` }]
      },
    },
    async execute(args) {
      const category = args.category !== undefined ? args.category.trim() : undefined
      if (category !== undefined && category.length === 0) throw new Error('soym_recall: `category` must be non-empty when given')
      return readLessons(resolved, category)
    },
    presentCall: args => ({ card: 'generic', title: 'Recall SOYM lessons', kind: 'other', rawInput: args.category ?? 'all' }),
  }))
}
