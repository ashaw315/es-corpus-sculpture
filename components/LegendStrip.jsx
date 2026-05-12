'use client'

import {
  PALETTE_SETS,
  STYLE_ORDER,
  LEGEND_BG,
  LEGEND_TEXT,
  LEGEND_HEIGHT,
} from '../lib/palette.mjs'

// Persistent off-white band at the bottom of every view (Kuo treatment).
// Pure presentational — page tells it which scale is active and what to
// show in the center / right slots.
//
//   left   — fixed style_mode swatches + labels (single source of truth)
//   center — view-specific status string (e.g. "45 sentences", "word: light")
//   right  — view-specific contextual control (text, button, or null)
//
// HTML overlay, not part of the SVG canvas. Step I parks it on top of
// the bottom 48px; geometry rework in later steps will shrink the
// rendering area accordingly.

const swatchStyle = {
  width: 12,
  height: 12,
  display: 'inline-block',
  verticalAlign: 'middle',
  marginRight: 6,
}

export default function LegendStrip({
  scale = 'corpus',
  centerLabel = '',
  right = null,
  // Page-owned palette state. SSR + first hydration paint pass the
  // deterministic default so server/client agree; a useEffect on the
  // page swaps in a random palette right after mount, which causes
  // the swatch row to re-render with no hydration warning.
  palette = PALETTE_SETS[0],
}) {
  const STYLE_COLOR = palette.colors
  return (
    <div
      role="region"
      aria-label={`legend — ${scale}`}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: LEGEND_HEIGHT,
        background: LEGEND_BG,
        color: LEGEND_TEXT,
        fontFamily: '"Courier New", monospace',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        zIndex: 20,
        userSelect: 'none',
        boxShadow: '0 -1px 0 rgba(0,0,0,0.18)',
      }}
    >
      {/* Left: style_mode swatches + labels */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0 22px',
        rowGap: 2,
        alignItems: 'center',
        flex: '0 1 auto',
      }}>
        {STYLE_ORDER.map(name => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ ...swatchStyle, background: STYLE_COLOR[name] }} />
            <span>{name}</span>
          </span>
        ))}
      </div>

      {/* Center: view-specific status */}
      <div
        style={{
          flex: 1,
          textAlign: 'center',
          color: '#3a3a3a',
        }}
      >
        {centerLabel}
      </div>

      {/* Right: view-specific control / scale indicator */}
      <div
        style={{
          flex: '0 1 auto',
          display: 'flex',
          alignItems: 'center',
          color: '#3a3a3a',
          minWidth: 120,
          justifyContent: 'flex-end',
        }}
      >
        {right}
      </div>
    </div>
  )
}
