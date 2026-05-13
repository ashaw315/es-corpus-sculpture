'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import {
  PALETTE_SETS,
  DEFAULT_COLOR,
  fadedColorFor,
  nodeColor,
  STYLE_FONT,
  DEFAULT_FONT,
} from '../lib/palette.mjs'

// Corpus-mode background — warm off-white "ground" per v2 spec. Swaps to
// CANVAS_BG_DEEP when entering beeswarm/radial; swaps back on return.
const CANVAS_BG_GROUND = '#f5f2ed'
const CANVAS_BG_DEEP = '#000000'
const NODE_OPACITY_CORPUS = 0.85
const NODE_OPACITY_DEEP = 1.0
// Uniform leaf-circle radius in corpus mode — the radial cluster reads
// as a tree of relationships, not a chart of sentence lengths.
const LEAF_R = 5
// Inner branch nodes (style_mode hubs + month nodes).
const BRANCH_R = 5
// Root-node circle at canvas center.
const ROOT_R = 4
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

// Radial-mode geometry. Step III replaces the old line+circle layout
// with d3.pie + d3.arc wedges. innerRadius is the fixed void
// containing the center sentence overlay (240px circle, rendered by
// app/search/page.jsx). The two outer rings are computed per-viewport
// in applyRadial: outerOuter = 75% of (min(W, H-48) / 2), innerOuter
// = 72% of outerOuter, giving the exploded inner-vs-outer ring feel.
const WEDGE_INNER_R = 120
const WEDGE_HOVER_LIFT = 20
const WEDGE_PAD_ANGLE = 0.02
// (Center sentence font size lives in the page overlay.)
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

// Linear length → leaf-circle radius mapping per radial-cluster spec.
// Shortest sentence → 6px, longest → 24px. Smaller ceiling than earlier
// versions because the cluster ring spaces leaves out evenly; we don't
// need the painting-reference 40-48px extremes.
function nodeRadius(length, lenMin, lenMax) {
  if (lenMax === lenMin) return 15
  const t = (length - lenMin) / (lenMax - lenMin)
  return 6 + Math.max(0, Math.min(1, t)) * 18
}

// Radial cluster layout via d3.cluster() on a two-level hierarchy:
//   root → style_mode branches (5) → individual sentences (leaves)
// Groups are sorted largest-first; leaves within a group are sorted by
// date ascending. Returns the geometry needed by the renderer:
// projected positions for branches and leaves, the link list, the ring
// radius, and the center coordinates. simNodes are mutated in place so
// hover/click can read d.x/d.y/d.angle from the same object the
// activation engine activates.
function buildClusterLayout(simNodes, W, H, Rmax) {
  const cx = W / 2
  const cy = (H - 48) / 2
  // No permanent text labels — the tree fills 84% of the viewport
  // (radius = 0.42 * min(W, H-48)) with the remaining ~8% on each
  // side as breathing room. Rmax kept as an override for callers
  // that still want a bbox-fit pass; default takes the spec'd ratio.
  const halfMin = Math.min(W, H - 48) / 2
  const initialR = Math.max(60, halfMin * 0.84)
  const R = typeof Rmax === 'number' ? Math.max(60, Rmax) : initialR

  // Group leaves by style_mode and sort within-group by date asc.
  const groups = new Map()
  for (const n of simNodes) {
    if (!groups.has(n.style_mode)) groups.set(n.style_mode, [])
    groups.get(n.style_mode).push(n)
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => new Date(a.date) - new Date(b.date))
  }

  // Stable group order: largest group first, ties broken alpha.
  const groupArr = [...groups.entries()].sort((a, b) => {
    const c = b[1].length - a[1].length
    return c !== 0 ? c : a[0].localeCompare(b[0])
  })

  // Build the hierarchy for d3.cluster() with an optional middle
  // level: months. Within each style_mode, walk the date-sorted
  // leaves and bucket consecutive same-month leaves; if a bucket has
  // ≥3 sentences emit a month node, otherwise inline its leaves
  // directly under the style_mode (keeps the tree clean for sparse
  // months). Month label is the abbreviated name (Jan/Feb/Mar/...).
  const MONTH_THRESHOLD = 3
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function monthKey(date) {
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
  }
  function monthLabel(date) {
    return MONTH_ABBR[new Date(date).getMonth()]
  }

  function buildStyleChildren(styleMode, nodes) {
    // nodes is already sorted by date asc — bucket consecutive
    // same-month entries.
    const buckets = []
    for (const n of nodes) {
      const k = monthKey(n.date)
      const last = buckets[buckets.length - 1]
      if (last && last.key === k) last.nodes.push(n)
      else buckets.push({ key: k, nodes: [n], styleMode })
    }
    const children = []
    for (const b of buckets) {
      if (b.nodes.length >= MONTH_THRESHOLD) {
        children.push({
          name: `${styleMode}|${b.key}`,
          isMonth: true,
          styleMode,
          monthLabel: monthLabel(b.nodes[0].date),
          children: b.nodes.map(node => ({ name: node.id, styleMode, node })),
        })
      } else {
        for (const node of b.nodes) {
          children.push({ name: node.id, styleMode, node })
        }
      }
    }
    return children
  }

  const rootData = {
    name: '__root',
    children: groupArr.map(([styleMode, nodes]) => ({
      name: styleMode,
      styleMode,
      children: buildStyleChildren(styleMode, nodes),
    })),
  }

  // d3.cluster() in [0, 2π] × [0, R] — first coord is angle, second
  // radius. Internal nodes land at proportional radii based on their
  // depth; we then override depth-1 (style_mode) and depth-2 (month)
  // anchors below to sit at fixed mid-rings.
  const rootH = d3.hierarchy(rootData)
  const cluster = d3.cluster().size([2 * Math.PI, R])
  cluster(rootH)

  // Project each hierarchy node into Cartesian space, anchored at (cx, cy).
  // d.x is the angle (radians, 0 = down per d3.cluster convention).
  // We rotate -π/2 so 0 reads as "top" — matches user expectation that
  // group 0 starts at the top of the canvas.
  function project(d) {
    const angle = d.x - Math.PI / 2
    return [cx + Math.cos(angle) * d.y, cy + Math.sin(angle) * d.y]
  }

  // Override radii so the three internal layers land on stable rings:
  //   depth 1 (style_mode hubs):  R * 0.40
  //   depth 2 (month nodes):      R * 0.72
  //   depth 3+ (sentence leaves): R   (outer)
  // Sentence leaves can also live at depth 2 (sparse months that didn't
  // earn an intermediate); those still ride the outer ring.
  rootH.each(node => {
    if (node.depth === 1) node.y = R * 0.40
    else if (node.depth === 2) {
      if (node.data.isMonth) node.y = R * 0.72
      else node.y = R
    } else if (node.depth === 3) node.y = R
  })

  // Inner branch nodes (depth=1): style_mode anchors.
  const branches = rootH.children.map(child => {
    const [px, py] = project(child)
    return {
      styleMode: child.data.styleMode,
      count: child.descendants().filter(d => d.data.node).length,
      x: px, y: py,
      angle: (child.x - Math.PI / 2) * 180 / Math.PI,
      hNode: child,
    }
  })

  // Month nodes (depth=2, isMonth=true): the optional date subdivision.
  const months = []
  for (const groupNode of rootH.children) {
    for (const child of groupNode.children) {
      if (child.data.isMonth) {
        const [px, py] = project(child)
        months.push({
          styleMode: child.data.styleMode,
          monthLabel: child.data.monthLabel,
          x: px, y: py,
          angle: (child.x - Math.PI / 2) * 180 / Math.PI,
          hNode: child,
        })
      }
    }
  }

  // Leaves (depth=2 or 3 — wherever a node has a `node` ref). Write
  // x/y/angle back onto the simNode so click/hover code that reads
  // d.x/d.y picks up the ring position.
  const leaves = []
  rootH.each(h => {
    if (!h.data.node) return
    const [px, py] = project(h)
    const sim = h.data.node
    sim.x = px
    sim.y = py
    sim.fx = px
    sim.fy = py
    sim.angle = (h.x - Math.PI / 2) * 180 / Math.PI
    leaves.push({
      node: sim,
      x: px, y: py,
      angle: sim.angle,
      hNode: h,
    })
  })

  // All hierarchy edges from rootH.links() — both depths. Inner edges
  // (root → styleMode) curve from the center to the inner-ring anchor;
  // outer edges (styleMode → leaf) curve from the anchor to the leaf.
  // Coloring is driven by the deeper end's style_mode, so an inner
  // edge inherits its branch's color and an outer edge inherits its
  // group's color — the whole sub-tree reads as one color family.
  const allLinks = rootH.links().map(link => ({
    source: link.source,
    target: link.target,
    depth: link.target.depth,
    styleMode:
      link.target.data.styleMode ??
      link.source.data.styleMode ??
      null,
  }))

  return { cx, cy, R, branches, months, leaves, allLinks, rootH }
}

