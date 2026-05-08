'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

// Scales 1, 1b, and 2 — corpus network, beeswarm search, and radial arc.
// Mode priority: selectedId set → radial; else query+hits → beeswarm; else network.
// Loads precomputed /public/data/{nodes,graph}.json once and shares the
// same SVG / simulation / node selection across modes; transitions are
// driven by force swap + alpha restart + attribute tweens.

const STYLE_COLOR = {
  'LIMINAL':           'hsl(220, 70%, 60%)',
  'SENSORY/TEXTURAL':  'hsl(140, 65%, 55%)',
  'ABSTRACT':          'hsl(35, 80%, 60%)',
  'REPLETE':           'hsl(180, 60%, 55%)',
  'REPRESENTATIONAL':  'hsl(280, 60%, 65%)',
  'GLITCH/SYSTEM':     'hsl(0, 70%, 60%)',
}
// Fade target = darker, lower-saturation HSL of the same hue family.
// Stays *opaque* so edges crossing the node body are occluded — fixes the
// wedge/spoke artifact that translucent fades produced.
const STYLE_COLOR_FADED = {
  'LIMINAL':           'hsl(220, 30%, 22%)',
  'SENSORY/TEXTURAL':  'hsl(140, 30%, 20%)',
  'ABSTRACT':          'hsl(35, 35%, 22%)',
  'REPLETE':           'hsl(180, 30%, 20%)',
  'REPRESENTATIONAL':  'hsl(280, 25%, 25%)',
  'GLITCH/SYSTEM':     'hsl(0, 30%, 22%)',
}
const DEFAULT_COLOR = 'hsl(0, 0%, 70%)'
const DEFAULT_FADED = 'hsl(0, 0%, 22%)'

// Style_mode → typographic treatment for radial-mode labels.
const STYLE_FONT = {
  'LIMINAL':           { family: 'Georgia, serif',          style: 'italic' },
  'SENSORY/TEXTURAL':  { family: '"Courier New", monospace', style: 'normal' },
  'ABSTRACT':          { family: 'Impact, "Arial Narrow", sans-serif', style: 'normal' },
  'REPLETE':           { family: 'system-ui, sans-serif',    style: 'normal' },
  'REPRESENTATIONAL':  { family: 'system-ui, sans-serif',    style: 'normal' },
  'GLITCH/SYSTEM':     { family: '"Courier New", monospace', style: 'normal' },
}
const DEFAULT_FONT = { family: 'system-ui, sans-serif', style: 'normal' }

const EDGE_WIDTH_DOMAIN = [10, 70]
const EDGE_WIDTH_RANGE = [0.4, 2.4]
const EDGE_OPACITY = 0.2
const TRANSITION_MS = 800

// Radial-mode geometry. Inner ring holds top 3 MLT neighbors, outer ring
// holds the next 4. Numbers tuned for a 1440x900 viewport.
const RADIAL_INNER_R = 290
const RADIAL_OUTER_R = 440
// (Center sentence font size lives in the page overlay; only neighbor
// labels stay inside the SVG.)
const RADIAL_NEIGHBOR_FONT = 14
// Date hue gradient — deep blue (oldest) → warm amber (newest), corpus-wide.
const HUE_OLDEST = 220
const HUE_NEWEST = 35
// Radial arcs: thickness range driven by MLT score.
const ARC_WIDTH_DOMAIN = [10, 100]
const ARC_WIDTH_RANGE = [1, 6]

function dedupeEdges(graph) {
  const byPair = new Map()
  for (const [source, neighbors] of Object.entries(graph)) {
    for (const { id: target, score } of neighbors) {
      const key = source < target ? `${source}|${target}` : `${target}|${source}`
      const existing = byPair.get(key)
      if (!existing || score > existing.score) {
        const [a, b] = key.split('|')
        byPair.set(key, { source: a, target: b, score })
      }
    }
  }
  return Array.from(byPair.values())
}

function firstWords(sentence, n = 4) {
  if (!sentence) return ''
  return sentence.split(/\s+/).slice(0, n).join(' ')
}

