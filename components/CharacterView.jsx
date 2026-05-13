'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

// Scale 4 — Sunburst character view.
//
// Two-level hierarchy via d3.partition():
//   root → { vowels, consonants } → individual letters a–z
// Inner ring: two arcs sized by group total frequency.
// Outer ring: 26 arcs sized by chars.json frequency, hue-mapped
// (a=0°, z=260°).
//
// Cross-scale highlight removed — the sunburst owns the canvas,
// no bleed back to the corpus tree behind.

const VOWELS = new Set(['a','e','i','o','u'])
const VOWEL_COLOR = '#e8a87c' // warm
const CONSONANT_COLOR = '#7cb9e8' // cool
const LETTER_HUE_END = 260 // a → 0°, z → 260°

function letterHue(letter) {
  const i = letter.charCodeAt(0) - 97
  return (i / 25) * LETTER_HUE_END
}

function letterColor(letter) {
  return `hsl(${letterHue(letter)}, 70%, 60%)`
}

export default function CharacterView() {
  const wrapperRef = useRef(null)
  const svgRef = useRef(null)
  const [chars, setChars] = useState(null)
  const [hoverLetter, setHoverLetter] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/data/chars.json')
      .then(r => r.json())
      .then(data => { if (!cancelled) setChars(data) })
      .catch(err => console.error('chars.json load failed:', err))
    return () => { cancelled = true }
  }, [])

  // Build the hierarchy + partition layout once chars are in.
  const root = useMemo(() => {
    if (!chars) return null
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
    const groups = { vowels: [], consonants: [] }
    for (const ch of letters) {
      const count = chars[ch] || 0
      const grp = VOWELS.has(ch) ? 'vowels' : 'consonants'
      groups[grp].push({ name: ch, value: count })
    }
    const data = {
      name: 'root',
      children: [
        { name: 'vowels', children: groups.vowels },
        { name: 'consonants', children: groups.consonants },
      ],
    }
    const r = d3.hierarchy(data).sum(d => d.value)
    // No sort — keep alphabetical letter order in the outer ring.
    return r
  }, [chars])

  // Render the SVG imperatively whenever root or hover changes.
  useEffect(() => {
    if (!root) return
    const svg = d3.select(svgRef.current)
    const w = wrapperRef.current?.clientWidth || window.innerWidth
    const h = wrapperRef.current?.clientHeight || window.innerHeight
    svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`)

    const cx = w / 2
    const cy = (h - 48) / 2
    const maxR = Math.min(w, h - 48) * 0.5 * 0.7 // ~70% of half-min
    const innerOuter = maxR * 0.30
    const outerOuter = maxR

    // Position the layout in [0, 2π] × [0, maxR].
    const partition = d3.partition().size([2 * Math.PI, maxR])
    partition(root)

    // Override radii so depth-1 = inner ring, depth-2 = outer ring.
    root.each(node => {
      if (node.depth === 1) { node.y0 = 0; node.y1 = innerOuter }
      else if (node.depth === 2) { node.y0 = innerOuter; node.y1 = outerOuter }
    })

    const arcGen = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => d.y0)
      .outerRadius(d => d.y1)
      .padAngle(0.005)
      .padRadius(maxR / 2)

    // Clear previous render — small dataset, easier than diffing.
    svg.selectAll('*').remove()
    const g = svg.append('g').attr('transform', `translate(${cx}, ${cy})`)

    // Inner ring (vowels / consonants).
    const inner = root.descendants().filter(d => d.depth === 1)
    g.append('g').attr('class', 'inner-arcs')
      .selectAll('path')
      .data(inner)
      .join('path')
      .attr('d', arcGen)
      .attr('fill', d => d.data.name === 'vowels' ? VOWEL_COLOR : CONSONANT_COLOR)
      .attr('stroke', '#f5f2ed')
      .attr('stroke-width', 2)

    // (Inner-ring labels removed — color carries vowels/consonants.)

    // Outer ring (a–z).
    const outer = root.descendants().filter(d => d.depth === 2)
    const outerSel = g.append('g').attr('class', 'outer-arcs')
      .selectAll('path')
      .data(outer)
      .join('path')
      .attr('d', arcGen)
      .attr('fill', d => letterColor(d.data.name))
      .attr('stroke', '#f5f2ed')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')

    outerSel
      .on('mouseenter', (_event, d) => setHoverLetter(d.data.name))
      .on('mouseleave', () => setHoverLetter(null))

    // (Outer-ring letter labels removed — letter identity reads from
    // the top-of-canvas hover line.)
  }, [root])

  // Re-tint outer arcs on hover so the active letter pops, others dim.
  useEffect(() => {
    if (!root) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('g.outer-arcs path')
      .style('opacity', d => {
        if (!hoverLetter) return 1
        return d.data.name === hoverLetter ? 1 : 0.35
      })
  }, [hoverLetter, root])

  if (!chars) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#f5f2ed', zIndex: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'monospace', fontSize: 12,
      }}>loading characters…</div>
    )
  }

  const hoverCount = hoverLetter ? (chars[hoverLetter] || 0) : null

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'fixed', inset: 0,
        background: '#f5f2ed',
        zIndex: 8,
      }}
    >
      <svg ref={svgRef} style={{ display: 'block' }} />
      {hoverLetter && (
        <div style={{
          position: 'fixed',
          top: 56, left: '50%', transform: 'translateX(-50%)',
          fontFamily: 'monospace', fontSize: 13,
          color: '#1a1a1a',
          pointerEvents: 'none',
          zIndex: 9,
        }}>
          letter <span style={{ fontWeight: 600 }}>{hoverLetter}</span>
          <span style={{ color: '#888' }}> · </span>
          {hoverCount} occurrence{hoverCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
