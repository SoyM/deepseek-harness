import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

import * as tool from '../src/index.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A parent Agent backed by a real Session — the tools registry routes calls through it. */
function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

async function callTool(ctx: Context, name: string, args: unknown): Promise<Awaited<ReturnType<typeof ctx.tools.execute>>> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${name}`),
    name,
    arguments: args,
    agent: agentWithSession(),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

async function setup(config: tool.Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, config)
  return ctx
}

describe('dsh-soym-evolve', () => {
  it('registers soym_learn and soym_recall with pinned schemas', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    const names = ctx.tools.schemas().map(s => s.name).sort()
    expect(names).toEqual(['soym_learn', 'soym_recall'])
    const learn = ctx.tools.schemas().find(s => s.name === 'soym_learn')!
    expect(learn.description).toContain('experience journal')
    expect(Object.keys((learn.parameters as { properties: Record<string, unknown> }).properties).sort())
      .toEqual(['body', 'category', 'title'])
    // required 保持定义顺序（category/title/body），不是字母序
    expect(learn.parameters.required).toEqual(['category', 'title', 'body'])
    const recall = ctx.tools.schemas().find(s => s.name === 'soym_recall')!
    expect(Object.keys((recall.parameters as { properties: Record<string, unknown> }).properties)).toEqual(['category'])
  })

  it('soym_learn appends a lesson to today\'s journal file and reports stats', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    const result = await callTool(ctx, 'soym_learn', {
      category: 'backtest',
      title: 'fixed fusion weight 0.67',
      body: 'Regime time-vary fusion was falsified (r=-0.043); keep the fixed calibrated weight.',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_learn success')
    const value = result.value as unknown as tool.LearnOutput
    expect(value.ok).toBe(true)
    expect(value.file).toMatch(/^\.dsh\/experience\/\d{4}-\d{2}-\d{2}\.md$/)
    expect(value.entriesInFile).toBe(1)
    expect(value.chars).toBeGreaterThan(0)

    const written = await readFile(join(root, value.file), 'utf8')
    expect(written).toContain('## [backtest] fixed fusion weight 0.67')
    expect(written).toContain('r=-0.043')
  })

  it('soym_learn appends a second lesson to the same day file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    await callTool(ctx, 'soym_learn', { category: 'backtest', title: 'one', body: 'first' })
    const second = await callTool(ctx, 'soym_learn', { category: 'process', title: 'two', body: 'second' })
    if (second.isError) throw new Error('expected success')
    const value = second.value as unknown as tool.LearnOutput
    expect(value.entriesInFile).toBe(2)
    const written = await readFile(join(root, value.file), 'utf8')
    expect((written.match(/^## \[/gm) ?? []).length).toBe(2)
  })

  it('soym_learn rejects empty category/title/body', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    for (const args of [
      { category: '  ', title: 't', body: 'b' },
      { category: 'c', title: '  ', body: 'b' },
      { category: 'c', title: 't', body: '  ' },
    ]) {
      const result = await callTool(ctx, 'soym_learn', args)
      expect(result.isError).toBe(true)
    }
  })

  it('soym_recall returns an empty report when the journal does not exist', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    const result = await callTool(ctx, 'soym_recall', {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as unknown as tool.RecallOutput
    expect(value.ok).toBe(true)
    expect(value.total).toBe(0)
    expect(value.reason).toContain('journal does not exist')
    expect(text(result)).toContain('journal does not exist')
  })

  it('soym_recall reads back lessons newest first with bounded text', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    // Two day files: an older one written directly, a newer one via the tool.
    const dir = join(root, '.dsh', 'experience')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '2026-08-10.md'), [
      '## [rag] old lesson',
      '',
      'old body',
      '',
    ].join('\n'), 'utf8')
    const ctx = await setup({ workspace: root, recallDays: 7, maxRecallChars: 500 })
    await callTool(ctx, 'soym_learn', { category: 'backtest', title: 'new lesson', body: 'new body with numbers 42' })
    const result = await callTool(ctx, 'soym_recall', {})
    if (result.isError) throw new Error('expected success')
    const value = result.value as unknown as tool.RecallOutput
    expect(value.total).toBe(2)
    expect(value.lessons[0]?.title).toBe('new lesson')
    expect(value.lessons[1]?.title).toBe('old lesson')
    expect(value.text).toContain('(backtest) new lesson')
    expect(value.text).toContain('old body')
  })

  it('soym_recall filters by category', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    await callTool(ctx, 'soym_learn', { category: 'rag', title: 'r1', body: 'body r' })
    await callTool(ctx, 'soym_learn', { category: 'process', title: 'p1', body: 'body p' })
    const result = await callTool(ctx, 'soym_recall', { category: 'rag' })
    if (result.isError) throw new Error('expected success')
    const value = result.value as unknown as tool.RecallOutput
    expect(value.total).toBe(1)
    expect(value.lessons[0]?.title).toBe('r1')
  })

  it('soym_recall rejects an empty category argument', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    const result = await callTool(ctx, 'soym_recall', { category: '  ' })
    expect(result.isError).toBe(true)
  })

  it('recallDays window limits how far back lessons are read', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const dir = join(root, '.dsh', 'experience')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '2026-08-10.md'), '## [rag] old\n\nbody\n', 'utf8')
    const ctx = await setup({ workspace: root, recallDays: 1 })
    const result = await callTool(ctx, 'soym_recall', {})
    if (result.isError) throw new Error('expected success')
    expect((result.value as unknown as tool.RecallOutput).total).toBe(0)
  })

  it('maxRecallChars caps the combined recall text', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    // schema 下限 500：用 500 上限 + 超长 body 验证截断
    const ctx = await setup({ workspace: root, maxRecallChars: 500 })
    await callTool(ctx, 'soym_learn', { category: 'rag', title: 'long', body: 'x'.repeat(2000) })
    const result = await callTool(ctx, 'soym_recall', {})
    if (result.isError) throw new Error('expected success')
    expect((result.value as unknown as tool.RecallOutput).text.length).toBeLessThanOrEqual(500)
  })

  it('soym_recall tolerates an unreadable daily file (readFile catch)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const dir = join(root, '.dsh', 'experience')
    await mkdir(dir, { recursive: true })
    // 窗口内条目是目录：readFile 抛错 → catch 返回空串，不崩
    await mkdir(join(dir, '2026-08-10.md'))
    const ctx = await setup({ workspace: root, recallDays: 7 })
    const result = await callTool(ctx, 'soym_recall', {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as unknown as tool.RecallOutput).total).toBe(0)
  })

  it('soym_recall sorts multi-day lessons newest first (all comparator branches)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const dir = join(root, '.dsh', 'experience')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '2026-08-11.md'), '## [rag] middle\n\nbody m\n', 'utf8')
    await writeFile(join(dir, '2026-08-10.md'), '## [rag] oldest\n\nbody o\n', 'utf8')
    await writeFile(join(dir, '2026-08-12.md'), '## [rag] newest\n\nbody n\n', 'utf8')
    const ctx = await setup({ workspace: root, recallDays: 7 })
    const result = await callTool(ctx, 'soym_recall', {})
    if (result.isError) throw new Error('expected success')
    const value = result.value as unknown as tool.RecallOutput
    expect(value.lessons.map(l => l.date)).toEqual(['2026-08-12', '2026-08-11', '2026-08-10'])
  })

  it('presents learn and recall calls with stable views', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-'))
    const ctx = await setup({ workspace: root })
    const learn = ctx.tools.get('soym_learn')!
    expect(learn.presentCall?.({ category: 'rag', title: 't', body: 'b' })).toEqual({
      card: 'generic', title: 'Persist SOYM lesson', kind: 'other', rawInput: 't',
    })
    const recall = ctx.tools.get('soym_recall')!
    expect(recall.presentCall?.({ category: 'rag' })).toEqual({
      card: 'generic', title: 'Recall SOYM lessons', kind: 'other', rawInput: 'rag',
    })
    expect(recall.presentCall?.({})).toEqual({
      card: 'generic', title: 'Recall SOYM lessons', kind: 'other', rawInput: 'all',
    })
  })

  it('unregisters both tools when the contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, { workspace: 'C:/soym' })
    expect(ctx.tools.schemas().some(s => s.name === 'soym_learn')).toBe(true)
    expect(ctx.tools.schemas().some(s => s.name === 'soym_recall')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'soym_learn')).toBe(false)
    expect(ctx.tools.schemas().some(s => s.name === 'soym_recall')).toBe(false)
  })
})
