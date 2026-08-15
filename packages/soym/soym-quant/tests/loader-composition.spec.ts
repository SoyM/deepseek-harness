// Proves `soym_commit` is real: the cordis.yml boots through the Loader with a
// REAL temporary git repository, the tool stages and commits through the actual
// git binary, and the repository state is verified with `git log`/`git status`.
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SoymQuant from '@deepseek-ai/dsh-soym-quant'

let root: string | undefined
let repo: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  repo = undefined
})

/**
 * Boot a cordis.yml carrying the given config block for the soym-quant row.
 * The `@WORKSPACE@` token is replaced with the temp repository path so the tool
 * runs git against the test repo, never the process working directory.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-soym-loader-'))
  repo = join(root, 'repo')
  await mkdir(repo)
  const configPath = join(root, 'cordis.yml')
  const workspace = repo.replaceAll('\\', '/')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-soym-quant'",
    ...configLines.length > 0 ? ['  config:', ...configLines.map(line => line.replaceAll('@WORKSPACE@', workspace))] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-soym-quant', SoymQuant],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

/** A fresh real git repository with identity configured and one working-tree file. */
async function initRepo(dir: string): Promise<void> {
  execFileSync('git', ['init', '--quiet'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'SOYM Test'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@soym.local'], { cwd: dir })
  await writeFile(join(dir, 'strategy.py'), 'print("alpha")\n')
}

let callCounter = 0
function callCommit(ctx: Context, args: unknown): ReturnType<typeof ctx.tools.execute> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`loader-call-${++callCounter}`),
    name: 'soym_commit',
    arguments: args,
  })
}

describe('soym-quant real Loader composition over a real git repository', () => {
  it('stages and commits the working tree through the actual git binary', async () => {
    const ctx = await boot(['    workspace: "@WORKSPACE@"'])
    const repoDir = repo!
    await initRepo(repoDir)
    const result = await callCommit(ctx, { message: 'feat: bootstrap strategy' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected soym_commit success')
    const value = result.value as { ok: boolean; committed: boolean; hash?: string; summary: string }
    expect(value).toMatchObject({ ok: true, committed: true, summary: 'feat: bootstrap strategy' })
    expect(value.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoDir }).toString().trim()).toBe('feat: bootstrap strategy')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repoDir }).toString().trim()).toBe('')
  })

  it('reports a clean nothing-to-commit on a second call', async () => {
    const ctx = await boot(['    workspace: "@WORKSPACE@"'])
    const repoDir = repo!
    await initRepo(repoDir)
    await callCommit(ctx, { message: 'feat: bootstrap strategy' })
    const second = await callCommit(ctx, { message: 'chore: nothing new' })
    expect(second.isError).toBe(false)
    if (second.isError) throw new Error('expected a clean soym_commit report')
    expect(second.value).toMatchObject({ ok: true, committed: false })
  })

  it('fails loading when workspace is omitted', async () => {
    await expect(boot([])).rejects.toThrow(/workspace missing required value/)
  }, 30_000)
})
