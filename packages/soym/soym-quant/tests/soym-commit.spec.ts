import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile, type ExecFileException } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

import * as tool from '../src/index.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

const execFileMock = vi.mocked(execFile)
const testToolSignal = new AbortController().signal

beforeEach(() => {
  execFileMock.mockReset()
})

/** A parent Agent backed by a real Session — the tools registry routes calls through it. */
function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

/** One scripted execFile outcome; `error: null` is a successful run. */
interface ScriptedRun {
  error: { code?: string | number; killed?: boolean; message?: string } | null
  stdout?: string
  stderr?: string
}

/** Script the next execFile outcomes; an unscripted call fails the test. */
function script(runs: ScriptedRun[]): void {
  execFileMock.mockImplementation(((
    _bin: string,
    _args: readonly string[],
    _opts: object,
    callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
  ) => {
    const next = runs.shift()
    if (next === undefined) throw new Error(`unexpected execFile call: ${_bin}`)
    if (next.error === null) {
      callback(null, next.stdout ?? '', next.stderr ?? '')
      return
    }
    const error = new Error(next.error.message ?? 'spawn failed') as ExecFileException
    if (next.error.code !== undefined) error.code = next.error.code
    if (next.error.killed === true) error.killed = true
    callback(error, next.stdout ?? '', next.stderr ?? '')
  }) as never)
}

let callCounter = 0
async function callCommit(ctx: Context, args: unknown): Promise<Awaited<ReturnType<typeof ctx.tools.execute>>> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'soym_commit',
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

