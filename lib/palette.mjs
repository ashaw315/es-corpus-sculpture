// Shared visual palette — single source of truth for style_mode colors,
// dim/non-result variants, legend-strip surface, and per-style typographic
// treatment. Imported by SculptureCanvas, WordView, CharacterView, the page
// shell, and the legend strip.
//
// Step I (v3 Kuo redesign): bumped saturation across all style_modes for
// the vivid Kuo treatment. Geometry stays untouched at this step.
//
// Step II addition: palette rotation. Each page load picks one of four
// curated palettes (PALETTE_SETS). The choice itself lives in React
// component state on the page (see app/search/page.jsx) — module-scope
// random pick was tried first but was incompatible with SSR (the server
// renders before the random Math.random() is supposed to fire on the
// client, and the inline-style mismatch on hydration didn't end up
// rerendering correctly). Instead the page uses useState +
// useEffect(setPalette(random), []) and prop-drills the chosen palette
// down to LegendStrip / SculptureCanvas / WordView. fadedColorFor()
// below is parameterized by palette so it lives in a pure module.

export const PALETTE_SETS = [
  {
    name: 'primary',
    colors: {
      'LIMINAL':           'hsl(220, 85%, 65%)',
      'SENSORY/TEXTURAL':  'hsl(145, 80%, 50%)',
      'ABSTRACT':          'hsl(35, 95%, 58%)',
      'REPLETE':           'hsl(180, 75%, 50%)',
      'REPRESENTATIONAL':  'hsl(290, 70%, 65%)',
      'GLITCH/SYSTEM':     'hsl(0, 85%, 58%)',
    },
  },
  {
    name: 'warm',
    colors: {
      'LIMINAL':           'hsl(15, 90%, 60%)',
      'SENSORY/TEXTURAL':  'hsl(45, 95%, 55%)',
      'ABSTRACT':          'hsl(330, 80%, 62%)',
      'REPLETE':           'hsl(275, 70%, 65%)',
      'REPRESENTATIONAL':  'hsl(200, 85%, 58%)',
      'GLITCH/SYSTEM':     'hsl(160, 75%, 45%)',
    },
  },
  {
    name: 'cool',
    colors: {
      'LIMINAL':           'hsl(195, 90%, 55%)',
      'SENSORY/TEXTURAL':  'hsl(240, 75%, 65%)',
      'ABSTRACT':          'hsl(170, 80%, 48%)',
      'REPLETE':           'hsl(310, 75%, 62%)',
      'REPRESENTATIONAL':  'hsl(55, 90%, 55%)',
      'GLITCH/SYSTEM':     'hsl(25, 90%, 58%)',
    },
  },
  {
    name: 'muted',
    colors: {
      'LIMINAL':           'hsl(220, 55%, 55%)',
      'SENSORY/TEXTURAL':  'hsl(145, 55%, 42%)',
      'ABSTRACT':          'hsl(35, 70%, 52%)',
      'REPLETE':           'hsl(0, 60%, 50%)',
      'REPRESENTATIONAL':  'hsl(270, 50%, 55%)',
      'GLITCH/SYSTEM':     'hsl(190, 60%, 45%)',
    },
  },
]

export const DEFAULT_COLOR = 'hsl(0, 0%, 70%)'
export const DEFAULT_FADED = 'hsl(0, 0%, 22%)'

// Derive a harmonious dark variant from any palette HSL color. Saturation
// halved, lightness brought down to ~40% of base — keeps the hue family
// recognizable while pushing contrast toward black. Replaces the old
// hand-tuned STYLE_COLOR_FADED table so all four palettes get matching
// dim states for free.
export function fadedColorFor(palette, styleMode) {
  const base = palette?.colors?.[styleMode]
  if (!base) return DEFAULT_FADED
  const m = base.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/)
  if (!m) return DEFAULT_FADED
  const h = Number(m[1])
  const s = Math.round(Number(m[2]) * 0.5)
  const l = Math.round(Number(m[3]) * 0.4)
  return `hsl(${h}, ${s}%, ${l}%)`
}

// Per-style typographic treatment — driven by the same key as the color
// palette. Used for ring labels (Scale 2), center sentence overlay, and
// any future text rendering that should follow style_mode.
export const STYLE_FONT = {
  'LIMINAL':           { family: 'Georgia, serif',                       style: 'italic' },
  'SENSORY/TEXTURAL':  { family: '"Courier New", monospace',             style: 'normal' },
  'ABSTRACT':          { family: 'Impact, "Arial Narrow", sans-serif',   style: 'normal' },
  'REPLETE':           { family: 'system-ui, sans-serif',                style: 'normal' },
  'REPRESENTATIONAL':  { family: 'system-ui, sans-serif',                style: 'normal' },
  'GLITCH/SYSTEM':     { family: '"Courier New", monospace',             style: 'normal' },
}
export const DEFAULT_FONT = { family: 'system-ui, sans-serif', style: 'normal' }

// Stable display order — used by the legend strip so the swatch row reads
// the same across views and across page reloads.
export const STYLE_ORDER = [
  'LIMINAL',
  'SENSORY/TEXTURAL',
  'ABSTRACT',
  'REPLETE',
  'REPRESENTATIONAL',
  'GLITCH/SYSTEM',
]

// Legend-strip surface tones — Kuo's linen against our black canvas.
export const LEGEND_BG = '#f0ece4'
export const LEGEND_TEXT = '#1a1a1a'
export const LEGEND_HEIGHT = 48
