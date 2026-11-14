// Which Discovery layer is shown. Pure, so the default rule is testable.

export const LAYER_IDS = [
  'verdict',
  'trend',
  'rate',
  'std',
  'significance',
  'pattern',
  'coverage',
  'quality',
  'witness',
] as const
export type LayerId = (typeof LAYER_IDS)[number]

export function isLayerId(value: string | null | undefined): value is LayerId {
  return value != null && (LAYER_IDS as readonly string[]).includes(value)
}

export interface LayerContext {
  /** The user's own pick, or the layer asked for by the URL; null when neither exists. */
  choice: LayerId | null
  /** The export has quality flags and a witness product for this variable. */
  verdictByDefault: boolean
  /** Grids not loaded yet: availability is unknown, so only the index decides. */
  loaded: boolean
  hasQuality: boolean
  hasWitness: boolean
}

/**
 * Layer that is actually drawn. Falls back to "trend" when a chosen layer has no data.
 * Verdict is the default only when both quality and witness grids exist; an explicit
 * link or user choice still opens Verdict when only one of the two layers is present.
 */
export function resolveLayer(ctx: LayerContext): LayerId {
  const wanted: LayerId = ctx.choice ?? (ctx.verdictByDefault ? 'verdict' : 'trend')
  if (!ctx.loaded) return wanted
  if (wanted === 'quality' && !ctx.hasQuality) return 'trend'
  if (wanted === 'witness' && !ctx.hasWitness) return 'trend'
  if (wanted === 'verdict') {
    if (ctx.choice == null && (!ctx.hasQuality || !ctx.hasWitness)) return 'trend'
    if (!ctx.hasQuality && !ctx.hasWitness) return 'trend'
  }
  return wanted
}