export default function SculptureCanvas({
  query = '',
  hits = null,
  selectedId = null,
  mltHits = null,
  onSelect,
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
  const tooltipDivRef = useRef(null)
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
      const lens = nodes.map(n => n.length)
      const lenMin = Math.min(...lens)
      const lenMax = Math.max(...lens)
      // Corpus-mode leaf radius is uniform (LEAF_R, set on every node's
      // `r`). baseR keeps the length-scaled value because beeswarm's
      // sizing logic reads it — when the search view picks up, top hits
      // grow and non-hits shrink relative to baseR. In corpus mode r is
      // overwritten back to LEAF_R by applyNetwork.
      const simNodes = nodes.map(n => ({
        ...n,
        baseR: nodeRadius(n.length, lenMin, lenMax),
        r: LEAF_R,
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

      // Full-canvas ground rect, painted under the zoom root. Sits outside
      // the zoom group so panning/zooming doesn't reveal the page color
      // behind it. The fill tweens between CANVAS_BG_GROUND (corpus) and
      // CANVAS_BG_DEEP (beeswarm/radial) via the mode appliers.
      const bgRect = svg.append('rect')
        .attr('class', 'canvas-bg')
        .attr('x', 0).attr('y', 0)
        .attr('width', W).attr('height', H)
        .attr('fill', CANVAS_BG_GROUND)
        .style('pointer-events', 'none')

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

      // <defs> for per-edge linearGradients used by the chord layer.
      // Sits at SVG root (outside the zoom/pan transform) so gradients
      // are addressable by URL from any layer.
      const defs = svg.append('defs')

      // Cluster tree layers — corpus mode only. Z-order matters:
      // Branches paint first, then activation strokes, then internal
      // dots (root, hubs, months), then leaves. No permanent text:
      // hover routes through tooltipText (appended later, outside
      // the zoom-root so it never gets clipped).
      //   branchLayer       — <path> per hierarchy edge
      //   chordLayer        — <path> per active MLT highlight
      //   branchNodeLayer   — <circle> root + style_mode hubs + month dots
      //   nodeSel           — <g.node> per leaf
      const branchLayer = root.append('g')
        .attr('class', 'branches')
        .style('pointer-events', 'none')
      const chordLayer = root.append('g')
        .attr('class', 'chords')
        .style('pointer-events', 'none')
      const branchNodeLayer = root.append('g')
        .attr('class', 'branch-nodes')
        .style('pointer-events', 'none')
      // The single root circle at canvas center — the visible anchor
      // every styleMode branch radiates from.
      const rootNodeCircle = branchNodeLayer.append('circle')
        .attr('class', 'root-node')
        .attr('r', ROOT_R)
        .attr('fill', '#1a1a1a')
        .style('opacity', 0.7)

      // Scale 2 wedge layer — d3.pie + d3.arc filled segments
      // around the selected sentence. Hidden in network/beeswarm,
      // owned entirely by applyRadial. Sits above branch nodes so
      // wedges paint over the (faded-out) cluster geometry.
      const wedgeLayer = root.append('g')
        .attr('class', 'wedges')
        .style('pointer-events', 'none')
        .style('opacity', 0)

      // Scale 1b bar layer — horizontal bars per search result.
      // Owned by applyBeeswarm; hidden in every other mode. Sits
      // above the (faded) corpus tree so bars read as the foreground.
      const barLayer = root.append('g')
        .attr('class', 'bars')
        .style('opacity', 0)

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

      // Hover tooltip — a single <text> element painted above every
      // other layer. Hidden until a node hover sets its text +
      // position, hidden again on mouseleave. Outside the zoom-root
      // so it never gets clipped by transforms; positioned in SVG
      // user space.
      const tooltipText = svg.append('text')
        .attr('class', 'hover-tooltip')
        .attr('font-family', 'monospace')
        .attr('font-size', 11)
        .attr('text-anchor', 'middle')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .attr('dy', '0.32em')
      function showTooltip(text, x, y, color) {
        tooltipText
          .attr('x', x)
          .attr('y', y)
          .attr('fill', color || '#1a1a1a')
          .text(text)
          .style('opacity', 1)
      }
      function hideTooltip() {
        tooltipText.style('opacity', 0)
      }

      // Corpus-mode circles: uniform LEAF_R, per-node varied palette
      // fill, 0.85 opacity. Beeswarm/radial overwrite r via their
      // appliers; applyNetwork resets back to LEAF_R.
      nodeSel.append('circle')
        .attr('r', d => d.r)
        .attr('fill', d => nodeColor(d, palette))
        .attr('stroke', 'none')
        .attr('fill-opacity', NODE_OPACITY_CORPUS)

      // Hover-only label: first 8 words at 11px monospace, hidden
      // until focusNode raises opacity. Tucks beside the leaf along
      // (Per-node permanent labels removed — hover routes through the
      // single canvas-level tooltipText element above. Beeswarm and
      // radial appliers still expect a 'text.label' inside <g.node>
      // for legacy reasons; we keep one but with empty text and
      // pointer-events: none, so resetLabelsToDefault and the radial
      // applier still resolve their selections without crashing.)
      nodeSel.append('text')
        .attr('class', 'label')
        .style('opacity', 0)
        .style('pointer-events', 'none')

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

      // Hover focus uses the canvas-level tooltipText element.
      // Position the tooltip ~16px outboard of the node along its
      // radial axis so it never overlaps the leaf circle and reads
      // outward like the per-leaf labels did. For nodes very near
      // the center (root, depth-1 hubs) the radial direction is
      // ill-defined; fall back to "just above the node".
      function tooltipAnchor(x, y) {
        const ci = clusterInfo
        const dx = x - ci.cx
        const dy = y - ci.cy
        const len = Math.hypot(dx, dy)
        if (len < 4) return { x, y: y - 16 }
        const k = (len + 16) / len
        return { x: ci.cx + dx * k, y: ci.cy + dy * k }
      }
      function focusNode(focusId) {
        const d = nodeById.get(focusId)
        if (!d) return hideTooltip()
        const a = tooltipAnchor(d.x, d.y)
        showTooltip(firstWords(d.sentence, 8), a.x, a.y, STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
      }
      function clearNodeFocus() {
        hideTooltip()
      }

      // onSelect can change between renders; keep a single ref object
      // that both the click handler and the prop-sync effect mutate, so
      // clicks always invoke the current callback without re-binding.
      const onSelectRef = { current: null }

      nodeSel
        .on('mouseenter', (_event, d) => {
          if (sceneRef.current?.mode !== 'network') return
          focusNode(d.id)
          // Pause the autonomous engine and immediately fire this
          // node's tree-path activations into the hover slot. Each
          // path stages with NEIGHBOR_STAGGER_MS between neighbors.
          isHoveringRef.hovering = true
          extinguishSlot('hover', 0)
          activateNode(d.id, 'hover')
        })
        .on('mouseleave', () => {
          if (sceneRef.current?.mode !== 'network') return
          clearNodeFocus()
          isHoveringRef.hovering = false
          extinguishSlot('hover', HOVER_FADE_OUT_MS)
        })
        .on('click', (event, d) => {
          event.stopPropagation()
          if (typeof onSelectRef.current === 'function') {
            onSelectRef.current(d.id)
          }
        })

      // The simulation object is kept around because beeswarm and radial
      // reinstall their own forces on it (forceX/Y to date+score for
      // beeswarm; pinning + collide for radial). Corpus mode uses a
      // fixed ring layout instead — we build the sim with no forces so
      // it sits idle until a mode-applier wakes it up.
      const simulation = d3.forceSimulation(simNodes)
        .stop()
        .on('tick', () => {
          // Beeswarm/radial reuse this simulation; only their forces are
          // ticking. Clamp every tick so high-repulsion outliers can't
          // bleed below the legend strip or past the canvas edges during
          // an alpha-restart transition. The 8px buffer at the bottom
          // keeps the largest circles clear of the strip.
          const { W: tw, H: th } = sceneRef.current || { W, H }
          simNodes.forEach(d => {
            d.x = Math.max(d.r, Math.min(tw - d.r, d.x))
            d.y = Math.max(d.r, Math.min(th - 48 - d.r - 8, d.y))
          })
          nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
        })

      // ---- Initial radial cluster placement ----
      //
      // No force settle — corpus mode uses a deterministic d3.cluster()
      // hierarchy: root → 5 style_mode branches → 48 sentence leaves.
      // buildClusterLayout writes positions into simNodes and returns
      // the geometry; we translate the existing <g.node> elements onto
      // those positions but defer paintCluster() to the first
      // applyNetwork() call, which decides on the on-load animation.
      // (Letting the mode-swap effect drive the first paint avoids a
      // double-paint that would clobber the stroke-dashoffset tween.)
      let clusterInfo = buildClusterLayout(simNodes, W, H)
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
      // Index leaf-node id → hierarchy node so the activation engine
      // can walk .path() between any two leaves. Declared up here
      // (before any call site) because the buildLeafHIndex() function
      // declaration hoists but `const leafHById` does not — calling
      // the helper before its closure target exists would TDZ.
      const leafHById = new Map()
      buildLeafHIndex()

      // Radial link generator — d3.linkRadial() draws a smooth bezier
      // between two (angle, radius) endpoints. Default convention is
      // 0 = 12 o'clock; we offset by -π/2 so it lines up with the
      // d3.cluster().size([2π, R]) convention where x=0 is "down".
      // (Same convention used in the canonical Observable example.)
      const linkRadial = d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y)

      function paintCluster({ cx, cy, R, branches, months, allLinks, rootH, leaves }, { animate = false } = {}) {
        // ---- Branches ----
        // One <path> per hierarchy edge — both root→styleMode (depth 1)
        // and styleMode→leaf (depth 2). Color follows the deeper end's
        // style_mode so the whole sub-tree reads as one color family.
        const branchSel = branchLayer
          .attr('transform', `translate(${cx}, ${cy})`)
          .selectAll('path.branch')
          .data(allLinks, d => `${d.source.data.name}|${d.target.data.name}`)
        branchSel.exit().remove()
        const branchEnter = branchSel.enter().append('path')
          .attr('class', 'branch')
          .attr('fill', 'none')
          .attr('stroke-width', 1)
        const branchMerged = branchEnter.merge(branchSel)
          .attr('d', d => linkRadial({ source: d.source, target: d.target }))
          .attr('stroke', d => STYLE_COLOR[d.styleMode] || DEFAULT_COLOR)
          .style('opacity', 0.5)

        // ---- Inner branch nodes ----
        // One small circle per style_mode anchor — same visual weight
        // as the leaves and the root so the tree reads as edges, not
        // a hierarchy of hubs. Matches the canonical Observable form.
        const bnodeSel = branchNodeLayer
          .attr('transform', `translate(${cx}, ${cy})`)
          .selectAll('circle.branch-node')
          .data(branches, d => d.styleMode)
        bnodeSel.exit().remove()
        const bnodeEnter = bnodeSel.enter().append('circle')
          .attr('class', 'branch-node')
          .attr('r', BRANCH_R)
        const bnodesMerged = bnodeEnter.merge(bnodeSel)
          .attr('cx', d => d.x - cx)
          .attr('cy', d => d.y - cy)
          .attr('fill', d => STYLE_COLOR[d.styleMode] || DEFAULT_COLOR)
          .style('opacity', 0.8)

        // ---- Month nodes (3rd-level subdivision) ----
        // Small 4px circles for each month bucket that earned its own
        // intermediate hierarchy node. Same color as the parent
        // style_mode. Hover wires (mouseenter/leave) defined alongside
        // the branch hub circles below so all internal nodes share
        // the same tooltip routing.
        const MONTH_R = BRANCH_R
        const monthSel = branchNodeLayer
          .selectAll('circle.month-node')
          .data(months, d => `${d.styleMode}|${d.monthLabel}|${d.angle.toFixed(1)}`)
        monthSel.exit().remove()
        const monthEnter = monthSel.enter().append('circle')
          .attr('class', 'month-node')
          .attr('r', MONTH_R)
          .style('pointer-events', 'all')
          .style('cursor', 'default')
        const monthMerged = monthEnter.merge(monthSel)
          .attr('cx', d => d.x - cx)
          .attr('cy', d => d.y - cy)
          .attr('fill', d => STYLE_COLOR[d.styleMode] || DEFAULT_COLOR)
          .style('opacity', 0.8)
        // Wire month-node hover → tooltip (re-bound each paint so the
        // captured cluster geometry stays current).
        monthMerged
          .on('mouseenter', (_event, d) => {
            if (sceneRef.current?.mode !== 'network') return
            const a = tooltipAnchor(d.x, d.y)
            showTooltip(d.monthLabel, a.x, a.y, STYLE_COLOR[d.styleMode] || DEFAULT_COLOR)
          })
          .on('mouseleave', () => hideTooltip())

        // Wire branch-hub hover → tooltip (style_mode name).
        bnodesMerged
          .style('pointer-events', 'all')
          .on('mouseenter', (_event, d) => {
            if (sceneRef.current?.mode !== 'network') return
            const a = tooltipAnchor(d.x, d.y)
            showTooltip(d.styleMode, a.x, a.y, STYLE_COLOR[d.styleMode] || DEFAULT_COLOR)
          })
          .on('mouseleave', () => hideTooltip())

        // ---- On-load animation ----
        //
        // Branches draw progressively via stroke-dashoffset; inner
        // edges (depth 1) at t=0, outer (2/3) at t=200ms, both 1200ms.
        // Branch hubs + month dots fade in as their parent edge lands.
        // Leaf circles are NOT animated by paintCluster — applyNetwork
        // schedules its own r/fill/fill-opacity transition on the same
        // selection right after this returns, and competing transitions
        // would cancel each other and strand the leaves invisible.
        nodeSel.select('circle').style('opacity', null)
        if (animate) {
          bnodesMerged.style('opacity', 0)
          monthMerged.style('opacity', 0)

          branchMerged.each(function (d) {
            const len = this.getTotalLength?.() ?? 100
            const delay = d.depth === 1 ? 0 : 200
            d3.select(this)
              .attr('stroke-dasharray', `${len} ${len}`)
              .attr('stroke-dashoffset', len)
              .transition()
              .delay(delay)
              .duration(1200)
              .ease(d3.easeCubicOut)
              .attr('stroke-dashoffset', 0)
              .on('end', function () {
                d3.select(this).attr('stroke-dasharray', null)
              })
          })

          bnodesMerged.transition()
            .delay(900)
            .duration(400)
            .style('opacity', 0.8)
          monthMerged.transition()
            .delay(1100)
            .duration(400)
            .style('opacity', 0.8)
        } else {
          bnodesMerged.style('opacity', 0.8)
          monthMerged.style('opacity', 0.8)
          branchMerged.style('opacity', 0.5)
        }
      }

      // Helper — does an angle (in degrees, 0=right) fall on the left
      // half of the circle? Used to flip per-leaf labels so they always
      // read outward without appearing upside-down.
      function isLeftHalf(angleDeg) {
        const a = ((angleDeg % 360) + 360) % 360
        return a > 90 && a < 270
      }

      // ---- Tree-traveling MLT activation ----
      //
      // When a sentence activates, the highlight travels through the
      // existing tree edges from the source leaf up to the lowest
      // common ancestor with each MLT neighbor, then back down to the
      // neighbor. The tree is the medium — no chords cross the
      // canvas. Each segment is an overlay <path> in chordLayer that
      // re-traces the underlying branch using the same d3.linkRadial
      // generator the branches use, then animates with stroke-
      // dashoffset.
      //
      // For our 2-level hierarchy, paths are length 2 (same style_mode)
      // or 4 (cross style_mode). The total travel time is fixed at
      // PATH_TRAVEL_MS regardless of segment count, so cross-style
      // paths animate twice as fast per segment as same-style paths.
      //
      // One activation per ~3s; per activation, the source leaf's 5
      // MLT neighbors are fired sequentially 600ms apart. Each
      // highlight (gradient + N segment paths) is tagged with a unique
      // class so it can be cleaned up after its fade completes.

      const HIGHLIGHT_WIDTH = 2.5
      const HIGHLIGHT_OPACITY = 0.85
      const PATH_TRAVEL_MS = 1200
      const PATH_FADE_OUT_MS = 1500
      const NEIGHBOR_STAGGER_MS = 600
      const HOVER_FADE_IN_MS = 200
      const HOVER_FADE_OUT_MS = 1000
      const AUTO_INTERVAL_MS = 3000

      // Monotonic id counter for activation gradients/classes — used
      // to dedupe DOM elements so overlapping activations never collide.
      let actSeq = 0

      // (leafHById is declared above the first buildLeafHIndex() call
      // — see ~line 482 — to avoid a temporal dead zone error.
      // buildLeafHIndex is hoisted as a function declaration but the
      // const binding it closes over is not.)
      function buildLeafHIndex() {
        leafHById.clear()
        for (const l of clusterInfo.leaves) leafHById.set(l.node.id, l.hNode)
      }

      // Walk the tree path from src leaf to tgt leaf. d3.hierarchy's
      // .path(target) walks up to the lowest common ancestor then back
      // down. Returns an array of [parent, child] pairs corresponding
      // to the existing branch edges. Pair direction matches the
      // renderer's (source=parent, target=child) convention so we can
      // feed linkRadial the same way the branches do.
      function treePathSegments(srcLeafId, tgtLeafId) {
        const a = leafHById.get(srcLeafId)
        const b = leafHById.get(tgtLeafId)
        if (!a || !b) return []
        const nodes = a.path(b) // [a, ..., lca, ..., b]
        const segs = []
        for (let i = 0; i < nodes.length - 1; i++) {
          const x = nodes[i]
          const y = nodes[i + 1]
          // Identify which is the parent (the one with shallower depth).
          const parent = x.depth < y.depth ? x : y
          const child = x.depth < y.depth ? y : x
          // Direction along the highlight travel: src → tgt. Mark
          // whether this segment traces forward (parent→child along
          // the underlying edge) or backward (child→parent).
          const reversed = (x === child)
          segs.push({ parent, child, reversed })
        }
        return segs
      }

      // Animate one MLT path: src leaf → tgt leaf via the tree.
      // Appends a <linearGradient> + N segment paths to chordLayer,
      // tweens them sequentially, then schedules a fade-out + cleanup.
      // The `slot` class lets a whole activation be wiped on mode
      // transitions or before a fresh hover replaces it.
      function animateTreePath(srcLeafId, tgtLeafId, slot, startDelay) {
        const segs = treePathSegments(srcLeafId, tgtLeafId)
        if (!segs.length) return
        const src = nodeById.get(srcLeafId)
        const tgt = nodeById.get(tgtLeafId)
        if (!src || !tgt) return

        const sColor = STYLE_COLOR[src.style_mode] || DEFAULT_COLOR
        const tColor = STYLE_COLOR[tgt.style_mode] || DEFAULT_COLOR
        const id = actSeq++
        const gradId = `act-grad-${slot}-${id}`
        const segClass = `act-seg-${slot}-${id}`

        // One gradient per activation, anchored to the leaf endpoints
        // in user space so the color reads as src→tgt across every
        // segment regardless of the segment's own orientation.
        const grad = defs.append('linearGradient')
          .attr('class', `act-grad act-grad-${slot}`)
          .attr('id', gradId)
          .attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', src.x).attr('y1', src.y)
          .attr('x2', tgt.x).attr('y2', tgt.y)
        grad.append('stop').attr('offset', '0%').attr('stop-color', sColor)
        grad.append('stop').attr('offset', '100%').attr('stop-color', tColor)

        const perSegMs = PATH_TRAVEL_MS / segs.length

        // Build all segments first so we can read getTotalLength on
        // each before scheduling.
        const segNodes = segs.map(({ parent, child, reversed }) => {
          // Re-trace the branch with the same linkRadial used by the
          // tree, so the overlay aligns pixel-perfect.
          const d = linkRadial({ source: parent, target: child })
          // chordLayer is translated to (cx, cy) — wait, it isn't.
          // branchLayer is. Let me use a transform to match.
          const node = chordLayer.append('path')
            .attr('class', `activation ${segClass} act-${slot}`)
            .attr('transform', `translate(${clusterInfo.cx}, ${clusterInfo.cy})`)
            .attr('d', d)
            .attr('fill', 'none')
            .attr('stroke', `url(#${gradId})`)
            .attr('stroke-width', HIGHLIGHT_WIDTH)
            .attr('stroke-opacity', HIGHLIGHT_OPACITY)
            .node()
          const len = node.getTotalLength?.() ?? 100
          d3.select(node)
            .attr('stroke-dasharray', `${len} ${len}`)
            .attr('stroke-dashoffset', reversed ? -len : len)
          return { node, len, reversed }
        })

        // Sequentially tween dashoffset to 0 — segment N starts when
        // segment N-1 finishes. Then schedule the whole highlight to
        // fade after the last segment lands.
        segNodes.forEach((s, i) => {
          d3.select(s.node)
            .transition()
            .delay(startDelay + i * perSegMs)
            .duration(perSegMs)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0)
        })

        const totalDraw = startDelay + PATH_TRAVEL_MS
        d3.timeout(() => {
          d3.selectAll(segNodes.map(s => s.node))
            .interrupt()
            .transition()
            .duration(PATH_FADE_OUT_MS)
            .ease(d3.easeCubicIn)
            .attr('stroke-opacity', 0)
            .remove()
          d3.timeout(() => grad.remove(), PATH_FADE_OUT_MS + 50)
        }, totalDraw)
      }

      // Activate one source leaf — fires its 5 MLT neighbors
      // sequentially staggered by NEIGHBOR_STAGGER_MS.
      function activateNode(nodeId, slot) {
        const neighbors = (graph[nodeId] || []).map(n => n.id).filter(Boolean)
        neighbors.forEach((tgtId, i) => {
          animateTreePath(nodeId, tgtId, slot, i * NEIGHBOR_STAGGER_MS)
        })
      }

      // Fade out + remove every active highlight in a slot. Used on
      // mouseleave (hover slot) and on mode transitions (both slots).
      function extinguishSlot(slot, fadeMs) {
        const segs = chordLayer.selectAll(`path.act-${slot}`)
        const grads = defs.selectAll(`linearGradient.act-grad-${slot}`)
        segs.interrupt()
          .transition()
          .duration(fadeMs)
          .ease(d3.easeCubicIn)
          .attr('stroke-opacity', 0)
          .remove()
        d3.timeout(() => grads.remove(), fadeMs + 50)
      }

      function clearAllChords() {
        chordLayer.selectAll('path.activation').interrupt().remove()
        defs.selectAll('linearGradient.act-grad').remove()
      }

      // ---- Autonomous engine ----
      let autoIntervalId = null
      const isHoveringRef = { hovering: false }

      function autoTick() {
        if (isHoveringRef.hovering) return
        if (sceneRef.current?.mode !== 'network') return
        const i = Math.floor(Math.random() * simNodes.length)
        activateNode(simNodes[i].id, 'auto')
      }

      function startAutoEngine() {
        if (autoIntervalId !== null) return
        autoIntervalId = setInterval(autoTick, AUTO_INTERVAL_MS)
      }

      function stopAutoEngine() {
        if (autoIntervalId !== null) {
          clearInterval(autoIntervalId)
          autoIntervalId = null
        }
      }

      // Zoom/pan stays available on beeswarm + radial; corpus (network)
      // mode has a fixed composition per painting reference, so the
      // filter rejects all events while mode === 'network'. Node-class
      // events are always excluded so click/drag on a circle never
      // initiates a pan.
      const zoom = d3.zoom()
        .scaleExtent([0.2, 8])
        .filter(event => {
          if (sceneRef.current?.mode === 'network') return false
          return !event.target.closest('.node')
        })
        .on('zoom', event => root.attr('transform', event.transform))
      svg.call(zoom)

      const handleResize = () => {
        // Resize listener can outlive the scene if a previous render
        // crashed before sceneRef was assigned (e.g. HMR after a
        // ReferenceError). Bail out instead of throwing.
        if (!sceneRef.current) return
        const w = wrapperRef.current?.clientWidth || window.innerWidth
        const h = wrapperRef.current?.clientHeight || window.innerHeight
        svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`)
        bgRect.attr('width', w).attr('height', h)
        sceneRef.current.W = w
        sceneRef.current.H = h
        if (sceneRef.current.mode === 'network') {
          // Rebuild the cluster against the new viewport. No animation
          // on resize — geometry changes shouldn't replay the on-load
          // draw. Any in-flight chord activations are killed because
          // their endpoints would otherwise be anchored to stale
          // positions; the engine will fire a fresh activation soon.
          clearAllChords()
          clusterInfo = buildClusterLayout(simNodes, w, h)
          buildLeafHIndex()
          paintCluster(clusterInfo, { animate: false })
          sceneRef.current.clusterInfo = clusterInfo
          nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
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
        bgRect, branchLayer, chordLayer, branchNodeLayer, wedgeLayer, barLayer,
        simNodes, nodeById, links, adjacency, W, H, mode: 'network',
        clusterInfo,
        // Set true after the first applyNetwork() to gate the on-load
        // animation — we want the entrance only on first paint, not on
        // every return to corpus mode.
        hasInitialPainted: false,
        clearNodeFocus,
        dateHue, applyNetwork, applyBeeswarm, applyRadial, onSelectRef,
        cleanup: () => {
          window.removeEventListener('resize', handleResize)
          stopAutoEngine()
          clearAllChords()
          simulation.stop()
        },
      }

      // Trigger prop-sync effects now that the scene is real.
      setSceneReady(n => n + 1)

      // ====== mode appliers ======

      // Hard-reset every per-node <text class="label"> back to its initial
      // appearance: hidden, full sentence text, monospace at 11px, dy
      // aligned just above the leaf circle. Called at the top of every
      // mode-apply so residue from radial (per-style typography, "first
      // 6 words" text, 14px) or hover (opacity 1) doesn't bleed into
      // the next mode. interrupt() cuts in-flight transitions so the
      // reset wins.
      function resetLabelsToDefault() {
        nodeSel.select('text.label')
          .interrupt()
          .style('opacity', 0)
          .style('font-family', 'monospace')
          .style('font-style', 'normal')
          .attr('font-size', 11)
          .attr('dy', '0.32em')
          .attr('text-anchor', d => isLeftHalf(d.angle) ? 'end' : 'start')
          .attr('x', d => isLeftHalf(d.angle) ? -8 : 8)
          .attr('transform', d => {
            const a = d.angle ?? 0
            return `rotate(${a})` + (isLeftHalf(a) ? ' rotate(180)' : '')
          })
          .text(d => firstWords(d.sentence, 8))
      }

      function applyNetwork() {
        sceneRef.current.mode = 'network'
        sceneRef.current.lastRadial = null

        // Reset any pan/zoom the user applied during beeswarm/radial so
        // the corpus composition returns to its fixed framing.
        svg.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .call(zoom.transform, d3.zoomIdentity)

        // Full label reset — see resetLabelsToDefault doc. Also
        // clear hover state so a stale hover from a prior mode
        // doesn't prevent the autonomous engine from firing.
        resetLabelsToDefault()
        clearNodeFocus()
        isHoveringRef.hovering = false

        // Rebuild the cluster against the current viewport — beeswarm/
        // radial overwrite n.x/y/fx/fy with their own targets, so reset
        // from the deterministic cluster layout. Also restore per-node
        // length-scaled radius. paintCluster renders branches, branch
        // nodes, and group labels and runs the on-load animation on
        // first paint only.
        const { W: w, H: h } = sceneRef.current
        const isFirstPaint = !sceneRef.current.hasInitialPainted

        // No labels → no bbox-fit loop. Build the cluster at the
        // spec'd 0.42 * min(W, H-48) radius and paint once.
        clusterInfo = buildClusterLayout(simNodes, w, h)
        buildLeafHIndex()
        simNodes.forEach(d => { d.r = LEAF_R })
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
        paintCluster(clusterInfo, { animate: isFirstPaint })
        sceneRef.current.clusterInfo = clusterInfo
        sceneRef.current.hasInitialPainted = true

        // Stop the sim — corpus mode reads frozen cluster positions.
        simulation.alpha(0).stop()

        // Restore corpus visuals: warm ground, per-node varied fill,
        // corpus-mode opacity, dark labels (against the light ground),
        // cluster + chord layers visible. Beeswarm-only layers fade out.
        bgRect.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('fill', CANVAS_BG_GROUND)
        // paintCluster already manages leaf opacity on first paint via
        // its animation. On non-first paints (return from beeswarm/
        // radial) it set leaves to opacity 1 directly — but the fill
        // still needs to refresh.
        nodeSel.select('circle')
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('r', d => d.r)
          .attr('fill', d => nodeColor(d, palette))
          .attr('fill-opacity', NODE_OPACITY_CORPUS)
        nodeSel.select('text.label').attr('fill', '#1a1a1a')
        // Re-show leaves: beeswarm/radial both faded nodeSel to
        // opacity 0; without an explicit opacity:1 here the cluster
        // tree's outer-ring leaves stay invisible after a
        // search-then-clear or a radial-then-escape.
        nodeSel
          .transition().duration(400).ease(d3.easeCubicInOut)
          .style('opacity', 1)
          .style('pointer-events', 'auto')
        branchLayer.transition().duration(TRANSITION_MS).style('opacity', 1)
        branchNodeLayer.transition().duration(TRANSITION_MS).style('opacity', 1)
        chordLayer.style('opacity', 1)
        // Fade out the Step III wedge layer + clear it once gone so
        // wedge paths don't shadow click events on the cluster. Also
        // hide the wedge/bar HTML tooltip in case the user was
        // hovering one at the moment the mode closed.
        wedgeLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
          .on('end', () => wedgeLayer.selectAll('*').remove())
        // Bars: opacity 0 over 300ms, then clear the layer. No
        // width-tween — keeping the change to a single property keeps
        // d3 from cancelling overlapping transitions.
        barLayer.transition().duration(300).ease(d3.easeCubicIn)
          .style('opacity', 0)
          .on('end', () => barLayer.selectAll('*').remove())
        if (tooltipDivRef.current) tooltipDivRef.current.style.opacity = '0'
        axisLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
        arcLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
        // Start the autonomous chord-reveal engine. Hover always
        // pauses it via isHoveringRef.
        clearAllChords()
        startAutoEngine()
      }

      // Per-bar lightness variation — same idiom as the Step III
      // wedge fills so adjacent same-style_mode bars are distinct.
      function variedBarColor(baseHsl, idx) {
        const m = baseHsl.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/)
        if (!m) return baseHsl
        const h = Number(m[1]), s = Number(m[2]), l = Number(m[3])
        const delta = (idx % 2 === 0 ? 1 : -1) * 5
        const newL = Math.max(15, Math.min(85, l + delta))
        return `hsl(${h}, ${s}%, ${newL}%)`
      }

      function applyBeeswarm() {
        const prevMode = sceneRef.current.mode
        sceneRef.current.mode = 'beeswarm'

        clearNodeFocus()
        stopAutoEngine()
        clearAllChords()
        isHoveringRef.hovering = false

        // Full label reset — see resetLabelsToDefault doc.
        resetLabelsToDefault()
        // Hide every other mode's geometry.
        arcLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        branchLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        chordLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        branchNodeLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        wedgeLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
          .on('end', () => wedgeLayer.selectAll('*').remove())
        if (tooltipDivRef.current) tooltipDivRef.current.style.opacity = '0'
        hideTooltip()
        // Hide the corpus leaves entirely — bars own the canvas.
        simNodes.forEach(d => { d.fx = d.x; d.fy = d.y })
        nodeSel
          .transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
          .style('pointer-events', 'none')
        axisLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        // Warm off-white ground — consistent with corpus.
        bgRect.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('fill', CANVAS_BG_GROUND)

        const hitsArr = (sceneRef.current.hits || []).slice(0, 12)
        const { W: w } = sceneRef.current
        const BAR_LEFT = 60
        const BAR_GAP = 8
        const BAR_HEIGHT = 52
        const BAR_TOP = 80 // below the search input
        const MAX_BAR_WIDTH = w * 0.8
        const topScore = hitsArr.length ? hitsArr[0].score : 1

        // Build bar data (already score-desc from the API).
        const bars = hitsArr.map((hit, i) => ({
          id: hit.id,
          rank: i + 1,
          score: hit.score,
          width: Math.max(8, (hit.score / topScore) * MAX_BAR_WIDTH),
          y: BAR_TOP + i * (BAR_HEIGHT + BAR_GAP),
          sentence: hit.sentence ?? nodeById.get(hit.id)?.sentence ?? '',
          date: hit.date ?? nodeById.get(hit.id)?.date ?? '',
          style_mode: hit.style_mode ?? nodeById.get(hit.id)?.style_mode ?? '',
        }))

        // Each bar is a <g class="bar"> with rect + 3 texts (rank,
        // sentence, date). Keyed by hit id.
        barLayer.style('opacity', 1)
        const barSel = barLayer.selectAll('g.bar').data(bars, d => d.id)
        barSel.exit()
          .transition().duration(400).ease(d3.easeCubicIn)
          .style('opacity', 0)
          .remove()
        const barEnter = barSel.enter().append('g')
          .attr('class', 'bar')
          .style('cursor', 'pointer')
        // Invisible hit-area rect — sits behind the visible fill,
        // 4px taller above and below for forgiving hover. Owns the
        // pointer-events for the whole bar so clicks/hovers register
        // even on the rank/date text or in the gap above/below.
        barEnter.append('rect').attr('class', 'bar-hit')
          .attr('x', 0)
          .attr('height', BAR_HEIGHT + 8)
          .attr('fill', 'transparent')
          .style('pointer-events', 'all')
        barEnter.append('text').attr('class', 'rank')
          .attr('x', BAR_LEFT - 12)
          .attr('text-anchor', 'end')
          .attr('font-family', 'monospace')
          .attr('font-size', 11)
          .style('pointer-events', 'none')
        barEnter.append('rect').attr('class', 'bar-fill')
          .attr('x', BAR_LEFT)
          .attr('height', BAR_HEIGHT)
          .attr('rx', 2)
          .attr('width', 0)
          .style('pointer-events', 'none')
        barEnter.append('text').attr('class', 'sentence')
          .attr('x', BAR_LEFT + 16)
          .attr('font-family', 'monospace')
          .attr('font-size', 13)
          .attr('fill', '#ffffff')
          .style('pointer-events', 'none')
        barEnter.append('text').attr('class', 'date')
          .attr('text-anchor', 'end')
          .attr('font-family', 'monospace')
          .attr('font-size', 10)
          .style('pointer-events', 'none')

        const merged = barEnter.merge(barSel)
        merged
          .on('mouseenter', function (_event, d) {
            d3.select(this).select('rect.bar-fill')
              .interrupt()
              .transition().duration(120).ease(d3.easeCubicOut)
              .attr('fill', variedBarColor(STYLE_COLOR[d.style_mode] || DEFAULT_COLOR, d.rank - 1 + (d.rank % 2 ? 0 : 1)))
          })
          .on('mouseleave', function (_event, d) {
            d3.select(this).select('rect.bar-fill')
              .interrupt()
              .transition().duration(180).ease(d3.easeCubicInOut)
              .attr('fill', variedBarColor(STYLE_COLOR[d.style_mode] || DEFAULT_COLOR, d.rank - 1))
          })
          .on('click', function (event, d) {
            event.stopPropagation()
            if (typeof onSelectRef.current === 'function') {
              onSelectRef.current(d.id)
            }
          })

        // Position rows + tween bar widths.
        merged.select('text.rank')
          .attr('y', d => d.y + BAR_HEIGHT / 2 + 4)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
          .text(d => d.rank)

        // Hit-area rect: spans the rank text on the left through the
        // end of the visible bar on the right, plus 4px above/below.
        merged.select('rect.bar-hit')
          .attr('y', d => d.y - 4)
          .attr('width', d => BAR_LEFT + d.width)

        merged.select('rect.bar-fill')
          .attr('y', d => d.y)
          .attr('fill', d => variedBarColor(STYLE_COLOR[d.style_mode] || DEFAULT_COLOR, d.rank - 1))
          .transition().duration(prevMode === 'beeswarm' ? 250 : 500)
          .ease(d3.easeCubicOut)
          .attr('width', d => d.width)

        // Truncate sentence text to fit the bar's pixel width.
        merged.select('text.sentence')
          .attr('y', d => d.y + BAR_HEIGHT / 2 + 4)
          .each(function (d) {
            const txt = d3.select(this)
            // Approximate truncation: monospace 13px ≈ 7.8px per char.
            // Bar minus left padding minus right padding (date + buffer).
            const usable = Math.max(0, d.width - 16 - 110)
            const maxChars = Math.max(0, Math.floor(usable / 7.8))
            const t = d.sentence.length > maxChars
              ? d.sentence.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…'
              : d.sentence
            txt.text(t)
          })

        merged.select('text.date')
          .attr('y', d => d.y + BAR_HEIGHT / 2 + 4)
          .attr('x', d => BAR_LEFT + d.width - 12)
          .attr('fill', d => STYLE_COLOR[d.style_mode] || DEFAULT_COLOR)
          .style('opacity', 0.6)
          .text(d => {
            try {
              const dt = new Date(d.date)
              return d3.timeFormat('%b %d')(dt)
            } catch { return '' }
          })

        // Park the simulation — bars are static, no forces.
        simulation
          .force('link', null)
          .force('charge', null)
          .force('center', null)
          .force('x', null)
          .force('y', null)
          .force('collide', null)
          .alpha(0).stop()
      }

      // d3.arc generator — radii are viewport-responsive; per-wedge
      // baseOuter is read from datum (computed in applyRadial against
      // the current viewport), hover bumps it +WEDGE_HOVER_LIFT.
      const wedgeArc = d3.arc()
        .innerRadius(WEDGE_INNER_R)
        .outerRadius(d => d.data.baseOuter + (d.data.hovered ? WEDGE_HOVER_LIFT : 0))
        .padAngle(WEDGE_PAD_ANGLE)
        .cornerRadius(0)

      // d3.pie sorts by score descending and angles each segment by
      // score share. sort(null) preserves the input order so wedges
      // appear in the same sequence the MLT API returned (ranked).
      const wedgePie = d3.pie()
        .sort(null)
        .value(d => Math.max(0.001, d.score))
        .padAngle(WEDGE_PAD_ANGLE)

      function applyRadial(centerId, mltHits) {
        const prevMode = sceneRef.current.mode
        sceneRef.current.mode = 'radial'
        sceneRef.current.lastRadial = { centerId, mltHits }

        const center = nodeById.get(centerId)
        if (!center) return

        clearNodeFocus()
        stopAutoEngine()
        clearAllChords()
        isHoveringRef.hovering = false
        hideTooltip()

        // Hide cluster + chord + bar layers — radial owns the canvas.
        branchLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        chordLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        branchNodeLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        barLayer.transition().duration(TRANSITION_MS / 2)
          .style('opacity', 0)
          .on('end', () => barLayer.selectAll('*').remove())

        // Swap ground to deep. Hide every leaf circle — wedges and the
        // page-level center sentence overlay carry the entire scene.
        bgRect.transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attr('fill', CANVAS_BG_DEEP)
        nodeSel
          .transition().duration(TRANSITION_MS / 2).ease(d3.easeCubicInOut)
          .style('opacity', 0)
          .style('pointer-events', 'none')

        // Hide axis (beeswarm leftover).
        axisLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)
        // Hide the old line-arc layer (legacy from pre-Step-III radial).
        arcLayer.transition().duration(TRANSITION_MS / 2).style('opacity', 0)

        // Position wedge layer at canvas center.
        const { W: w, H: h } = sceneRef.current
        const cx = w / 2
        const cy = (h - 48) / 2
        wedgeLayer.attr('transform', `translate(${cx}, ${cy})`)

        // Viewport-responsive radii. The outer ring fills ~75% of the
        // shorter viewport dimension; the inner ring sits at ~72% of
        // the outer so the two-tone depth reads. innerRadius is fixed
        // (matches the 240px center-text overlay).
        const halfMin = Math.min(w, h - 48) / 2
        const outerOuter = Math.max(180, halfMin * 0.75)
        const innerOuter = outerOuter * 0.72

        // ±10% lightness variation per wedge: even index lighter,
        // odd index darker. Same hue family so within-style_mode
        // monochrome groups still read as distinct segments.
        function variedColor(baseHsl, idx) {
          const m = baseHsl.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/)
          if (!m) return baseHsl
          const h = Number(m[1]), s = Number(m[2]), l = Number(m[3])
          const delta = (idx % 2 === 0 ? 1 : -1) * 10
          const newL = Math.max(15, Math.min(85, l + delta))
          return `hsl(${h}, ${s}%, ${newL}%)`
        }

        // Build wedge data — top 7 MLT neighbors that exist in our
        // corpus. rank carries the inner/outer ring assignment;
        // baseOuter is the wedge's resting outer radius (read by the
        // arc generator); fillOpacity drops to 0.7 on the outer ring
        // for the two-tone depth.
        const top7 = (mltHits || []).slice(0, 7).filter(h => nodeById.has(h.id))
        const wedgeData = top7.map((hit, i) => {
          const neighbor = nodeById.get(hit.id)
          const baseColor = STYLE_COLOR[neighbor.style_mode] || DEFAULT_COLOR
          return {
            id: hit.id,
            rank: i,
            score: hit.score,
            sentence: neighbor.sentence,
            style_mode: neighbor.style_mode,
            color: variedColor(baseColor, i),
            baseOuter: i < 3 ? innerOuter : outerOuter,
            fillOpacity: i < 3 ? 1 : 0.7,
            hovered: false,
          }
        })

        const arcs = wedgePie(wedgeData)

        // Wedge paths — keyed by neighbor id so re-applying with a new
        // center doesn't blow away unaffected DOM.
        const wedgeSel = wedgeLayer
          .selectAll('path.wedge')
          .data(arcs, d => d.data.id)
        wedgeSel.exit().remove()
        const wedgeEnter = wedgeSel.enter().append('path')
          .attr('class', 'wedge')
          .attr('stroke', 'none')
          .style('cursor', 'pointer')
          .style('pointer-events', 'all')
        const wedgeMerged = wedgeEnter.merge(wedgeSel)
          .attr('fill', d => d.data.color)
          .attr('fill-opacity', d => d.data.fillOpacity)
        // Tween between previous d (if any) and the new one for smooth
        // arc transitions when click → new center re-fires applyRadial.
        wedgeMerged
          .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
          .attrTween('d', function (d) {
            const prev = this._prev || { startAngle: d.startAngle, endAngle: d.startAngle, padAngle: d.padAngle, data: d.data }
            const interp = d3.interpolate(prev, d)
            this._prev = d
            return t => wedgeArc(interp(t))
          })

        // Hover handlers — bump outer radius +20 and show neighbor
        // sentence at the wedge midpoint. mouseleave restores.
        wedgeMerged
          .on('mouseenter', function (_event, d) {
            d.data.hovered = true
            d3.select(this).interrupt()
              .transition().duration(160).ease(d3.easeCubicOut)
              .attrTween('d', function (dd) {
                const prev = this._prev || dd
                const interp = d3.interpolate(prev, dd)
                this._prev = dd
                return t => wedgeArc(interp(t))
              })
            showWedgeLabel(d)
          })
          .on('mouseleave', function (_event, d) {
            d.data.hovered = false
            d3.select(this).interrupt()
              .transition().duration(180).ease(d3.easeCubicInOut)
              .attrTween('d', function (dd) {
                const prev = this._prev || dd
                const interp = d3.interpolate(prev, dd)
                this._prev = dd
                return t => wedgeArc(interp(t))
              })
            hideWedgeLabel()
          })
          .on('click', function (event, d) {
            event.stopPropagation()
            if (typeof onSelectRef.current === 'function') {
              onSelectRef.current(d.data.id)
            }
          })

        // Wedge hover tooltip — HTML overlay populated imperatively
        // (top-left below the search input). Same idiom as the word
        // view's hover label. The previous SVG arc-following label
        // is gone; a single fixed-position tooltip is much easier to
        // read and never collides with other wedges.
        function showWedgeLabel(d) {
          const div = tooltipDivRef.current
          if (!div) return
          div.innerHTML = ''
          const sentenceLine = document.createElement('div')
          sentenceLine.textContent = firstWords(d.data.sentence, 8)
          const styleLine = document.createElement('div')
          styleLine.textContent = d.data.style_mode
          styleLine.style.opacity = '0.55'
          styleLine.style.marginTop = '2px'
          div.appendChild(sentenceLine)
          div.appendChild(styleLine)
          div.style.opacity = '1'
        }
        function hideWedgeLabel() {
          const div = tooltipDivRef.current
          if (!div) return
          div.style.opacity = '0'
        }

        // Reveal the wedge layer (no-op if already visible from prior
        // applyRadial). On entry from corpus, fade in.
        if (prevMode !== 'radial') {
          wedgeLayer.style('opacity', 0)
            .transition().duration(TRANSITION_MS).ease(d3.easeCubicInOut)
            .style('opacity', 1)
        } else {
          wedgeLayer.style('opacity', 1)
        }

        // Park the simulation — radial mode reads frozen pinned
        // positions but doesn't need any forces.
        simNodes.forEach(d => { d.fx = d.x; d.fy = d.y })
        simulation
          .force('link', null)
          .force('charge', null)
          .force('center', null)
          .force('x', null)
          .force('y', null)
          .force('collide', null)
          .alpha(0).stop()
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

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'fixed', inset: 0, background: CANVAS_BG_GROUND, overflow: 'hidden' }}
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
      {/* Wedge hover tooltip — Scale 2 only. Imperatively populated
          by SculptureCanvas wedge mouseenter/leave (see applyRadial).
          Sits in top-left below the search input; same idiom as the
          word view's hover label. */}
      <div
        ref={tooltipDivRef}
        style={{
          position: 'fixed',
          top: 56, left: 16,
          maxWidth: 360,
          padding: '4px 0',
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#fff',
          lineHeight: 1.45,
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 120ms ease-out',
          zIndex: 20,
        }}
      />
    </div>
  )
}
