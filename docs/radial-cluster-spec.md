# Corpus View — Radial Cluster with Chord Activation Spec

Replaces the force simulation layout with a radial arrangement. Sentences
sit on the circumference of a circle, grouped by style_mode. MLT connections
animate as curved chord paths through the interior. The composition is fixed,
intentional, and legible as a diagram of the corpus's semantic structure.

Visual reference: D3 radial cluster + Adam Shaw's circle paintings.
The circle is the corpus. The chords are memory.

---

## Concept

Sentences are arranged around a circle, grouped by style_mode. Adjacent
groups share arcs of the circumference. When a sentence activates, curved
bezier paths draw from it to its MLT neighbors — crossing through the
interior like resonance chords on a guitar. The animation reveals which
sentences are semantically close regardless of where they sit on the ring.

Two things are immediately visible:
1. **How the corpus is structured** — which style_modes have more sentences,
   how groups cluster together on the ring
2. **What the corpus knows about itself** — which sentences echo each other,
   visualized as chords that light up and fade

---

## Layout

### Circle geometry
```
Center:       canvas center (W/2, (H-48)/2)
Radius:       min(W, H-48) * 0.38  — leaves room for node circles + labels
Node spacing: evenly distributed within each style_mode arc
Gap between style_mode groups: 8° of arc (visual separation between groups)
```

### Node placement
Sentences arranged clockwise around the circle:
1. Sort style_modes by sentence count descending (largest group first)
2. Within each style_mode, sort sentences by date ascending
3. Distribute evenly within the group's arc, accounting for the 8° gap

```javascript
function placeNodes(nodes, W, H) {
  const cx = W / 2
  const cy = (H - 48) / 2
  const R = Math.min(W, H - 48) * 0.38
  const GAP_DEGREES = 8
  const totalGapDegrees = styleGroups.length * GAP_DEGREES
  const availableDegrees = 360 - totalGapDegrees

  // Assign arc degrees per group proportional to sentence count
  let currentAngle = -90  // start at top
  styleGroups.forEach(group => {
    const groupDegrees = (group.nodes.length / totalNodes) * availableDegrees
    const anglePerNode = groupDegrees / group.nodes.length
    group.nodes.forEach((node, i) => {
      const angle = currentAngle + (i + 0.5) * anglePerNode
      const rad = angle * Math.PI / 180
      node.x = cx + Math.cos(rad) * R
      node.y = cy + Math.sin(rad) * R
      node.angle = angle  // store for chord path calculation
      node.fx = node.x
      node.fy = node.y
    })
    currentAngle += groupDegrees + GAP_DEGREES
  })
}
```

---

## Node Rendering

