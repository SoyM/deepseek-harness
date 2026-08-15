import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SoymQuantInvariant from '@deepseek-ai/dsh-soym-quant/invariant'

describe('soym-quant invariant companion', () => {
  it('reserves the package-owned invariant name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    expect(SoymQuantInvariant.name).toBe('soym-quant-invariant')
    expect(SoymQuantInvariant.inject).toEqual(['invariants'])
    await SoymQuantInvariant.apply(ctx)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-soym-quant', () => {})).toThrow(/already registered/)
  })
})
