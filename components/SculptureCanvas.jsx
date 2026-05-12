'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import {
  PALETTE_SETS,
  DEFAULT_COLOR,
  fadedColorFor,
  STYLE_FONT,
  DEFAULT_FONT,
} from '../lib/palette.mjs'
// Scales 1, 1b, and 2 — animated corpus dots, beeswarm search, radial arc.
// Mode priority: selectedId set → radial; else query+hits → beeswarm; else network.
// Loads precomputed /public/data/{nodes,graph}.json once and shares the
// same SVG / simulation / node selection across modes.
//
// Network mode (animated line drawing): nodes are positioned by a force
// sim that runs once at init then freezes. Each node renders as a small
// colored dot. An autonomous engine activates a random node every 2s —
// activation draws thin lines from the node to its MLT neighbors with a
// pen-plotting effect (stroke-dasharray tween over 800ms), holds for 1s,
// then fades over 1.5s. Multiple activations run in parallel so the
// canvas always has a few line sets in flight at different stages.
// Hovering a node activates it immediately and pauses the timer.
// Beeswarm and radial reuse the same simulation with their own forces;
// transitions stop the engine and clear in-flight lines.

const TRANSITION_MS = 800
const CELL_FADE_MS = 400

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
  // Page-owned session config: { palette, seed }. Page picks random
  // values in a useEffect on first mount; we rebuild the scene whenever
  // sessionConfig changes so all mode appliers' captured colors stay
  // current. Default keeps SSR/first hydration deterministic. The seed
  // isn't used by the activation engine (which uses Math.random for
  // genuinely time-varying patterns) but is kept for parity with other
  // session-stable bits (palette).
  sessionConfig = {
    palette: PALETTE_SETS[0],
    seed: 1,
  },
}) {
  const palette = sessionConfig.palette
  const STYLE_COLOR = palette.colors
  const fadedColor = (sm) => fadedColorFor(palette, sm)

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

      // Line layer — one <line> per active activation, painted under
      // nodes. Lines are appended dynamically by the animation engine
      // and self-remove via a transition .on('end') handler.
      const lineLayer = root.append('g')
        .attr('class', 'activation-lines')
        .style('pointer-events', 'none')

      // (linkSel is dead from earlier iterations — kept as an empty
      // selection so beeswarm/radial code that references it still
      // returns a no-op selection rather than crashing.)
      const linkSel = root.append('g').attr('class', 'links').selectAll('line')

      const nodeSel = root.append('g')
        .attr('class', 'nodes')
        .selectAll('g.node')
        .data(simNodes, d => d.id)
        .join('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')

      // Network-mode dot radius. Beeswarm and radial scale circles via
      // their own d.r writes; applyNetwork resets back to NODE_DOT_R.
      const NODE_DOT_R = 6
      nodeSel.append('circle')
        .attr('r', NODE_DOT_R)
        .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        .attr('stroke', 'none')

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

      // Hover focus on the corpus dots: the hovered node shows its
      // label; the activation engine handles the visual link-drawing
      // separately (see activateNode). No other node visuals change.
      function focusNode(focusId) {
        nodeSel.select('text.label')
          .style('opacity', d => d.id === focusId ? 1 : 0)
      }

      function clearNodeFocus() {
        nodeSel.select('text.label').style('opacity', 0)
      }

      // onSelect can change between renders; keep a single ref object
      // that both the click handler and the prop-sync effect mutate, so
      // clicks always invoke the current callback without re-binding.
      const onSelectRef = { current: null }

      // Hovering state for the activation engine — held in a closure-
      // shared object so node handlers and the interval can read/write
      // the same flag without re-binding.
      const isHoveringRef = { hovering: false }

      // Node interactions:
      //   - mouseenter: activate the node (engine draws lines), pause
      //     the autonomous timer, show the hover label.
      //   - mouseleave: hide label, resume timer.
      //   - click: enter Scale 2 radial via onSelect.
      // All gated to network mode — beeswarm/radial set their own
      // handlers via the existing dim/click flows. activateNode and
      // focusNode are defined further down in this scope; closures
      // resolve them lazily when DOM events fire.
      nodeSel
        .on('mouseenter', (_event, d) => {
          if (sceneRef.current?.mode !== 'network' || sceneRef.current?.dim) return
          isHoveringRef.hovering = true
          focusNode(d.id)
          activateNode(d.id)
        })
        .on('mouseleave', () => {
          if (sceneRef.current?.mode !== 'network' || sceneRef.current?.dim) return
          isHoveringRef.hovering = false
          clearNodeFocus()
        })
        .on('click', (event, d) => {
          event.stopPropagation()
          if (typeof onSelectRef.current === 'function') {
            onSelectRef.current(d.id)
          }
        })

      const simulation = d3.forceSimulation(simNodes)
        .force('link', d3.forceLink(links)
          .id(d => d.id).distance(220).strength(0.4))
        .force('charge', d3.forceManyBody().strength(-700))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('x', d3.forceX(W / 2).strength(0.06))
        .force('y', d3.forceY(H / 2).strength(0.14))
        .force('collide', d3.forceCollide(d => d.r + 6).iterations(2))
        .on('tick', () => {
          // Beeswarm/radial reuse this simulation; only their forces are
          // ticking. We just translate the circles. Cells stay frozen.
          nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
        })

      // ---- Force-sim settle ----
      //
      // Run the simulation headlessly to settle nodes into their
      // network layout, then pin and stop. The settled positions feed
      // the activation engine (line endpoints) and serve as the
      // restore-target when returning from beeswarm/radial.
      simulation.tick(300)
      simulation.stop()
      simNodes.forEach(d => { d.fx = d.x; d.fy = d.y })
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)

      // Cache the settled positions so applyNetwork can restore them
      // after beeswarm/radial overwrite n.fx/fy with their own targets.
      // `let` because the resize handler refreshes this when nodes
      // settle into a new viewport.
      let settledPositions = new Map(
        simNodes.map(n => [n.id, { x: n.x, y: n.y }])
      )

      // ---- Activation engine ----
      //
      // Every 2 seconds (autonomous) or on hover (interactive), one
      // node is "activated": short lines draw progressively from the
      // node to each of its MLT neighbors using stroke-dashoffset
      // tweens, hold for 1 second, then fade out over 1.5 seconds.
      // Multiple activations overlap; at any moment 3-5 sets are in
      // flight. The interval pauses while the user is hovering.

      const ACTIVATION_INTERVAL_MS = 1200
      const ACTIVATION_DRAW_MS = 800
      const ACTIVATION_HOLD_MS = 1000
      const ACTIVATION_FADE_MS = 1500
      const ACTIVATION_MAX_OPACITY = 0.85

      // Track every line element currently in flight so we can
      // .interrupt().remove() them on mode transitions.
      const activeLines = new Set()

      function activateNode(nodeId) {
        const source = nodeById.get(nodeId)
        if (!source) return
        const neighbors = (graph[nodeId] || [])
          .map(({ id }) => nodeById.get(id))
          .filter(Boolean)
        const color = STYLE_COLOR[source.style_mode] || DEFAULT_COLOR

        for (const target of neighbors) {
          const dx = target.x - source.x
          const dy = target.y - source.y
          const totalLen = Math.hypot(dx, dy) || 1

          const lineNode = lineLayer.append('line')
            .attr('class', 'activation')
            .attr('x1', source.x).attr('y1', source.y)
            .attr('x2', target.x).attr('y2', target.y)
            .attr('stroke', color)
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0)
            .attr('stroke-dasharray', totalLen)
            .attr('stroke-dashoffset', totalLen)
            .node()

          activeLines.add(lineNode)

          d3.select(lineNode)
            // Phase 1: draw — stroke pulls itself across the line
            // while opacity rises to its hold value.
            .transition().duration(ACTIVATION_DRAW_MS).ease(d3.easeCubicInOut)
              .attr('stroke-dashoffset', 0)
              .attr('stroke-opacity', ACTIVATION_MAX_OPACITY)
            // Phase 2: hold (delay before phase 3 — d3 chains transitions
            // sequentially via .transition() following another).
            // Phase 3: fade out.
            .transition().delay(ACTIVATION_HOLD_MS).duration(ACTIVATION_FADE_MS)
            .ease(d3.easeCubicIn)
              .attr('stroke-opacity', 0)
            .on('end', function () {
              activeLines.delete(this)
              this.remove()
            })
            .on('interrupt', function () {
              activeLines.delete(this)
              this.remove()
            })
        }
      }

      let activationIntervalId = null

      function startActivationEngine() {
        if (activationIntervalId !== null) return
        activationIntervalId = setInterval(() => {
          if (isHoveringRef.hovering) return
          if (sceneRef.current?.mode !== 'network') return
          if (sceneRef.current?.dim) return
          const i = Math.floor(Math.random() * simNodes.length)
          activateNode(simNodes[i].id)
        }, ACTIVATION_INTERVAL_MS)
      }

      function stopActivationEngine() {
        if (activationIntervalId !== null) {
          clearInterval(activationIntervalId)
          activationIntervalId = null
        }
      }

      function clearAllActivationLines() {
        // .interrupt() triggers the 'interrupt' handler above, which
        // removes the line from activeLines and the DOM.
        for (const el of [...activeLines]) {
          d3.select(el).interrupt()
        }
        // Defensive: any line that escaped activeLines tracking.
        lineLayer.selectAll('line.activation').remove()
        activeLines.clear()
      }

      // Kick the engine off — it'll fire its first activation in 2s.
      startActivationEngine()


      const zoom = d3.zoom()
        .scaleExtent([0.2, 8])
        .filter(event => !event.target.closest('.node'))
        .on('zoom', event => root.attr('transform', event.transform))
      svg.call(zoom)

      const handleResize = () => {
        const w = wrapperRef.current?.clientWidth || window.innerWidth
        const h = wrapperRef.current?.clientHeight || window.innerHeight
        svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`)
        sceneRef.current.W = w
        sceneRef.current.H = h
        if (sceneRef.current.mode === 'network') {
          // Re-settle into the new viewport. Wipe in-flight activation
          // lines first — their endpoints are about to become invalid
          // when nodes shift. Then unpin, run a quick alpha=0.5 settle,
          // re-pin, refresh the position cache, and restart the engine.
          clearAllActivationLines()
          stopActivationEngine()
          simNodes.forEach(d => { d.fx = null; d.fy = null })
          simulation
            .force('center', d3.forceCenter(w / 2, h / 2))
            .force('x', d3.forceX(w / 2).strength(0.06))
            .force('y', d3.forceY(h / 2).strength(0.14))
            .alpha(0.5)
          simulation.tick(150)
          simulation.stop()
          simNodes.forEach(d => { d.fx = d.x; d.fy = d.y })
          nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
          settledPositions = new Map(
            simNodes.map(n => [n.id, { x: n.x, y: n.y }])
          )
          startActivationEngine()
        } else if (sceneRef.current.mode === 'beeswarm') {
          simulation.force('center', d3.forceCenter(w / 2, h / 2)).alpha(0.3).restart()
          applyBeeswarm()
        } else if (sceneRef.current.mode === 'radial' && sceneRef.current.lastRadial) {
          // Re-apply radial against new center.
          const { centerId, mltHits } = sceneRef.current.lastRadial
          applyRadial(centerId, mltHits)
        }
      }
      window.addEventListener('resize', handleResize)

      // Pre-build immutable scene state.
      sceneRef.current = {
        svg, root, simulation, nodeSel, linkSel, axisLayer, arcLayer,
        lineLayer,
        simNodes, nodeById, links, adjacency, W, H, mode: 'network',
        dim: false,
        settledPositions,
        startActivationEngine, stopActivationEngine, clearAllActivationLines,
        clearNodeFocus,
        dateHue, applyNetwork, applyBeeswarm, applyRadial, onSelectRef,
        cleanup: () => {
          window.removeEventListener('resize', handleResize)
          stopActivationEngine()
          clearAllActivationLines()
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
        sceneRef.current.lastRadial = null

        // Full label reset — see resetLabelsToDefault doc.
        resetLabelsToDefault()
        clearNodeFocus()

        // Restore cached settled positions. Beeswarm/radial overwrite
        // n.fx/fy with their own targets, so re-pin from the cache.
        // Set radius to the small dot size used in network mode.
        simNodes.forEach(d => {
          const p = settledPositions.get(d.id)
          if (p) {
            d.x = p.x; d.y = p.y
            d.fx = p.x; d.fy = p.y
          }
          d.r = NODE_DOT_R
        })
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
        nodeSel.select('circle').attr('r', NODE_DOT_R)

        // Stop the sim — corpus mode reads frozen positions, no ticking.
        simulation.alpha(0).stop()

        // Restore corpus visuals: nodes back to full opacity + interactive,
        // ancillary layers (axis, arcs) fade out, activation engine
        // resumes with a fresh start.
        clearAllActivationLines()
        nodeSel
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .style('opacity', 1)
          .style('pointer-events', 'auto')
        axisLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
        arcLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
        startActivationEngine()
      }

      function applyBeeswarm() {
        sceneRef.current.mode = 'beeswarm'

        // Stop the activation engine and clear in-flight lines — the
        // beeswarm transition shouldn't show stale corpus animation.
        stopActivationEngine()
        clearAllActivationLines()
        clearNodeFocus()

        // Full label reset — see resetLabelsToDefault doc.
        resetLabelsToDefault()
        // Clear radial-only UI on entry
        arcLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        // Release any radial pinning so beeswarm forces can move nodes.
        simNodes.forEach(d => { d.fx = null; d.fy = null })
        // Make sure nodes are visible/interactive (corpus mode left
        // them visible too, but other modes might not).
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
            : fadedColor(d.style_mode))

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
        sceneRef.current.lastRadial = { centerId, mltHits }

        const center = nodeById.get(centerId)
        if (!center) return

        // Stop the activation engine and clear in-flight lines — the
        // radial composition shouldn't show stale corpus animation.
        stopActivationEngine()
        clearAllActivationLines()
        clearNodeFocus()

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

        // (No network edges to hide — Step II removed link rendering.)

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
    // Rebuild the scene whenever sessionConfig changes — the appliers
    // capture STYLE_COLOR / fadedColor in their closures and the corpus
    // composition is seeded from sessionConfig.seed, so a fresh config
    // means a fresh scene. On initial load this fires twice in quick
    // succession (server default → page useEffect picks random values);
    // the ~5ms cost (no force ticking now — pure template placement) is
    // imperceptible.
  }, [sessionConfig])

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

  // Scale 4 backdrop: dim the corpus dots to faded variants while
  // highlightIds (above-average letter frequency) stay vivid. Also
  // pauses the activation engine and clears in-flight lines, so the
  // backdrop reads as still while the histogram owns the foreground.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const { nodeSel } = scene
    if (!nodeSel) return

    const hi = highlightIds && highlightIds.size > 0 ? highlightIds : null
    scene.dim = dim

    function pickFill(d) {
      if (hi && hi.has(d.id)) return STYLE_COLOR[d.style_mode] || DEFAULT_COLOR
      return fadedColor(d.style_mode)
    }

    if (dim) {
      nodeSel.select('circle').transition().duration(200).attr('fill', pickFill)
      nodeSel.style('pointer-events', 'none')
      scene.clearNodeFocus?.()
      scene.stopActivationEngine?.()
      scene.clearAllActivationLines?.()
    } else {
      nodeSel.style('pointer-events', 'auto')
      // If we're toggling dim off without changing mode (i.e. user just
      // exited Scale 4 back to corpus), restore vivid fills and resume
      // the engine. If a mode change is what triggered dim=false, the
      // mode applier handles fills on its own.
      if (scene.mode === 'network') {
        nodeSel.select('circle')
          .transition().duration(200)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
        scene.startActivationEngine?.()
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