Same as current spec:
- **Size**: radius 8–40px scaled by sentence character count
- **Color**: per-node variation (±15° hue, ±8% lightness from neon_id seed)
- **Opacity**: 0.85
- **Background**: warm off-white (#f5f2ed)
- **No overlap** between nodes — they sit on the ring with spacing

---

## Style_mode Arc Labels

Small labels outside the ring identifying each group:
- Text: style_mode name (e.g. "LIMINAL", "SENSORY/TEXTURAL")
- Position: midpoint of each group's arc, just outside the node radius
- Font: 10px monospace, style_mode color, low opacity (0.5)
- Rotation: tangent to the circle at that point

---

## Autonomous Activation Engine

### Chord paths (replaces straight lines)
When a sentence activates, curved bezier paths draw from it to each MLT
neighbor. Paths curve through the interior of the circle — not straight
lines.

```javascript
function chordPath(source, target, cx, cy) {
  // Quadratic bezier curving toward center
  // Control point pulled 40% toward circle center
  const cpx = cx + (source.x + target.x - 2 * cx) * 0.15
  const cpy = cy + (source.y + target.y - 2 * cy) * 0.15
  return `M${source.x},${source.y} Q${cpx},${cpy} ${target.x},${target.y}`
}
```

The control point pulls toward center, creating a gentle curve through
the interior. MLT connections between nearby nodes curve slightly;
connections between opposite sides of the circle arc dramatically.

### Timing (unchanged)
```
Activation interval:  1200ms
Draw phase:           800ms
Hold phase:           1000ms
Fade phase:           1500ms
```

### Line rendering
```
stroke-width:         1.5px
max opacity:          0.7
color:                activating node's style_mode base color
fill:                 none
animation:            stroke-dasharray/stroke-dashoffset (path length)
```

Getting path length for dasharray: `path.getTotalLength()`

---

## Center of Circle

The interior of the circle is empty space where chords cross.
Optionally: render a very faint circle outline at radius R to
help the eye read the composition as a ring.

```
Circle outline: stroke #ccc8c0, stroke-width 0.5px, opacity 0.3, no fill
```

---

## Hover Behavior

- **Mouseover node**: activate that node (draw its chord paths immediately),
  pause autonomous timer, show label (sentence first 6 words, small dark
  monospace, positioned outside the ring near the node, following the
  circle's tangent)
- **Mouseleave**: label disappears, timer resumes

---

## Mode Transitions

### Corpus → Beeswarm
1. Stop engine, clear chord paths
2. Background transitions #f5f2ed → #000 (300ms)
3. Nodes animate from ring positions to beeswarm (date/score) positions
4. Circle outline fades out

### Beeswarm → Corpus
1. Nodes animate back to ring positions
2. Background transitions #000 → #f5f2ed
3. Circle outline fades in
4. Engine restarts after 1s

### Corpus → Radial (click node)
1. Stop engine, clear chords
2. Background #f5f2ed → #000
3. Selected node expands into radial view center

---

## Session Variation

- **Palette**: 4 palettes rotate per session (unchanged)
- **Per-node color**: deterministic from neon_id (unchanged)
- **Layout**: fixed — same positions every load (deterministic from
  sorted node order, not randomized)

The composition is stable. What varies is the palette and the
autonomous animation sequence.

---

## What Changes from Current

| Component | Current | New |
|-----------|---------|-----|
| Node layout | Force simulation | Fixed radial ring |
| Connection paths | Straight SVG lines | Curved bezier chords |
| Background transition | Instant | 300ms fade |
| Zoom/pan | Removed | Still removed |
| Node size | 8–48px | 8–40px (ring spacing) |
| Node overlap | Allowed (0.4 collide) | Not needed (ring spacing) |

---

## Files

- `components/SculptureCanvas.jsx` — replace force sim + placeNodes with
  radial layout; replace line drawing with chord path drawing; add circle
  outline; add arc labels
- `lib/palette.mjs` — unchanged
- No data file changes

---

## Build Order

1. Implement radial layout (placeNodes, replace force sim)
2. Visual review — ring composition, arc labels, circle outline
3. Implement chord paths (replace straight lines)
4. Visual review — chord animation
5. Implement mode transitions (background fade)
6. Visual review — beeswarm/radial transitions
7. Commit once all three steps approved

---

## Verification

- [ ] All 48 nodes visible on the ring
- [ ] Style_mode groups clearly separated by 8° gaps
- [ ] Arc labels readable, correctly positioned outside ring
- [ ] Faint circle outline visible
- [ ] Chord paths curve through interior — connections between
      opposite sides arc dramatically, nearby connections arc gently
- [ ] Chord animation: progressive draw via stroke-dashoffset
- [ ] Multiple overlapping chord sets visible at any moment
- [ ] Hover: chord paths draw immediately, label appears outside ring
- [ ] Background transitions smoothly to black on beeswarm/radial entry
- [ ] Background transitions back to off-white on corpus return
- [ ] Palette rotation still working
- [ ] Tests still passing

---

## Do Not

- Do not use force simulation for node placement
- Do not use straight lines for connections — curved bezier chords only
- Do not allow nodes to overlap (ring spacing handles this)
- Do not randomize node order per session — stable composition only
- Do not change the API layer or data files
- Do not break passing tests