describe('dsh-soym-quant', () => {
  it('registers a `soym_commit` tool with the pinned schema and description', async () => {
    const ctx = await setup({ workspace: 'C:/workspace' })
    const schema = ctx.tools.schemas().find(s => s.name === 'soym_commit')
    expect(schema).toBeDefined()
    expect(schema?.description).toContain('铁律9')
    const props = (schema!.parameters as { properties?: Record<string, unknown>; required?: string[] }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['message', 'paths'])
    expect((props.paths as { type?: string }).type).toBe('array')
    expect(schema!.parameters.required).toEqual(['message'])
  })

  it('stages the whole tree and commits with the default git binary and timeout', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: null, stdout: '[main a1b2c3d] fix: adjust PIT window\n' },
      { error: null, stdout: '0123456789abcdef0123456789abcdef01234567\n' },
    ])
    const result = await callCommit(ctx, { message: '  fix: adjust PIT window  ' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    expect(result.value).toEqual({
      ok: true,
      committed: true,
      hash: '0123456789abcdef0123456789abcdef01234567',
      summary: 'fix: adjust PIT window',
      output: '[main a1b2c3d] fix: adjust PIT window',
    })
    expect(text(result)).toBe('Committed 0123456: fix: adjust PIT window')
    const calls = execFileMock.mock.calls
    expect(calls[0]!.slice(0, 3)).toEqual(['git', ['add', '-A'], { cwd: 'C:/soym', timeout: 60000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true }])
    expect(calls[1]!.slice(0, 2)).toEqual(['git', ['commit', '-m', 'fix: adjust PIT window']])
    expect(calls[2]!.slice(0, 2)).toEqual(['git', ['rev-parse', 'HEAD']])
  })

  it('reports committed=true without a hash when rev-parse fails', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: null, stdout: '[main c0ffee1] docs: record decision\n' },
      { error: { code: 128, message: 'fatal: not a git repository' }, stderr: 'fatal: not a git repository\n' },
    ])
    const result = await callCommit(ctx, { message: 'docs: record decision' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    expect(result.value).toMatchObject({ ok: true, committed: true, summary: 'docs: record decision' })
    expect(result.value).not.toHaveProperty('hash')
    expect(text(result)).toBe('Committed (unknown hash): docs: record decision')
  })

  it('reports a clean nothing-to-commit outcome', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: { code: 1 }, stderr: 'nothing to commit, working tree clean\n' },
    ])
    const result = await callCommit(ctx, { message: 'fix: nothing here' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    expect(result.value).toMatchObject({ ok: true, committed: false })
    expect(text(result)).toBe('Working tree clean — nothing to commit.')
  })

  it('fails on a nonzero commit exit that is not nothing-to-commit', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: { code: 2 }, stderr: 'error: gpg failed to sign the data\n' },
    ])
    const result = await callCommit(ctx, { message: 'fix: signed' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a soft soym_commit failure')
    expect(result.value).toMatchObject({ ok: false, committed: false })
    expect(text(result)).toContain('git failed: error: gpg failed to sign the data')
  })

  it('fails when staging fails', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([{ error: { code: 128 }, stderr: 'fatal: not a git repository\n' }])
    const result = await callCommit(ctx, { message: 'fix: stage' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a soft soym_commit failure')
    expect(result.value).toMatchObject({ ok: false, committed: false })
  })

  it('stages explicit paths instead of the whole tree', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: null, stdout: '[main deadbeef] fix: scripts only\n' },
      { error: null, stdout: 'deadbeef0123456789abcdef0123456789abcdef\n' },
    ])
    const result = await callCommit(ctx, { message: 'fix: scripts only', paths: ['scripts/a.py', 'dashboard/b.js'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    expect(result.value).toMatchObject({ committed: true })
    expect(execFileMock.mock.calls[0]!.slice(0, 2)).toEqual(['git', ['add', '--', 'scripts/a.py', 'dashboard/b.js']])
  })

  it('fails loud when commitAll is disabled and no paths are given', async () => {
    const ctx = await setup({ workspace: 'C:/soym', commitAll: false })
    const result = await callCommit(ctx, { message: 'fix: scoped' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a soft soym_commit failure')
    expect(result.value).toEqual({
      ok: false,
      committed: false,
      output: 'soym_commit: commitAll is disabled and no paths were given',
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects an empty commit subject', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    const result = await callCommit(ctx, { message: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`message` must be a non-empty commit subject')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects an empty paths array', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    const result = await callCommit(ctx, { message: 'fix: x', paths: [] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`paths` must not be empty when given')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('reports a timed-out command with the configured timeout', async () => {
    const ctx = await setup({ workspace: 'C:/soym', timeoutMs: 1234 })
    script([{ error: { killed: true }, stderr: '' }])
    const result = await callCommit(ctx, { message: 'fix: slow' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a soft soym_commit failure')
    expect(result.value).toMatchObject({ ok: false, committed: false })
    expect((result.value as { output: string }).output).toContain('timed out after 1234ms')
  })

  it('reports a spawn failure (missing git binary)', async () => {
    const ctx = await setup({ workspace: 'C:/soym', gitBin: 'no-such-git' })
    script([{ error: { code: 'ENOENT', message: 'spawn no-such-git ENOENT' } }])
    const result = await callCommit(ctx, { message: 'fix: spawn' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a soft soym_commit failure')
    expect(result.value).toMatchObject({ ok: false, committed: false })
    expect((result.value as { output: string }).output).toContain('spawn no-such-git ENOENT')
  })

  it('truncates output beyond the model-facing cap', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    script([
      { error: null },
      { error: null, stdout: 'x'.repeat(5000) },
      { error: null, stdout: 'abc\n' },
    ])
    const result = await callCommit(ctx, { message: 'fix: verbose' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    const output = (result.value as { output: string }).output
    expect(output).toContain('… (output truncated)')
    expect(output.length).toBeLessThan(5000)
  })

  it('rejects a missing workspace in the Config schema', () => {
    // The schema is typed against Config; the empty object is a runtime-shape probe.
    expect(() => tool.Config({} as tool.Config)).toThrow(/workspace missing required value/)
    // The Loader-path rejection is covered end to end in loader-composition.spec.ts.
  })

  it('presents the call with a stable title and the message as raw input', async () => {
    const ctx = await setup({ workspace: 'C:/soym' })
    const def = ctx.tools.get('soym_commit')!
    expect(def.presentCall?.({ message: 'fix: window' })).toEqual({
      card: 'generic',
      title: 'Commit SOYM changes',
      kind: 'other',
      rawInput: 'fix: window',
    })
  })

  it('unregisters the tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, { workspace: 'C:/soym' })
    expect(ctx.tools.schemas().some(s => s.name === 'soym_commit')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'soym_commit')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // A default export would make Loader unwrap only apply and drop `inject`.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('soym-quant')
    expect(tool.inject).toEqual(['tools'])
  })
})
