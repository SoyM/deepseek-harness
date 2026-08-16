import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SoymEvolveInvariant from '@deepseek-ai/dsh-soym-evolve/invariant'

describe('soym-evolve invariant companion', () => {
  it('reserves the package-owned invariant name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    expect(SoymEvolveInvariant.name).toBe('soym-evolve-invariant')
    expect(SoymEvolveInvariant.inject).toEqual(['invariants'])
    await SoymEvolveInvariant.apply(ctx)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-soym-evolve', () => {})).toThrow(/already registered/)
  })
})
