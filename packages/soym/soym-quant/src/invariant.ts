/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-soym-quant`.
 * @module @deepseek-ai/dsh-soym-quant/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-soym-quant'

/** Cordis companion plugin name. */
export const name = 'soym-quant-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: `soym_commit` is a stateless model-facing consumer; git
 * is the authoritative state and every result is a per-call snapshot of the
 * repository at that moment. The tool owns no event stream or mutable data
 * relationship.
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
