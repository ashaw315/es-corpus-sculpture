# ES Corpus Sculpture — Visual Redesign Spec (Kuo Treatment)

Inspired by Andrew Kuo's practice of treating data visualization infrastructure
as the aesthetic object itself — pie segments, voronoi cells, chord ribbons,
hard color edges, and the legend strip as compositional elements, not UI chrome.

This spec covers visual redesign only. All backend, API routes, and data are
unchanged. The four-scale navigation model is unchanged. Only the rendering
layer is replaced.

---

## Core Principles

1. **Chart geometry IS the painting** — filled shapes, not strokes. Wedges not
   lines. Cells not circles. The D3 layout primitive becomes the visual form.

2. **Hard edges** — no gradients, no blur, no shadows. Flat saturated fills.
   Edges between shapes are the drawing.

3. **The legend strip** — a persistent white/off-white band at the bottom of
   every view. Color swatches + labels for style_mode. Title of the current
   view. Always present. Non-negotiable.

4. **Saturated palette** — push style_mode colors toward Kuo's intensity.
   Current HSL values are good but slightly muted. Bump saturation.

5. **Black background stays** — Kuo uses linen/kraft. We keep black. The
   contrast with the legend strip is its own formal move.

---

## Updated Color Palette

Push saturation across all style_modes:

```
LIMINAL:              hsl(220, 85%, 65%)   vivid blue
SENSORY/TEXTURAL:     hsl(145, 80%, 50%)   vivid green
ABSTRACT:             hsl(35, 95%, 58%)    vivid amber/orange
REPLETE:              hsl(180, 75%, 50%)   vivid teal
REPRESENTATIONAL:     hsl(290, 70%, 65%)   vivid violet
GLITCH/SYSTEM:        hsl(0, 85%, 58%)     vivid red

Legend strip background:  #f0ece4   warm off-white (Kuo's linen tone)
Legend strip text:        #1a1a1a   near-black
```

---

## Legend Strip (all views)

Fixed band at the bottom of the canvas. Height: 48px.

```
[  ■ LIMINAL   ■ SENSORY/TEXTURAL   ■ ABSTRACT   ■ REPRESENTATIONAL   ■ GLITCH/SYSTEM  ]
[  corpus: 45 sentences · {current view label}                                          ]
```

Left side: color swatches (12×12px squares) + style_mode labels in small caps,
monospace, tracking +0.1em.

Right side (optional): current scale indicator — CORPUS / SENTENCE / WORD / CHARACTER.

The strip is an HTML element overlaid on the canvas, not drawn in SVG/Canvas.
Fixed bottom: 0, width: 100%, height: 48px, background: #f0ece4.

---

## View 1 — Corpus: Voronoi (replaces force network)

**D3 primitive**: `d3.Delaunay.from(points)` → `.voronoi(bounds)`

Each sentence is a seed point. Voronoi tessellation divides the canvas into
hard-edged colored cells. No circles. No edges. Pure color field.

**Layout**:

- Seed points initialized from the existing force simulation positions
  (run simulation headlessly, use settled positions as voronoi seeds)
- Cells colored by style_mode — flat fill, no stroke initially
- Cell borders: 1px #000 (black hairline between cells)
- Cell area is a natural consequence of voronoi geometry — well-connected
  nodes that cluster together create smaller, denser cells; isolated nodes
  get larger cells. This encodes connectivity without explicit sizing.

**Hover state**:

- Hovered cell: border thickens to 3px white, label appears (first 4 words,
  small, centered in cell or near cursor)
- Adjacent cells (MLT neighbors from graph.json): borders thicken to 2px
  white, others stay at 1px black
- No opacity changes — hard edges only, no fading

**Click**: enter Scale 2 (pie arc radial view) for that sentence.

**Search mode (beeswarm)**:

- On query, cells that are search results stay full color
- Non-result cells shift to a darkened version of their style_mode color
  (50% lightness reduction) — still visible as cells, not faded to nothing
- Cell label appears on result cells showing score rank

**D3 implementation notes**:

```javascript
import { Delaunay } from "d3-delaunay";

const delaunay = Delaunay.from(
  nodes,
  (d) => d.x,
  (d) => d.y,
);
const voronoi = delaunay.voronoi([0, 0, width, height - 48]); // 48px for legend
// Draw each cell as a <path> with d={voronoi.renderCell(i)}
```

