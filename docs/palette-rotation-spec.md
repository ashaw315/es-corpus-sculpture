# Voronoi Variation Spec — Palette Rotation + Layout Randomization

Extends Step II. Each page load produces a distinct composition: different
voronoi layout (force sim seed varies) and different color palette (rotates
through 4 curated sets). The legend strip always reflects the current palette
so color → style_mode meaning is preserved.

---

## Part 1 — Layout Randomization

The force simulation already uses Math.random() internally. The current
renderer calls simulation.tick(300) synchronously — if there's a fixed seed
anywhere, remove it. If not, it's already random per load.

**Verify**: reload /search 3 times — if the voronoi composition is identical
each time, there's a seed to remove. If it varies, nothing to do.

If the layout IS fixed: remove any `Math.seedrandom` or `simulation.randomSource`
call. The D3 force sim uses Math.random() by default with no fixed seed.

---

## Part 2 — Palette Rotation (4 curated sets)

Four named palettes, each a complete mapping of style_mode → HSL color.
On each page load, one palette is selected (session-stable: chosen once,
stored in a module-level variable, doesn't change on re-renders).

### Palette A — "Primary" (current vivid palette)
```
LIMINAL:              hsl(220, 85%, 65%)   blue
SENSORY/TEXTURAL:     hsl(145, 80%, 50%)   green
ABSTRACT:             hsl(35, 95%, 58%)    amber/orange
REPLETE:              hsl(180, 75%, 50%)   teal
REPRESENTATIONAL:     hsl(290, 70%, 65%)   violet
GLITCH/SYSTEM:        hsl(0, 85%, 58%)     red
```

### Palette B — "Warm"
```
LIMINAL:              hsl(15, 90%, 60%)    coral/orange-red
SENSORY/TEXTURAL:     hsl(45, 95%, 55%)    yellow
ABSTRACT:             hsl(330, 80%, 62%)   pink/magenta
REPLETE:              hsl(275, 70%, 65%)   purple
REPRESENTATIONAL:     hsl(200, 85%, 58%)   sky blue
GLITCH/SYSTEM:        hsl(160, 75%, 45%)   teal-green
```

### Palette C — "Cool"
```
LIMINAL:              hsl(195, 90%, 55%)   cyan
SENSORY/TEXTURAL:     hsl(240, 75%, 65%)   periwinkle blue
ABSTRACT:             hsl(170, 80%, 48%)   mint green
REPLETE:              hsl(310, 75%, 62%)   magenta-pink
REPRESENTATIONAL:     hsl(55, 90%, 55%)    yellow-green
GLITCH/SYSTEM:        hsl(25, 90%, 58%)    burnt orange
```

### Palette D — "Muted Kuo" (inspired by his linen-ground works)
```
LIMINAL:              hsl(220, 55%, 55%)   steel blue
SENSORY/TEXTURAL:     hsl(145, 55%, 42%)   forest green
ABSTRACT:             hsl(35, 70%, 52%)    ochre
REPLETE:              hsl(0, 60%, 50%)     brick red
REPRESENTATIONAL:     hsl(270, 50%, 55%)   dusty violet
GLITCH/SYSTEM:        hsl(190, 60%, 45%)   slate teal
```

---

## Implementation

### lib/palette.mjs — add palette set

```javascript
export const PALETTE_SETS = [
  { // A — Primary
    name: 'primary',
    colors: {
      'LIMINAL':           'hsl(220, 85%, 65%)',
      'SENSORY/TEXTURAL':  'hsl(145, 80%, 50%)',
      'ABSTRACT':          'hsl(35, 95%, 58%)',
      'REPLETE':           'hsl(180, 75%, 50%)',
      'REPRESENTATIONAL':  'hsl(290, 70%, 65%)',
      'GLITCH/SYSTEM':     'hsl(0, 85%, 58%)',
    }
  },
  { // B — Warm
    name: 'warm',
    colors: {
      'LIMINAL':           'hsl(15, 90%, 60%)',
      'SENSORY/TEXTURAL':  'hsl(45, 95%, 55%)',
      'ABSTRACT':          'hsl(330, 80%, 62%)',
      'REPLETE':           'hsl(275, 70%, 65%)',
      'REPRESENTATIONAL':  'hsl(200, 85%, 58%)',
      'GLITCH/SYSTEM':     'hsl(160, 75%, 45%)',
    }
  },
  { // C — Cool
    name: 'cool',
    colors: {
      'LIMINAL':           'hsl(195, 90%, 55%)',
      'SENSORY/TEXTURAL':  'hsl(240, 75%, 65%)',
      'ABSTRACT':          'hsl(170, 80%, 48%)',
      'REPLETE':           'hsl(310, 75%, 62%)',
      'REPRESENTATIONAL':  'hsl(55, 90%, 55%)',
      'GLITCH/SYSTEM':     'hsl(25, 90%, 58%)',
    }
  },
  { // D — Muted Kuo
    name: 'muted',
    colors: {
      'LIMINAL':           'hsl(220, 55%, 55%)',
      'SENSORY/TEXTURAL':  'hsl(145, 55%, 42%)',
      'ABSTRACT':          'hsl(35, 70%, 52%)',
      'REPLETE':           'hsl(0, 60%, 50%)',
      'REPRESENTATIONAL':  'hsl(270, 50%, 55%)',
      'GLITCH/SYSTEM':     'hsl(190, 60%, 45%)',
    }
  },
]

// Session-stable palette — chosen once per page load
export const SESSION_PALETTE =
  PALETTE_SETS[Math.floor(Math.random() * PALETTE_SETS.length)]

// Convenience export — drop-in replacement for STYLE_COLOR
export const STYLE_COLOR = SESSION_PALETTE.colors

// Faded variants — computed from session palette
// Lightness reduced to ~25%, saturation halved
export function fadedColor(styleMode) {
  const base = SESSION_PALETTE.colors[styleMode] || SESSION_PALETTE.colors['LIMINAL']
  // Parse hsl(...) and darken
  const match = base.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
  if (!match) return '#222'
  const [, h, s, l] = match.map(Number)
  return `hsl(${h}, ${Math.round(s * 0.5)}%, ${Math.round(l * 0.4)}%)`
}
```

### LegendStrip.jsx — show current palette swatches

LegendStrip already imports STYLE_COLOR. Since STYLE_COLOR is now the session
palette, swatches automatically reflect whichever palette loaded. No changes
needed to LegendStrip.jsx — it just works.

### SculptureCanvas.jsx — use STYLE_COLOR (already imported)

Cell fills, circle fills, arc fills all use STYLE_COLOR[node.style_mode].
Since STYLE_COLOR now points to the session palette, all views automatically
use the current palette. No changes needed if STYLE_COLOR is already imported
and used consistently.

Replace any hardcoded STYLE_COLOR_FADED references with fadedColor(styleMode)
calls from the new utility.

---

## Palette Faded Variants

Each palette needs faded versions for hover/dim states. The `fadedColor()`
utility above computes them dynamically from the base palette color. This
means faded colors are always harmonious with the active palette — no need
to hardcode 4×6=24 faded values.

---

## What Changes

| File | Change |
|------|--------|
| `lib/palette.mjs` | Add PALETTE_SETS, SESSION_PALETTE, updated STYLE_COLOR export, fadedColor() utility |
| `components/SculptureCanvas.jsx` | Replace STYLE_COLOR_FADED object with fadedColor() calls; verify STYLE_COLOR import is used (not hardcoded HSL strings) |
| `components/LegendStrip.jsx` | No change — already uses STYLE_COLOR |
| `components/WordView.jsx` | Verify uses STYLE_COLOR import, not hardcoded strings |
| `components/CharacterView.jsx` | No change — uses letter-index hues, not style_mode colors |

---

## Verification

1. Reload /search 5 times — layout should vary each time (different voronoi composition)
2. Reload /search repeatedly until all 4 palettes have appeared (roughly 4-8 reloads)
3. In each palette, verify legend strip swatches match cell colors
4. In each palette, verify faded/dim states (Scale 4) use a harmonious dark version
5. Beeswarm circles should match the current session palette
6. Radial arc node circles should match the current session palette

---

## Do Not

- Do not randomize color-to-style_mode mapping within a session (once chosen, stays)
- Do not change CharacterView letter hues (those are a separate hue scale, not style_mode)
- Do not change the particle prototype colors (also not style_mode based)
- Do not add more than 4 palettes without visual review of each
- Do not break the 45/45 tests