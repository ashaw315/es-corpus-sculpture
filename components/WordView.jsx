'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { STYLE_COLOR, DEFAULT_COLOR } from '../lib/palette.mjs'

// Scale 3 — Word view. Two panels for one selected word:
//
//  Panel A — Timeline strip: every sentence containing the word, arranged
//            horizontally by date as a pill. Click pill → Scale 2 for
//            that sentence.
//
//  Panel B — Co-occurrence mini-network: the selected word at center, top
//            co-occurring words radially. Click word → pivot to its view.
//
// Loads /public/data/{nodes,word-index,words}.json once and computes
// co-occurrence on demand. Self-contained — does not share state with
// SculptureCanvas.

// Compute the top N words that co-occur with `word` in any sentence.
// Output: [{ word, count, freq }] sorted by count desc, then by global
// frequency asc (rarer wins ties — more interesting).
function topCooccurring(word, wordIndex, words, limit = 30) {
  const docs = new Set(wordIndex[word] || [])
  if (docs.size === 0) return []
  const counts = []
  for (const [other, otherDocs] of Object.entries(wordIndex)) {
    if (other === word) continue
    // Drop tokenization artifacts: 1–2 char tokens like "tf" (from title
    // suffixes such as TF-072-21) aren't real content words.
    if (other.length < 3) continue
    let n = 0
    for (const d of otherDocs) if (docs.has(d)) n++
    if (n >= 1) counts.push({ word: other, count: n, freq: words[other] || 1 })
  }
  counts.sort((a, b) => b.count - a.count || a.freq - b.freq)
  return counts.slice(0, limit)
}

