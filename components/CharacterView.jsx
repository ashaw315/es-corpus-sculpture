'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// Scale 4 — Character view.
//
// Mode A: 26-bar a–z frequency histogram. Hovering a bar pushes the set
// of doc ids where that letter is "above-average frequent" up via
// onHighlightIds, so the dimmed network backdrop (rendered by the page
// underneath) brightens the matching sentences — a cross-scale link.
//
// Mode B is rendered in a separate <ParticlePrototype> component (see
// components/ParticlePrototype.jsx) for performance isolation.

const ABOVE_AVG_THRESHOLD = 1.15 // 15% above corpus average to count as "frequent"
const BAR_HUE_END = 260 // a = 0°, z = 260°

function letterRatios(text) {
  // Lowercase letter counts + total letter count for one sentence.
  const counts = Object.create(null)
  let total = 0
  for (const ch of text.toLowerCase()) {
    if (ch >= 'a' && ch <= 'z') {
      counts[ch] = (counts[ch] || 0) + 1
      total++
    }
  }
  return { counts, total }
}

// For each letter, compute the set of doc ids whose ratio exceeds the
// corpus average by at least the threshold. Single pass over all docs.
function computeAboveAverageDocs(nodes, chars) {
  const totalChars = Object.values(chars).reduce((a, b) => a + b, 0)
  const corpusAvg = Object.create(null)
  for (const [letter, count] of Object.entries(chars)) {
    corpusAvg[letter] = totalChars ? count / totalChars : 0
  }

  const result = new Map()
  for (const code of 'abcdefghijklmnopqrstuvwxyz') result.set(code, new Set())

  for (const node of nodes) {
    const text = `${node.sentence || ''} ${node.title || ''}`
    const { counts, total } = letterRatios(text)
    if (!total) continue
    for (const code of 'abcdefghijklmnopqrstuvwxyz') {
      const ratio = (counts[code] || 0) / total
      if (corpusAvg[code] > 0 && ratio > corpusAvg[code] * ABOVE_AVG_THRESHOLD) {
        result.get(code).add(node.id)
      }
    }
  }
  return result
}

export default function CharacterView({ onHighlightIds, onModeChange, mode = 'histogram' }) {
  const [data, setData] = useState(null) // { chars, aboveAverageDocs }
  const [hoverLetter, setHoverLetter] = useState(null)

  // ?hoverLetter=e debug hook for headless screenshots — fires after data
  // loads so the cross-scale highlight has a chance to compute.
  useEffect(() => {
    if (!data || typeof window === 'undefined') return
    const hl = new URLSearchParams(window.location.search).get('hoverLetter')
    if (hl && /^[a-z]$/.test(hl)) setHoverLetter(hl)
  }, [data])

  // Load chars + nodes once, precompute above-average map.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/data/chars.json').then(r => r.json()),
      fetch('/data/nodes.json').then(r => r.json()),
    ])
      .then(([chars, nodes]) => {
        if (cancelled) return
        const aboveAverageDocs = computeAboveAverageDocs(nodes, chars)
        setData({ chars, nodes, aboveAverageDocs })
      })
      .catch(err => console.error('character view data load failed:', err))
    return () => { cancelled = true }
  }, [])

  // Push the highlight up to the page on hover changes.
  useEffect(() => {
    if (!data || !onHighlightIds) return
    const ids = hoverLetter ? data.aboveAverageDocs.get(hoverLetter) : null
    onHighlightIds(ids)
  }, [hoverLetter, data, onHighlightIds])

  // Make sure we clear the highlight when this component unmounts.
  useEffect(() => {
    return () => onHighlightIds?.(null)
  }, [onHighlightIds])

  // Geometry computed only once we have the data.
  const layout = useMemo(() => {
    if (!data) return null
    const { chars } = data
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
    const maxCount = Math.max(...Object.values(chars))
    const minCount = Math.min(...Object.values(chars))
    return { letters, maxCount, minCount, chars }
  }, [data])

  if (!data || !layout) {
    return (
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#666', fontFamily: 'monospace', fontSize: 12,
      }}>
        loading character view…
      </div>
    )
  }

  // Histogram dimensions: full-bleed but reserve the bottom 60% so the
  // network backdrop in the upper area stays visible.
  const VIEW_W = 1440
  const VIEW_H = 900
  const HIST_TOP = VIEW_H * 0.40
  const HIST_BOTTOM = VIEW_H * 0.92
  const HIST_LEFT = VIEW_W * 0.10
  const HIST_RIGHT = VIEW_W * 0.90
  const HIST_HEIGHT = HIST_BOTTOM - HIST_TOP
  const BAR_GAP = 6
  const BAR_AREA_W = HIST_RIGHT - HIST_LEFT
  const BAR_W = (BAR_AREA_W - BAR_GAP * 25) / 26

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none', // child SVG re-enables for bars
        zIndex: 8,
      }}
    >
      <svg
        width="100%" height="100%"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', pointerEvents: 'auto' }}
      >
        {/* Mode toggle is rendered by the page so its position matches the
            other top-right chrome (texture button, word-view toggle). */}

        {/* Bars */}
        {layout.letters.map((letter, i) => {
          const count = layout.chars[letter] || 0
          const h = HIST_HEIGHT * (count / layout.maxCount)
          const x = HIST_LEFT + i * (BAR_W + BAR_GAP)
          const y = HIST_BOTTOM - h
          const hue = (i / 25) * BAR_HUE_END
          const isHovered = hoverLetter === letter
          const isOther = hoverLetter && !isHovered
          return (
            <g
              key={letter}
              onMouseEnter={() => setHoverLetter(letter)}
              onMouseLeave={() => setHoverLetter(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x} y={y}
                width={BAR_W} height={h}
                fill={`hsl(${hue}, 65%, ${isOther ? 30 : 60}%)`}
                stroke="#000" strokeWidth={1}
                opacity={isOther ? 0.4 : 1}
              />
              <text
                x={x + BAR_W / 2}
                y={HIST_BOTTOM + 18}
                textAnchor="middle"
                fill={isHovered ? '#fff' : '#888'}
                fontFamily="monospace"
                fontSize={12}
              >{letter}</text>
              {isHovered && (
                <text
                  x={x + BAR_W / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fill="#ddd"
                  fontFamily="monospace"
                  fontSize={11}
                >{count}</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Hover-letter status near top so the page knows what's lit up */}
      {hoverLetter && (
        <div style={{
          position: 'absolute',
          top: 90, left: '50%', transform: 'translateX(-50%)',
          color: '#ddd',
          fontFamily: 'monospace', fontSize: 12,
          textAlign: 'center',
        }}>
          letter <span style={{ color: '#fff', fontSize: 18 }}>{hoverLetter}</span>
          <span style={{ color: '#666' }}> · </span>
          {data.aboveAverageDocs.get(hoverLetter)?.size ?? 0} sentences above corpus average
        </div>
      )}
    </div>
  )
}
