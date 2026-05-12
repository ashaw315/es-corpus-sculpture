# Corpus View — Autonomous Activation Engine Spec (v2)

The corpus view renders sentence nodes as overlapping colored circles of
varying sizes on a warm off-white ground. An autonomous animation engine
continuously draws and fades MLT connection lines between semantically
related sentences, making the corpus's hidden relationship structure
visible over time.

Visual reference: Adam Shaw's circle paintings — discrete colored ovals
in a flowing arrangement, overlapping with depth, rich color variation
within a cohesive palette. The corpus is a map of relationships, not a
chart.

---

## Concept

The animation IS the data. Every line drawn represents a real MLT
relationship from OpenSearch. The corpus narrates its own structure
continuously, without user input.

No static edges. The graph is revealed through time, not space.
The circles are the sentences. The lines are the relationships.

---

## Node Rendering

- **Position**: D3 force simulation, settled via simulation.tick(300),
  positions frozen with n.fx = n.x, n.fy = n.y
- **Size**: radius scaled by sentence character count
  - Min radius: 8px (shortest sentences)
  - Max radius: 28px (longest sentences)
  - Scale: r = 8 + (charCount - minChars) / (maxChars - minChars) * 20
- **Color**: per-node variation derived from style_mode base color
  - Base hue from session palette for that style_mode
  - Each sentence gets a unique +/-15 degree hue offset and +/-8%
    lightness variation seeded from its neon_id (deterministic per
    sentence, consistent across sessions)
  - Result: rich color variation within each style_mode family
- **Opacity**: 0.75 — allows overlapping circles to show depth
- **Overlap**: allowed — force collision radius = 60% of node radius
  so circles partially overlap
- **Background**: warm off-white (#f5f2ed)

---

## Autonomous Activation Engine

### Timing
```
Activation interval:  1200ms
Draw phase:           800ms  (stroke-dashoffset animation)
Hold phase:           1000ms
Fade phase:           1500ms
Total line lifetime:  3300ms
```

### Line rendering
```
stroke-width:    1.5px
max opacity:     0.6
color:           activating node's style_mode base color
animation:       stroke-dasharray/stroke-dashoffset progressive draw
```

### Behavior
- Every 1200ms a random sentence node activates
- Lines draw to its MLT neighbors (up to 5, from graph.json)
- Multiple activations overlap — 3-5 active sets at any moment

---

## Hover Behavior

- Mouseover: activate that node, pause autonomous timer, show label
- In-flight lines: continue their lifecycle while hovering
- Mouseleave: label disappears, timer resumes

---

## Mode Transitions

### Corpus to Beeswarm
1. Stop engine, clear lines
2. Background transitions from #f5f2ed to #000
3. Node opacity transitions to 1.0
4. Run beeswarm transition

### Beeswarm to Corpus
1. Background transitions back to #f5f2ed
2. Node opacity back to 0.75
3. Engine restarts after 2s delay

### Corpus to/from Radial
- Same background transition pattern (radial uses black background)

---

## Session Variation

- Palette: 4 palettes rotate randomly per session
- Per-node color variation: deterministic per sentence (neon_id seed),
  consistent across sessions and palette changes
- Layout: force sim varies slightly per load (non-deterministic)

---

## Files

- components/SculptureCanvas.jsx
- lib/palette.mjs — add nodeColor(node, palette) utility
- public/data/graph.json
- public/data/nodes.json