---

## View 2 — Sentence: Exploded Pie Arcs (replaces radial lines)

**D3 primitive**: `d3.pie()` + `d3.arc()`

Selected sentence at center (white void). MLT neighbors as filled wedge
segments radiating outward. Direct translation of Kuo's circular paintings.

**Layout**:

- Inner radius: 120px (center void — contains sentence text)
- Outer radius: varies by score rank
  - Top 3 neighbors: outerRadius 280px
  - Next 4 neighbors: outerRadius 380px
  - Beyond 7: outerRadius 440px
- Arc angle: proportional to MLT score (higher score = wider wedge)
- Small gap between segments: padAngle 0.02 (Kuo's slight separation)
- Segments colored by neighbor's style_mode
- No connecting lines — the filled arc IS the connection

**Center text**:

- Full sentence rendered in center void
- Font: per selected node's style_mode (italic serif for LIMINAL, etc.)
- Font size: 13px, centered, max-width ~220px (inner circle diameter)
- Color: white

**Hover state**:

- Hovered segment: outer radius extends +20px (wedge grows outward)
- Label appears at midpoint of arc: first 6 words of neighbor sentence
- Other segments: no change (hard edge approach, no dimming)

**Click segment**: requery — that neighbor becomes new center, pie reforms.
Transition: segments rotate and resize smoothly via D3 transition on arc tween.

**Arc tween implementation**:

```javascript
// Smooth transition between pie states
selection.transition().duration(1000).attrTween("d", arcTween(arc));

function arcTween(arc) {
  return function (d) {
    const i = d3.interpolate(this._current, d);
    this._current = i(0);
    return (t) => arc(i(t));
  };
}
```

---

## View 3 — Chord Diagram (new view — corpus relationships)

**D3 primitive**: `d3.chord()` + `d3.ribbon()`

A new corpus-level view showing relationships BETWEEN style_modes — how often
do LIMINAL sentences match SENSORY/TEXTURAL ones? How isolated is GLITCH?

**Access**: a "relations →" button in the legend strip (right side), visible
only in corpus view. Replaces the "texture →" button in this context — texture
moves to its own entry point inside character view.

**Layout**:

- `d3.chord()` computes flow matrix from graph.json edge data
- Each style_mode is a group arc on the outer ring, sized by sentence count
- Ribbons connect groups, width = number of MLT edges between style_modes
- Group arcs colored by style_mode (vivid palette)
- Ribbons colored by the source style_mode at 60% opacity

**Matrix computation** (precomputed at build time, added to graph.json or
a new chord.json):

```javascript
// For each edge in graph.json, look up source and target style_modes
// Increment matrix[sourceStyleIdx][targetStyleIdx]
const matrix = styleGroups.map(() => styleGroups.map(() => 0));
Object.entries(graph).forEach(([id, neighbors]) => {
  const sourceStyle = styleIdx[nodes[id].style_mode];
  neighbors.forEach(({ id: targetId }) => {
    const targetStyle = styleIdx[nodes[targetId].style_mode];
    matrix[sourceStyle][targetStyle]++;
  });
});
```

**Hover**: hover a ribbon → highlight that style_mode pair, label with count.
Hover a group arc → highlight all ribbons from that style_mode.

**Click group arc**: transition to voronoi view filtered to that style_mode.

**D3 implementation**:

```javascript
const chord = d3.chord().padAngle(0.05).sortSubgroups(d3.descending);
const chords = chord(matrix);
const arc = d3.arc().innerRadius(innerR).outerRadius(outerR);
const ribbon = d3.ribbon().radius(innerR);
```

---

## View 4 — Word: Timeline (unchanged form, updated palette)

The timeline pill strip stays as-is — it already reads like a Kuo painting
(colored vertical bars on a date axis). Only palette update needed: apply
the new vivid style_mode colors.

Co-occurrence mini-network: replace the force-positioned text cloud with a
voronoi word-cell layout (same Delaunay approach as corpus view but smaller,
word-frequency as seed weight). Each co-occurring word is a cell, sized by
co-occurrence count, colored by a stable per-word hue.

---

## View 5 — Character: Tiled Rectangles (replaces bars)

**D3 primitive**: `d3.treemap()` or manual rect packing

Instead of a bar chart, letter frequencies as a packed rectangle grid —
all 26 letters filling a defined canvas area, each rect sized by frequency,
colored by hue position (a=0°, z=260°). Letters labeled inside their rect.

```javascript
const root = d3.hierarchy({ children: letterData }).sum((d) => d.value);

const treemap = d3
  .treemap()
  .size([width, height - 48])
  .padding(2);

treemap(root);
// Each leaf: rect at (d.x0, d.y0) size (d.x1-d.x0, d.y1-d.y0)
```

Hover: same cross-scale highlight as before (brighten corpus nodes where
that letter is above-average frequent).

Particles prototype stays as a toggle (unchanged).

---

## Legend Strip Content by View

| View                | Left: swatches | Center              | Right                    |
| ------------------- | -------------- | ------------------- | ------------------------ |
| Corpus (voronoi)    | style_mode key | 45 sentences        | relations → / texture →  |
| Sentence (pie)      | style_mode key | runs-X · STYLE_MODE | esc to exit              |
| Chord               | style_mode key | corpus relations    | esc to exit              |
| Word (timeline)     | style_mode key | word: {word}        | timeline · co-occurrence |
| Character (treemap) | hue scale a→z  | character frequency | histogram · particles    |

---

## Build Order

Do not break existing tests (45/45). All changes are renderer-only.
Build and visually approve each step before moving to the next.

### Step I — Updated palette + legend strip

- [ ] Update all HSL values to new vivid palette in constants
- [ ] Build legend strip HTML component — fixed bottom, warm off-white,
      swatches, labels
- [ ] Wire strip content to current view state
- [ ] **Verify**: visual review — strip visible in all 5 views, colors vivid

### Step II — Voronoi corpus view

- [ ] Replace force-network SVG circles/edges with Delaunay voronoi cells
- [ ] Seed positions from settled force sim (run headlessly, extract x/y)
- [ ] Hover: cell border thickens, neighbor borders thicken, label appears
- [ ] Search mode: darken non-result cells (no fading, hard color shift)
- [ ] Click cell → Scale 2
- [ ] **Verify**: visual review — all 45 cells visible, clustering by style_mode
      apparent, hard edges clean

### Step III — Exploded pie arc radial view

- [ ] Replace radial line + circle layout with d3.pie() + d3.arc() wedges
- [ ] Inner void contains center sentence text
- [ ] Segments sized by score, colored by neighbor style_mode
- [ ] Hover: segment grows outward, label appears
- [ ] Click segment → arc tween transition to new center
- [ ] Escape → return to voronoi
- [ ] **Verify**: visual review — wedge geometry clear, score sizing visible,
      transition smooth

### Step IV — Chord diagram

- [ ] Precompute chord matrix (style_mode → style_mode edge counts)
      and add to precompute-graph.mjs output as chord.json
- [ ] Build chord view using d3.chord() + d3.ribbon()
- [ ] Hover ribbons and group arcs
- [ ] Click group arc → filter voronoi to that style_mode
- [ ] **Verify**: visual review — ribbons readable, group sizes proportional

### Step V — Co-occurrence voronoi (word view)

- [ ] Replace force text cloud in Panel B with small voronoi layout
- [ ] Word cells sized by co-occurrence count
- [ ] **Verify**: visual review — cleaner than text cloud

### Step VI — Treemap character view

- [ ] Replace histogram bars with d3.treemap() letter cells
- [ ] Letters labeled inside rects
- [ ] Hover: cross-scale highlight (unchanged behavior)
- [ ] **Verify**: visual review — all 26 letters visible, frequency sizing legible

### Step VII — Polish + deploy

- [ ] All transitions feel cohesive across views
- [ ] Legend strip consistent across all views
- [ ] Push to main → Vercel deploy
- [ ] **Verify**: full navigation loop on live URL

---

## Do Not

- Do not remove the existing scale navigation model
- Do not change any API routes or data
- Do not break the 45/45 passing tests
- Do not use opacity fading for hover states — use hard color shifts only
- Do not use gradients or drop shadows anywhere
- Do not build Step III before Step II is visually approved
- Do not build Step IV before Step III is approved
