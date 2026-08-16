/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-soym-evolve`.
 * @module @deepseek-ai/dsh-soym-evolve/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-soym-evolve'

/** Cordis companion plugin name. */
export const name = 'soym-evolve-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the experience journal is plain git-tracked markdown on
 * disk — the filesystem is the authoritative state and every tool call is a
 * per-call snapshot. The package owns no event stream or mutable service
 * relationship to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