export default function WordView({
  word,
  panel = 'timeline',
  onSelectSentence,
  onPivotWord,
  onSetPanel,
}) {
  const svgRef = useRef(null)
  const wrapperRef = useRef(null)
  const [data, setData] = useState(null) // { nodes, wordIndex, words }
  const [hoverPillId, setHoverPillId] = useState(null)
  const simRef = useRef(null)

  // Load static data once.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/data/nodes.json').then(r => r.json()),
      fetch('/data/word-index.json').then(r => r.json()),
      fetch('/data/words.json').then(r => r.json()),
    ])
      .then(([nodes, wordIndex, words]) => {
        if (cancelled) return
        const nodesById = new Map(nodes.map(n => [n.id, n]))
        setData({ nodes, nodesById, wordIndex, words })
      })
      .catch(err => console.error('word-view data load failed:', err))
    return () => { cancelled = true }
  }, [])

  // Sentences containing the word — derived from wordIndex.
  const containingDocs = useMemo(() => {
    if (!data || !word) return []
    const ids = data.wordIndex[word] || []
    return ids
      .map(id => data.nodesById.get(id))
      .filter(Boolean)
  }, [data, word])

  // Co-occurring words for Panel B.
  const cooccurring = useMemo(() => {
    if (!data || !word) return []
    return topCooccurring(word, data.wordIndex, data.words, 30)
  }, [data, word])

  // Render whichever panel is active. Tear down previous d3 attachments
  // (force sim, listeners) before re-rendering.
  useEffect(() => {
    if (!data || !word) return
    if (simRef.current) {
      simRef.current.stop()
      simRef.current = null
    }
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = wrapperRef.current?.clientWidth || window.innerWidth
    const H = wrapperRef.current?.clientHeight || window.innerHeight
    svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)

    if (panel === 'timeline') {
      renderTimeline(svg, W, H)
    } else {
      renderCooccurrence(svg, W, H)
    }
  }, [data, word, panel, containingDocs, cooccurring])

  function renderTimeline(svg, W, H) {
    if (containingDocs.length === 0) {
      svg.append('text')
        .attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#666')
        .attr('font-family', 'monospace')
        .text(`no sentences contain "${word}"`)
      return
    }

    // x scale across the corpus's date range so different word views share
    // the same temporal frame.
    const allDates = data.nodes.map(n => new Date(n.date))
    const minDate = new Date(Math.min(...allDates))
    const maxDate = new Date(Math.max(...allDates))
    const xScale = d3.scaleTime()
      .domain([minDate, maxDate])
      .range([W * 0.06, W * 0.94])

    // Pill geometry: width fixed, height proportional to sentence length.
    const pills = containingDocs.map(n => ({
      id: n.id,
      sentence: n.sentence,
      style_mode: n.style_mode,
      date: new Date(n.date),
      width: 14,
      height: Math.max(20, Math.min(80, n.length / 8)),
      x: xScale(new Date(n.date)),
      y: H * 0.45,
    }))

    // Force sim collides pills that share a date so they stack vertically.
    const sim = d3.forceSimulation(pills)
      .force('x', d3.forceX(d => xScale(d.date)).strength(1))
      .force('y', d3.forceY(H * 0.45).strength(0.18))
      .force('collide', d3.forceCollide(d => d.width / 2 + 4).iterations(3))
      .alphaDecay(0.05)
    simRef.current = sim

    // Pre-settle so first paint shows stacked positions.
    for (let i = 0; i < 200; i++) sim.tick()

    // Date axis at bottom.
    const axisLayer = svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${H - 40})`)
    const axisGen = d3.axisBottom(xScale)
      .ticks(d3.timeWeek.every(1))
      .tickFormat(d3.timeFormat('%b %d'))
    axisLayer.call(axisGen)
    axisLayer.selectAll('path').attr('stroke', '#444')
    axisLayer.selectAll('line').attr('stroke', '#444')
    axisLayer.selectAll('text')
      .attr('fill', '#888')
      .style('font-family', 'monospace')
      .style('font-size', '10px')

    // Pills.
    const pillSel = svg.append('g').selectAll('rect')
      .data(pills, d => d.id)
      .join('rect')
      .attr('x', d => d.x - d.width / 2)
      .attr('y', d => d.y - d.height / 2)
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('rx', 3)
      .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
      .attr('stroke', '#000')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHoverPillId(d.id))
      .on('mouseleave', () => setHoverPillId(null))
      .on('click', (_, d) => {
        if (typeof onSelectSentence === 'function') onSelectSentence(d.id)
      })

    // Re-position pills on every tick during settle (already pre-settled,
    // but keep the sim live so resize can re-balance).
    sim.on('tick', () => {
      pillSel
        .attr('x', d => d.x - d.width / 2)
        .attr('y', d => d.y - d.height / 2)
    })
  }

  function renderCooccurrence(svg, W, H) {
    if (cooccurring.length === 0) {
      svg.append('text')
        .attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#666')
        .attr('font-family', 'monospace')
        .text(`no co-occurrences for "${word}"`)
      return
    }

    // Scales for the co-occurrence nodes.
    const maxCount = cooccurring[0].count
    const fontScale = d3.scaleLinear()
      .domain([1, Math.max(2, maxCount)])
      .range([12, 24])
    // Word frequency rarity → vividness (saturation/lightness).
    const freqs = cooccurring.map(d => d.freq).concat([data.words[word] || 1])
    const minFreq = Math.min(...freqs)
    const maxFreq = Math.max(...freqs)
    const satScale = d3.scaleLog().clamp(true)
      .domain([minFreq, maxFreq]).range([85, 35])
    const lightScale = d3.scaleLog().clamp(true)
      .domain([minFreq, maxFreq]).range([72, 50])

    function colorForWord(w, freq) {
      const h = (Math.abs(hashString(w)) % 360)
      return `hsl(${h}, ${satScale(freq)}%, ${lightScale(freq)}%)`
    }

    const cx = W / 2
    const cy = H / 2

    // Build node objects (center + co-occurring) for the force sim.
    const centerNode = {
      id: '__center__',
      word,
      isCenter: true,
      fontSize: 32,
      x: cx, y: cy, fx: cx, fy: cy,
    }
    const peripheral = cooccurring.map((d) => ({
      id: d.word,
      word: d.word,
      count: d.count,
      freq: d.freq,
      fontSize: fontScale(d.count),
    }))
    const simNodes = [centerNode, ...peripheral]

    // Approximate text-bbox half-widths/heights for collision sizing.
    function approxRadius(n) {
      // Half-diagonal of (chars * 0.55 * fontSize) × fontSize, scaled down.
      const w = n.word.length * n.fontSize * 0.55
      return Math.hypot(w, n.fontSize) / 2.2 + 4
    }

    const sim = d3.forceSimulation(simNodes)
      .force('charge', d3.forceManyBody().strength(d => d.isCenter ? 0 : -180))
      .force('x', d3.forceX(cx).strength(d => d.isCenter ? 0 : 0.05))
      .force('y', d3.forceY(cy).strength(d => d.isCenter ? 0 : 0.05))
      .force('collide', d3.forceCollide(approxRadius).iterations(2))
      .alphaDecay(0.03)
      .velocityDecay(0.5)
    simRef.current = sim

    // Pre-settle.
    for (let i = 0; i < 300; i++) sim.tick()

    // Draw faint lines from center to each peripheral word — a subtle
    // visual anchoring without dominating the type composition.
    const lineSel = svg.append('g').selectAll('line')
      .data(peripheral)
      .join('line')
      .attr('x1', cx).attr('y1', cy)
      .attr('x2', d => d.x).attr('y2', d => d.y)
      .attr('stroke', '#333')
      .attr('stroke-width', 0.6)

    // Labels.
    const labelSel = svg.append('g').selectAll('text')
      .data(simNodes, d => d.id)
      .join('text')
      .attr('x', d => d.x).attr('y', d => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'monospace')
      .attr('font-size', d => d.fontSize)
      .attr('fill', d =>
        d.isCenter ? '#fff' : colorForWord(d.word, d.freq))
      .style('cursor', d => d.isCenter ? 'default' : 'pointer')
      .text(d => d.word)
      .on('click', (_, d) => {
        if (!d.isCenter && typeof onPivotWord === 'function') {
          onPivotWord(d.word)
        }
      })

    sim.on('tick', () => {
      labelSel.attr('x', d => d.x).attr('y', d => d.y)
      lineSel.attr('x2', d => d.x).attr('y2', d => d.y)
    })
  }

  // Hovered sentence (for Panel A tooltip).
  const hoverDoc = hoverPillId
    ? containingDocs.find(d => d.id === hoverPillId)
    : null

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'fixed', inset: 0, background: '#000', overflow: 'hidden',
      }}
    >
      <svg ref={svgRef} style={{ display: 'block' }} />

      {/* Panel toggle moved to the bottom legend strip in Step I.
          See <LegendStrip> in app/search/page.jsx. */}

      {/* Hover tooltip for Panel A */}
      {hoverDoc && (
        <div style={{
          position: 'absolute',
          top: 80, left: '50%', transform: 'translateX(-50%)',
          maxWidth: 760, padding: '10px 14px',
          background: 'rgba(20,20,20,0.92)', color: '#ddd',
          fontFamily: 'monospace', fontSize: 13, lineHeight: 1.45,
          border: `1px solid ${STYLE_COLOR[hoverDoc.style_mode] || '#444'}`,
          borderRadius: 4,
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
            {hoverDoc.id} · {hoverDoc.style_mode} · {hoverDoc.date}
          </div>
          {hoverDoc.sentence}
        </div>
      )}
    </div>
  )
}

// Tiny string hash for stable per-word hue assignment in Panel B.
function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}
