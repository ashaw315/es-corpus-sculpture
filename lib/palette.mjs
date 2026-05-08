// Shared visual palette — single source of truth for style_mode colors,
// dim/non-result variants, legend-strip surface, and per-style typographic
// treatment. Imported by SculptureCanvas, WordView, CharacterView, the page
// shell, and the legend strip.
//
// Step I (v3 Kuo redesign): bumped saturation across all style_modes for
// the vivid Kuo treatment. Geometry stays untouched at this step.

export const STYLE_COLOR = {
  'LIMINAL':           'hsl(220, 85%, 65%)',  // vivid blue
  'SENSORY/TEXTURAL':  'hsl(145, 80%, 50%)',  // vivid green
  'ABSTRACT':          'hsl(35, 95%, 58%)',   // vivid amber/orange
  'REPLETE':           'hsl(180, 75%, 50%)',  // vivid teal
  'REPRESENTATIONAL':  'hsl(290, 70%, 65%)',  // vivid violet
  'GLITCH/SYSTEM':     'hsl(0, 85%, 58%)',    // vivid red
}

// Faded / non-result variant — opaque, dimmed-saturation, low-lightness
// member of the same hue family. Used for: hover de-emphasis (network),
// non-result rows in beeswarm, dimmed Scale 1 backdrop in character view,
// and the upcoming voronoi non-result darkening in Step II.
export const STYLE_COLOR_FADED = {
  'LIMINAL':           'hsl(220, 35%, 22%)',
  'SENSORY/TEXTURAL':  'hsl(145, 35%, 18%)',
  'ABSTRACT':          'hsl(35, 40%, 22%)',
  'REPLETE':           'hsl(180, 35%, 18%)',
  'REPRESENTATIONAL':  'hsl(290, 30%, 25%)',
  'GLITCH/SYSTEM':     'hsl(0, 35%, 22%)',
}

export const DEFAULT_COLOR = 'hsl(0, 0%, 70%)'
export const DEFAULT_FADED = 'hsl(0, 0%, 22%)'

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
