// Proves the experience loop is real: a cordis.yml boots through the Loader with
// a REAL temporary journal directory, soym_learn writes a lesson through the
// actual filesystem, and soym_recall reads it back.
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
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as SoymEvolve from '@deepseek-ai/dsh-soym-evolve'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(extraRows: readonly string[] = []): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-soym-evolve-loader-'))
  const configPath = join(root, 'cordis.yml')
  const workspace = join(root, 'ws').replaceAll('\\', '/')
  await mkdir(join(root, 'ws'))
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-soym-evolve'",
    '  config:',
    `    workspace: '${workspace}'`,
    ...extraRows,
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
    ['@deepseek-ai/dsh-soym-evolve', SoymEvolve],
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

describe('soym-evolve loader composition', () => {
  it('boots from cordis.yml and runs the full learn→recall loop over the real filesystem', async () => {
    const ctx = await boot()
    const learn = await callTool(ctx, 'soym_learn', { category: 'process', title: 'loader lesson', body: 'learned via real cordis.yml boot' })
    expect(learn.isError).toBe(false)
    if (learn.isError) throw new Error('expected learn success')
    const file = (learn.value as { file: string }).file
    expect(file).toMatch(/^\.dsh\/experience\/\d{4}-\d{2}-\d{2}\.md$/)

    const recall = await callTool(ctx, 'soym_recall', {})
    expect(recall.isError).toBe(false)
    if (recall.isError) throw new Error('expected recall success')
    const value = recall.value as { total: number; text: string }
    expect(value.total).toBe(1)
    expect(value.text).toContain('loader lesson')
  })

  it('applies the configured journalDir override', async () => {
    const ctx = await boot([
      "    journalDir: 'custom/exp'",
    ])
    const learn = await callTool(ctx, 'soym_learn', { category: 'process', title: 'custom dir', body: 'stored under custom/exp' })
    expect(learn.isError).toBe(false)
    if (learn.isError) throw new Error('expected success')
    expect((learn.value as { file: string }).file).toMatch(/^custom\/exp\/\d{4}-\d{2}-\d{2}\.md$/)
  })
})
