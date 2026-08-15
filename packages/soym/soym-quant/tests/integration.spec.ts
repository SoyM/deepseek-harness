// Full-loop integration: a scripted mock model drives the REAL soym_commit tool
// through the agent loop against a REAL temporary git repository — the same
// execution paths a live model would take, including the tool presentation
// layer. Only the model is mocked; the tool, the loop, and git are real.
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as SoymQuant from '@deepseek-ai/dsh-soym-quant'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let repo: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  repo = undefined
})

async function harness(adapter: MockAdapter): Promise<{ ctx: Context; repoDir: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-soym-loop-'))
  repo = join(root, 'repo')
  await mkdir(repo)
  execFileSync('git', ['init', '--quiet'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'SOYM Test'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@soym.local'], { cwd: repo })
  await writeFile(join(repo, 'strategy.py'), 'print("alpha")\n')

  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SoymQuant, { workspace: repo })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, repoDir: repo }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe('soym_commit tool through the agent loop', () => {
  it('a model tool call stages and commits the real repository', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'soym_commit', { message: 'feat: loop commit' }, 'Committing now.'),
      textResponse('Committed.'),
    ])
    const { ctx, repoDir } = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-soym'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'commit the changes' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = agent.session.events
    const call = events.find(event => event.type === 'tool/call' && event.data.name === 'soym_commit')
    expect(call).toBeDefined()
    const result = events.findLast(event => event.type === 'tool/result') as Extract<SessionEvent, { type: 'tool/result' }>
    expect(result.data.message.content[0].isError).toBe(false)
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoDir }).toString().trim()).toBe('feat: loop commit')
  })
})