function nodeRadius(length) {
  return 5 + Math.sqrt(length) * 0.8
}

export default function SculptureCanvas({
  query = '',
  hits = null,
  selectedId = null,
  mltHits = null,
  onSelect,
  // Step F: when `dim` is true the whole network reads as a faded
  // backdrop; `highlightIds` (a Set of doc ids) brightens those ids to
  // full color while others stay dim. Used by Scale 4 (character view)
  // for cross-scale highlighting.
  dim = false,
  highlightIds = null,
}) {
  const svgRef = useRef(null)
  const wrapperRef = useRef(null)
  const [error, setError] = useState(null)

  // Stable refs into the live scene so prop-change effects can mutate the
  // already-constructed simulation rather than tearing down on each query.
  const sceneRef = useRef(null)
  // Bumped after the scene is built so prop-sync effects re-run once
  // they have a real scene to attach to (the scene is built inside an async
  // IIFE — without this trigger the effects' first run would no-op).
  const [sceneReady, setSceneReady] = useState(0)

  // Initial scene construction — runs once.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      let nodes, graph
      try {
        const [nodesRes, graphRes] = await Promise.all([
          fetch('/data/nodes.json'),
          fetch('/data/graph.json'),
        ])
        if (!nodesRes.ok || !graphRes.ok) throw new Error('static data missing')
        nodes = await nodesRes.json()
        graph = await graphRes.json()
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(err.message)
        return
      }
      if (cancelled) return

      const links = dedupeEdges(graph)
      const simNodes = nodes.map(n => ({
        ...n,
        baseR: nodeRadius(n.length),
        r: nodeRadius(n.length),
      }))
      const nodeById = new Map(simNodes.map(n => [n.id, n]))

      // Corpus date range for the radial-mode date-hue gradient.
      const corpusTimes = simNodes.map(n => new Date(n.date).getTime())
      const corpusMinT = Math.min(...corpusTimes)
      const corpusMaxT = Math.max(...corpusTimes)
      function dateHue(date) {
        const t = new Date(date).getTime()
        if (corpusMinT === corpusMaxT) return (HUE_OLDEST + HUE_NEWEST) / 2
        const frac = (t - corpusMinT) / (corpusMaxT - corpusMinT)
        return HUE_OLDEST + frac * (HUE_NEWEST - HUE_OLDEST)
      }

      const wrapper = wrapperRef.current
      const W = wrapper?.clientWidth || window.innerWidth
      const H = wrapper?.clientHeight || window.innerHeight

      const svg = d3.select(svgRef.current)
        .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      svg.selectAll('*').remove()

      const root = svg.append('g').attr('class', 'zoom-root')

      // x-axis layer for beeswarm; hidden in network mode via opacity.
      const axisLayer = root.append('g')
        .attr('class', 'axis')
        .style('opacity', 0)

      // Radial arc layer — drawn under nodes so neighbor circles paint on top.
      // Painted between axis and links so it lives below network edges too.
      const arcLayer = root.append('g')
        .attr('class', 'arcs')
        .style('opacity', 0)

      const linkSel = root.append('g')
        .attr('class', 'links')
        .attr('stroke', '#fff')
        .attr('stroke-opacity', EDGE_OPACITY)
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', d =>
          d3.scaleLinear().domain(EDGE_WIDTH_DOMAIN).range(EDGE_WIDTH_RANGE).clamp(true)(d.score))

      const nodeSel = root.append('g')
        .attr('class', 'nodes')
        .selectAll('g.node')
        .data(simNodes, d => d.id)
        .join('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')

      nodeSel.append('circle')
        .attr('r', d => d.r)
        .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        .attr('stroke', '#000')
        .attr('stroke-width', 1.2)

      nodeSel.append('text')
        .attr('class', 'label')
        .attr('font-family', 'monospace')
        .attr('font-size', 11)
        .attr('fill', '#ddd')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -d.r - 6)
        .style('opacity', 0)
        .style('pointer-events', 'none')
        .text(d => firstWords(d.sentence, 4))

      // Radial-mode center text was previously rendered into a <foreignObject>
      // here. It moved to a page-level HTML overlay (see app/search/page.jsx)
      // so individual words can be clickable for Scale 3 entry — SVG text
      // doesn't give us per-word click targets cleanly.

      // Adjacency for hover focus (network mode only).
      const adjacency = new Map()
      for (const n of simNodes) adjacency.set(n.id, new Set([n.id]))
      for (const { source, target } of links) {
        adjacency.get(source)?.add(target)
        adjacency.get(target)?.add(source)
      }

      function focusNode(focusId) {
        const neighbors = adjacency.get(focusId) || new Set([focusId])
        // Color-fade rather than opacity-fade — keeps faded nodes opaque so
        // edges traversing their bodies don't show through as wedges.
        nodeSel.select('circle')
          .transition().duration(150)
          .attr('fill', d => neighbors.has(d.id)
            ? (STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
            : (STYLE_COLOR_FADED[d.style_mode] || DEFAULT_FADED))
        nodeSel.select('text.label')
          .transition().duration(150)
          .style('opacity', d => (d.id === focusId ? 1 : 0))
        linkSel.transition().duration(150)
          .attr('stroke-opacity', d =>
            (d.source.id === focusId || d.target.id === focusId
              ? 0.8
              : EDGE_OPACITY * 0.3))
      }

      function clearFocus() {
        nodeSel.select('circle')
          .transition().duration(150)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        nodeSel.select('text.label').transition().duration(150).style('opacity', 0)
        linkSel.transition().duration(150).attr('stroke-opacity', EDGE_OPACITY)
      }

      // Drag tracks distance — short-distance "drag" = treat as click.
      const drag = d3.drag()
        .on('start', (event, d) => {
          d.__dragStart = { x: event.x, y: event.y, moved: false }
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => {
          const s = d.__dragStart
          if (s && Math.hypot(event.x - s.x, event.y - s.y) > 4) s.moved = true
          d.fx = event.x; d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null; d.fy = null
          if (d.__dragStart && !d.__dragStart.moved && typeof onSelectRef.current === 'function') {
            onSelectRef.current(d.id)
          }
          delete d.__dragStart
        })

      nodeSel.call(drag)

      // onSelect can change between renders; keep a single ref object that
      // both the drag handler and the prop-sync effect mutate, so dragging
      // always invokes the current callback without re-binding.
      const onSelectRef = { current: null }

      nodeSel
        .on('mouseenter', (_event, d) => {
          if (sceneRef.current.mode === 'network') focusNode(d.id)
        })
        .on('mouseleave', () => {
          if (sceneRef.current.mode === 'network') clearFocus()
        })

      // ?hover=runs-X debug param (kept from Step B for screenshot harness)
      if (typeof window !== 'undefined') {
        const hoverId = new URLSearchParams(window.location.search).get('hover')
        if (hoverId && adjacency.has(hoverId)) {
          // Defer to next tick so initial transitions don't fight it.
          setTimeout(() => focusNode(hoverId), 50)
        }
      }

      function placeLink(d) {
        const sx = d.source.x, sy = d.source.y
        const tx = d.target.x, ty = d.target.y
        const dx = tx - sx, dy = ty - sy
        const dist = Math.hypot(dx, dy) || 1
        const ux = dx / dist, uy = dy / dist
        return {
          x1: sx + ux * d.source.r, y1: sy + uy * d.source.r,
          x2: tx - ux * d.target.r, y2: ty - uy * d.target.r,
        }
      }

      const simulation = d3.forceSimulation(simNodes)
        .force('link', d3.forceLink(links)
          .id(d => d.id).distance(180).strength(0.4))
        .force('charge', d3.forceManyBody().strength(-500))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('x', d3.forceX(W / 2).strength(0.06))
        .force('y', d3.forceY(H / 2).strength(0.14))
        .force('collide', d3.forceCollide(d => d.r + 6).iterations(2))
        .on('tick', () => {
          linkSel.each(function(d) {
            const p = placeLink(d)
            this.setAttribute('x1', p.x1)
            this.setAttribute('y1', p.y1)
            this.setAttribute('x2', p.x2)
            this.setAttribute('y2', p.y2)
          })
          nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
        })

      simulation.tick(300)
      linkSel.each(function(d) {
        const p = placeLink(d)
        this.setAttribute('x1', p.x1); this.setAttribute('y1', p.y1)
        this.setAttribute('x2', p.x2); this.setAttribute('y2', p.y2)
      })
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)

      const zoom = d3.zoom()
        .scaleExtent([0.2, 8])
        .filter(event => !event.target.closest('.node'))
        .on('zoom', event => root.attr('transform', event.transform))
      svg.call(zoom)

      const handleResize = () => {
        const w = wrapperRef.current?.clientWidth || window.innerWidth
        const h = wrapperRef.current?.clientHeight || window.innerHeight
        svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`)
        simulation.force('center', d3.forceCenter(w / 2, h / 2)).alpha(0.3).restart()
        sceneRef.current.W = w
        sceneRef.current.H = h
        if (sceneRef.current.mode === 'beeswarm') applyBeeswarm()
      }
      window.addEventListener('resize', handleResize)

      // Pre-build immutable scene state.
      sceneRef.current = {
        svg, root, simulation, nodeSel, linkSel, axisLayer, arcLayer,
        simNodes, nodeById, links, adjacency, W, H, mode: 'network',
        dateHue, applyNetwork, applyBeeswarm, applyRadial, onSelectRef,
        cleanup: () => {
          window.removeEventListener('resize', handleResize)
          simulation.stop()
        },
      }

      // Trigger prop-sync effects now that the scene is real.
      setSceneReady(n => n + 1)

      // ====== mode appliers ======

      // Hard-reset every per-node <text class="label"> back to its initial
      // appearance: hidden, the first-4-words text, monospace at 11px,
      // dy aligned to baseR. Called at the top of every mode-apply so
      // residue from radial (per-style typography, "first 6 words" text,
      // 14px, dy=-r-8) or hover (opacity 1) doesn't bleed into the next
      // mode. interrupt() cuts in-flight transitions so the reset wins.
      function resetLabelsToDefault() {
        nodeSel.select('text.label')
          .interrupt()
          .style('opacity', 0)
          .style('font-family', 'monospace')
          .style('font-style', 'normal')
          .attr('font-size', 11)
          .attr('dy', d => -d.baseR - 6)
          .text(d => firstWords(d.sentence, 4))
      }

      function applyNetwork() {
        sceneRef.current.mode = 'network'

        // Full label reset — see resetLabelsToDefault doc.
        resetLabelsToDefault()

        // Nodes back to base size, full color, full opacity, pointer-active
        nodeSel.select('circle')
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('r', d => d.baseR)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        nodeSel
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .style('opacity', 1)
          .style('pointer-events', 'auto')
        // (Label typography reset is handled by resetLabelsToDefault above.)
        // Release any radial pinning
        simNodes.forEach(d => { d.fx = null; d.fy = null; d.r = d.baseR })

        // Edges visible at network opacity
        linkSel.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('stroke-opacity', EDGE_OPACITY)

        // Hide axis, arcs
        axisLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
        arcLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)

        // Restore network forces
        const { W: w, H: h } = sceneRef.current
        simulation
          .force('link', d3.forceLink(links).id(d => d.id).distance(180).strength(0.4))
          .force('charge', d3.forceManyBody().strength(-500))
          .force('center', d3.forceCenter(w / 2, h / 2))
          .force('x', d3.forceX(w / 2).strength(0.06))
          .force('y', d3.forceY(h / 2).strength(0.14))
          .force('collide', d3.forceCollide(d => d.r + 6).iterations(2))
          .alpha(1).restart()
      }

      function applyBeeswarm() {
        sceneRef.current.mode = 'beeswarm'

        // Full label reset — see resetLabelsToDefault doc.
        resetLabelsToDefault()
        // Clear radial-only UI on entry
        arcLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        // Release any radial pinning
        simNodes.forEach(d => { d.fx = null; d.fy = null })
        // Restore opacity / pointer-events on all nodes
        nodeSel.style('opacity', 1).style('pointer-events', 'auto')

        const hitsArr = sceneRef.current.hits || []
        const scoreById = new Map(hitsArr.map(h => [h.id, h.score]))
        const hitOrder = new Map(hitsArr.map((h, i) => [h.id, i])) // 0 = top hit
        const isHit = id => scoreById.has(id)

        // Date scale across the corpus (not just the result set) so absent
        // months still occupy x-space — keeps the timeline honest.
        const dates = simNodes.map(d => new Date(d.date))
        const minDate = new Date(Math.min(...dates))
        const maxDate = new Date(Math.max(...dates))
        const { W: w, H: h } = sceneRef.current
        const x = d3.scaleTime()
          .domain([minDate, maxDate])
          .range([w * 0.08, w * 0.92])

        // Score scale uses the result set's own range.
        const scores = hitsArr.map(h => h.score)
        const scoreMin = scores.length ? Math.min(...scores) : 0
        const scoreMax = scores.length ? Math.max(...scores) : 1
        const yScale = d3.scaleLinear()
          .domain([scoreMin, scoreMax])
          .range([h * 0.70, h * 0.20])
        // Non-result baseline: low band near the bottom
        const baselineY = h * 0.92

        // Node sizing in beeswarm: top hit largest, then linearly shrink.
        // Non-hits stay at small base size.
        function targetR(d) {
          if (!isHit(d.id)) return Math.max(6, d.baseR * 0.45)
          const rank = hitOrder.get(d.id) // 0 = top
          const total = hitsArr.length || 1
          const t = rank / Math.max(1, total - 1) // 0..1
          return d.baseR * 1.2 - t * (d.baseR * 0.7)
        }

        // Apply target r AND tween circle r in sync so collide reflects size.
        simNodes.forEach(d => { d.r = targetR(d) })

        nodeSel.select('circle')
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('r', d => d.r)
          .attr('fill', d => isHit(d.id)
            ? (STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
            : (STYLE_COLOR_FADED[d.style_mode] || DEFAULT_FADED))

        // Hide edges in beeswarm.
        linkSel.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('stroke-opacity', 0)

        // Render the date axis. Recreate cleanly on each beeswarm apply.
        const axisGen = d3.axisBottom(x)
          .ticks(d3.timeWeek.every(1))
          .tickFormat(d3.timeFormat('%b %d'))
        axisLayer.attr('transform', `translate(0, ${h - 24})`)
        axisLayer.call(axisGen)
        axisLayer.selectAll('path').attr('stroke', '#444')
        axisLayer.selectAll('line').attr('stroke', '#444')
        axisLayer.selectAll('text')
          .attr('fill', '#888')
          .style('font-family', 'monospace')
          .style('font-size', '10px')
        axisLayer.transition().duration(TRANSITION_MS / 2).delay(TRANSITION_MS / 2)
          .style('opacity', 1)

        // Swap forces. Drop link + charge + center; install x/y target forces
        // that pull each node to its (date, score) position.
        // forceX/forceY strengths bumped higher than typical so the resolved
        // positions stay within the (date, score) grid; collide alone otherwise
        // bumps nodes past the viewport on dense-date columns.
        simulation
          .force('link', null)
          .force('charge', null)
          .force('center', null)
          .force('x', d3.forceX(d => x(new Date(d.date))).strength(1))
          .force('y', d3.forceY(d => isHit(d.id) ? yScale(scoreById.get(d.id)) : baselineY)
            .strength(1))
          .force('collide', d3.forceCollide(d => d.r + 2).iterations(2))
          .alpha(1).restart()
      }

      function applyRadial(centerId, mltHits) {
        sceneRef.current.mode = 'radial'

        const center = nodeById.get(centerId)
        if (!center) return

        // Top 7 neighbors. If MLT returned fewer (rare on this corpus, but
        // possible for outlier seeds), the rings just have empty slots.
        const top7 = (mltHits || []).slice(0, 7).filter(h => nodeById.has(h.id))
        const visibleIds = new Set([centerId, ...top7.map(h => h.id)])

        const { W: w, H: h } = sceneRef.current
        const cx = w / 2
        const cy = h / 2

        // Compute target positions for the 7 ring members. Inner ring (rank
        // 0..2) at top, lower-right, lower-left. Outer ring (rank 3..6) sits
        // at four cardinal-ish points offset 45° from the inner ring so
        // members don't visually align radially with their inner-ring peers.
        const targets = new Map()
        targets.set(centerId, { x: cx, y: cy })
        top7.forEach((hit, i) => {
          let angle, radius
          if (i < 3) {
            angle = (i * 2 * Math.PI / 3) - Math.PI / 2
            radius = RADIAL_INNER_R
          } else {
            angle = ((i - 3) * 2 * Math.PI / 4) - Math.PI / 2 + Math.PI / 4
            radius = RADIAL_OUTER_R
          }
          targets.set(hit.id, {
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
          })
        })

        // Pin every node so the simulation isn't fighting the layout. Visible
        // members get their target slots; hidden members stay where they are
        // (so when we transition back, they don't teleport).
        simNodes.forEach(d => {
          const t = targets.get(d.id)
          if (t) { d.fx = t.x; d.fy = t.y }
          else { d.fx = d.x; d.fy = d.y }
        })

        // Resize: center small (text does the heavy lifting), ring members
        // sized by rank — top 3 inner-ring biggest, next 4 outer-ring smaller.
        simNodes.forEach(d => {
          if (d.id === centerId) {
            d.r = 10
          } else {
            const rank = top7.findIndex(h => h.id === d.id)
            if (rank === -1) {
              d.r = d.baseR // hidden, but keep r consistent for safety
            } else {
              d.r = rank < 3 ? 18 : 13
            }
          }
        })

        nodeSel.select('circle')
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('r', d => d.r)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)

        // Hide nodes that aren't part of the radial composition. Pointer-events
        // off so hidden nodes can't intercept drags / clicks behind the scene.
        nodeSel
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .style('opacity', d => visibleIds.has(d.id) ? 1 : 0)
          .style('pointer-events', d => visibleIds.has(d.id) ? 'auto' : 'none')

        // Ring-member labels: first ~6 words, style_mode-typed, visible.
        nodeSel.select('text.label')
          .text(d => visibleIds.has(d.id) && d.id !== centerId ? firstWords(d.sentence, 6) : '')
          .each(function(d) {
            const treatment = STYLE_FONT[d.style_mode] || DEFAULT_FONT
            d3.select(this)
              .style('font-family', treatment.family)
              .style('font-style', treatment.style)
              .attr('font-size', RADIAL_NEIGHBOR_FONT)
              .attr('dy', -d.r - 8)
          })
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .style('opacity', d => (visibleIds.has(d.id) && d.id !== centerId) ? 0.85 : 0)

        // Hide network edges (radial uses its own arc layer)
        linkSel.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('stroke-opacity', 0)

        // Hide axis layer
        axisLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)

        // Build arc data: one per neighbor connecting center → neighbor.
        const arcData = top7.map(hit => {
          const target = targets.get(hit.id)
          const neighborNode = nodeById.get(hit.id)
          return {
            id: hit.id,
            x1: cx, y1: cy,
            x2: target.x, y2: target.y,
            score: hit.score,
            hue: dateHue(neighborNode.date),
          }
        })

        const arcWidth = d3.scaleLinear()
          .domain(ARC_WIDTH_DOMAIN).range(ARC_WIDTH_RANGE).clamp(true)

        // Render arcs. Stroke color uses date-hue; thickness scales with score.
        const arcSel = arcLayer.selectAll('line.arc').data(arcData, d => d.id)
        arcSel.exit().remove()
        const arcEnter = arcSel.enter()
          .append('line')
          .attr('class', 'arc')
          .attr('stroke-linecap', 'round')
          .attr('x1', d => d.x1).attr('y1', d => d.y1)
          .attr('x2', d => d.x2).attr('y2', d => d.y2)
          .attr('stroke', d => `hsl(${d.hue}, 65%, 55%)`)
          .attr('stroke-width', d => arcWidth(d.score))
          .attr('stroke-opacity', 0)
        arcEnter.merge(arcSel)
          .attr('stroke', d => `hsl(${d.hue}, 65%, 55%)`)
          .attr('stroke-width', d => arcWidth(d.score))
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('x1', d => d.x1).attr('y1', d => d.y1)
          .attr('x2', d => d.x2).attr('y2', d => d.y2)
          .attr('stroke-opacity', 0.7)

        arcLayer.transition().duration(TRANSITION_MS / 2).delay(TRANSITION_MS / 2)
          .style('opacity', 1)

        // (Center sentence text is rendered by the page-level HTML overlay,
        // not by this canvas — see app/search/page.jsx.)

        // Drop link/charge/center forces — all visible nodes are pinned.
        // Keep collide so dragging a ring member doesn't punch through the
        // center text region (collide acts on simNodes' actual r values).
        simulation
          .force('link', null)
          .force('charge', null)
          .force('center', null)
          .force('x', null)
          .force('y', null)
          .force('collide', d3.forceCollide(d => d.r + 4).iterations(1))
          .alpha(0.3).restart()
      }
    })()

    return () => {
      cancelled = true
      sceneRef.current?.cleanup?.()
      sceneRef.current = null
    }
  }, [])

  // Mode swap on prop changes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.hits = hits
    if (scene.onSelectRef) scene.onSelectRef.current = onSelect ?? null

    if (selectedId && mltHits) {
      scene.applyRadial(selectedId, mltHits)
    } else if (query && hits && hits.length > 0) {
      scene.applyBeeswarm()
    } else {
      scene.applyNetwork()
    }
  }, [query, hits, selectedId, mltHits, onSelect, sceneReady])

  // Step F: dim/highlight overlay. Runs after mode-apply so the brightening
  // wins over whatever base color the active mode set.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const { nodeSel, linkSel } = scene
    if (!nodeSel) return

    const hi = highlightIds && highlightIds.size > 0 ? highlightIds : null

    if (dim) {
      nodeSel.select('circle')
        .transition().duration(200)
        .attr('fill', d => {
          if (hi && hi.has(d.id)) {
            return STYLE_COLOR[d.style_mode] || DEFAULT_COLOR
          }
          return STYLE_COLOR_FADED[d.style_mode] || DEFAULT_FADED
        })
      // Edges always invisible in dim mode — they aren't useful at low alpha.
      linkSel?.transition().duration(200).attr('stroke-opacity', 0)
      // Disable hover handlers' work by preventing pointer interactions on
      // dim-mode nodes — the histogram owns hover semantics now.
      nodeSel.style('pointer-events', 'none')
    } else {
      // Restore default pointer-events (network mode handles its own focus).
      nodeSel.style('pointer-events', 'auto')
      // Don't override fills here — the active mode's apply will handle it
      // on the next prop swap. If we're toggling dim off without changing
      // mode (e.g. user just exited Scale 4), force a network-mode reapply.
      if (scene.mode === 'network') {
        nodeSel.select('circle')
          .transition().duration(200)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        linkSel?.transition().duration(200).attr('stroke-opacity', EDGE_OPACITY)
      }
    }
  }, [dim, highlightIds, sceneReady])

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      {error && (
        <div style={{
          position: 'absolute', top: 12, left: 12, color: '#888',
          fontFamily: 'monospace', fontSize: 12,
        }}>
          failed to load corpus data: {error}
        </div>
      )}
      <svg ref={svgRef} style={{ display: 'block' }} />
    </div>
  )
}
