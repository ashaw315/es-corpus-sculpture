# ES Corpus Sculpture — Spec v2

A multi-scale interactive archive of surreal sentences from WWBH and trace-forms.
The viewer navigates through four scales of language — corpus, sentence, word,
character — each rendered as a distinct D3 visualization. Zooming in reveals
finer structure; zooming out returns to the full picture.

Full backend (OpenSearch, sync, API routes) is complete and unchanged from v1.
This spec covers the frontend visualization layer only.

---

## Conceptual Frame

The WWBH pipeline compresses raw internet traces → surreal sentence → video.
This interface reverses that compression. The viewer starts at the corpus level
(all sentences as a map) and can drill down through sentence → word → character,
moving against the direction of the original compression.

Each scale answers a different question:

- **Corpus**: What does the whole archive look like? Where do sentences cluster?
- **Sentence**: What does one sentence echo across the archive?
- **Word**: Where does one word live across time and sentences?
- **Character**: What is the raw material — the letter-level texture of the corpus?

---

## Data Model

### Pre-computed at build time (script: `scripts/precompute-graph.mjs`)

Runs once, stores results in Neon as JSONB or a flat JSON file in `/public/data/`.

**Edge graph** — for every sentence in `runs`, call `/api/mlt` and store its top
5 neighbors with scores:

```json
{
  "runs-3": [
    { "id": "runs-14", "score": 71.2 },
    { "id": "runs-28", "score": 58.4 },
    ...
  ]
}
```

**Word frequency** — parse every sentence, tokenize, count occurrences across
the full corpus. Exclude stopwords.

```json
{
  "surface": 12,
  "light": 9,
  "fluorescent": 7,
  ...
}
```

**Word index** — for each word, which run IDs contain it:

```json
{
  "surface": ["runs-3", "runs-14", "runs-28", ...],
  "light": ["runs-5", "runs-9", ...]
}
```

**Character frequency** — letter counts across entire corpus:

```json
{ "a": 4821, "e": 5102, "s": 3847, ... }
```

Store all four as `/public/data/graph.json`, `words.json`, `word-index.json`,
`chars.json`. These are static assets — no API call needed at runtime.

### Runtime API (existing, unchanged)

- `GET /api/search?q=` — fragment search
- `POST /api/mlt` — more like this
- `GET /api/date-range` — corpus min/max dates

---

## The Four Scales

### Scale 1 — Corpus: Network Graph

**Default view on page load.**

Every `runs` row is a node. Edges connect MLT neighbors from the precomputed
graph. The full corpus as a visible map of semantic relationships.

**Visual encoding:**

- Node size → sentence length (longer sentences = slightly larger)
- Node color → style_mode (LIMINAL = blue, SENSORY/TEXTURAL = green,
  ABSTRACT = amber, REPLETE = teal, REPRESENTATIONAL = violet)
- Edge thickness → MLT score (stronger match = thicker edge)
- Edge opacity → 0.2 (subtle, structure not noise)
- Node label → first 4 words of sentence, visible on hover only

**D3 mechanics:**

- `d3.forceSimulation` with `forceManyBody`, `forceLink` (edges as springs),
  `forceCenter`
- Nodes draggable
- Zoom/pan via `d3.zoom`
- On hover: node expands slightly, label appears, connected edges highlight,
  unconnected nodes fade

**Entry points to Scale 2:**

- Click any node → transition to Sentence/Radial view for that sentence
- Type in search box → transition to Corpus/Beeswarm view

---

### Scale 1b — Corpus: Beeswarm (search mode)

Activated when user types a query. The network graph dissolves; sentences
re-arrange onto a horizontal timeline axis scored by search relevance.

**Visual encoding:**

- x-axis → date (oldest left, newest right)
- y-axis → relevance score to current query (higher = higher on canvas)
- Node color → same style_mode palette as network
- Nodes not in search results → fade to 10% opacity, drop to baseline
- Nodes in results → full opacity, sized by score rank

**D3 mechanics:**

- D3 transition from network positions to beeswarm positions (~800ms)
- `d3.forceSimulation` with `forceX` (date position) and `forceY` (score),
  `forceCollide` to prevent overlap
- Clear query → transition back to network graph

**Entry points to Scale 2:**

- Click any visible node → Sentence/Radial view

---

### Scale 2 — Sentence: Radial Arc

Activated by clicking any node. The selected sentence becomes the anchor.
MLT neighbors arrange radially around it.

**Visual encoding:**

- Center node → selected sentence, full text, large (36px)
- Radial nodes → MLT neighbors, arranged by score on concentric rings
  (top 3 on inner ring, next 4 on outer ring)
- Arc connecting center to each neighbor → thickness = score, color = date hue
  (220° deep blue → 35° warm amber mapped to corpus date range)
- Neighbor labels → first ~6 words, full text on hover
- Node typography → style_mode treatment (LIMINAL italic serif,
  SENSORY/TEXTURAL monospace, ABSTRACT condensed, REPLETE sans)

**D3 mechanics:**

- Transition from network/beeswarm positions to radial positions (~1000ms)
- Arcs drawn with `d3.linkRadial` or custom `d3.arc`
- Click neighbor → requery: neighbor becomes new center, composition
  dissolves and reforms

**Entry points:**

- Click any neighbor → re-center on that sentence (stays in Scale 2)
- Click a word in the center sentence → Scale 3/Word view for that word
- Press Escape or click background → return to Scale 1

---

### Scale 3 — Word: Co-occurrence + Timeline

Activated by clicking a word in the center sentence (Scale 2).
Shows where that word lives across the corpus.

**Two panels, togglable:**

**Panel A — Timeline strip:**
All sentences containing the word, arranged horizontally by date.
Each sentence is a small pill/card. Hover to read. Click to jump to
Scale 2 for that sentence.

**Panel B — Co-occurrence mini-network:**
The selected word as center node. Words that frequently appear in the
same sentences as it arranged radially, sized by co-occurrence count.
Click any co-occurring word to pivot to that word's view.

**Visual encoding:**

- Timeline: sentence pills colored by style_mode, sized by sentence length
- Co-occurrence: node size = co-occurrence frequency, color = word frequency
  in corpus (common words = muted, rare words = vivid)

**D3 mechanics:**

- Timeline: `d3.scaleTime` for x-axis, pills as SVG rects
- Co-occurrence: small force simulation, separate from main canvas

**Entry points:**

- Click sentence pill → Scale 2 for that sentence
- Click co-occurring word → pivot to Scale 3 for that word
- Press Escape → return to Scale 2

---

### Scale 4 — Character: Corpus Texture

Activated from a dedicated "texture" button, or by clicking a letter in
Scale 3. The most abstract view — the raw letter-level material of the corpus.

**Two modes:**

**Mode A — Frequency histogram:**
26 bars (a–z), height = frequency in corpus. Bars colored by hue position
(a = 0°, z = 260°). Hovering a bar filters Scale 1 nodes to sentences
where that letter is above-average frequent — a subtle cross-scale link.

**Mode B — Particle assembly:**
All characters in the corpus as individual particles (~8,000–15,000 dots).
At rest they form a cloud. On trigger (hover a sentence node in Scale 1),
particles assemble into that sentence's text, then dissolve back.
Uses `d3.forceSimulation` with target positions per character.

Mode B is the most computationally expensive — test performance before
committing. Fall back to Mode A if particle count causes frame drops.

**Entry points:**

- Press Escape → return to wherever the user came from

---

## Navigation Model

```
[Scale 1: Network] ←──────────────────────────────────┐
    │ type query                    ESC / clear query  │
    ↓                                                  │
[Scale 1b: Beeswarm] ─── click node ──────────────────┤
    │ click node                                       │
    ↓                                                  │
[Scale 2: Radial Arc] ─── ESC ────────────────────────┘
    │ click word                    ESC
    ↓                               ↑
[Scale 3: Word View] ──────────────┘
    │ click letter / texture button
    ↓
[Scale 4: Character]
```

---

## Visual System (consistent across all scales)

**Color palette:**

```
Background:         #000000
style_mode/LIMINAL:              hsl(220, 70%, 60%)   blue
style_mode/SENSORY_TEXTURAL:     hsl(140, 65%, 55%)   green
style_mode/ABSTRACT:             hsl(35, 80%, 60%)    amber
style_mode/REPLETE:              hsl(180, 60%, 55%)   teal
style_mode/REPRESENTATIONAL:     hsl(280, 60%, 65%)   violet
style_mode/GLITCH:               hsl(0, 70%, 60%)     red
Date hue (MLT arcs):             220° → 35°           blue → amber
```

**Typography:**

```
LIMINAL:            italic serif (Georgia or similar)
SENSORY/TEXTURAL:   monospace (Courier New or similar)
ABSTRACT:           condensed sans (Impact or Arial Narrow)
REPLETE:            regular sans (system-ui)
REPRESENTATIONAL:   regular sans (system-ui)
UI chrome:          monospace, small, low contrast
```

**Transitions:**

- Scale change: 800–1200ms, `d3.easeCubicInOut`
- Hover states: 150ms
- Requery (radial reform): 1000ms, nodes lerp from old to new positions

---

## Build Order (frontend only — backend complete)

### Step A — Static data precomputation

- [ ] `scripts/precompute-graph.mjs` — generates graph.json, words.json,
      word-index.json, chars.json into `/public/data/`
- [ ] Verify all 44 nodes present, edges bidirectional, word counts correct
- [ ] Add precompute step to GitHub Actions nightly sync

### Step B — Scale 1: Network graph

- [ ] D3 force simulation, nodes from graph.json
- [ ] Style_mode color encoding
- [ ] Hover: label, edge highlight
- [ ] Zoom/pan
- [ ] Visual review in browser

### Step C — Scale 1b: Beeswarm

- [ ] Search input wired to /api/search
- [ ] Transition from network → beeswarm on query
- [ ] Transition back on clear
- [ ] Visual review

### Step D — Scale 2: Radial arc

- [ ] Click node → radial transition
- [ ] MLT fetch, radial placement, arc drawing
- [ ] Click neighbor → requery/reform
- [ ] Visual review

### Step E — Scale 3: Word view

- [ ] Click word in center sentence → word view
- [ ] Timeline panel (Panel A first)
- [ ] Co-occurrence panel (Panel B)
- [ ] Visual review

### Step F — Scale 4: Character view

- [ ] Frequency histogram (Mode A)
- [ ] Particle assembly (Mode B) — only if performance allows
- [ ] Visual review

### Step G — Polish + deploy

- [ ] Transitions between all scales feel cohesive
- [ ] Keyboard navigation (Escape to go up a scale)
- [ ] Bonsai deploy (Step 9 from original build order)
- [ ] GitHub Actions nightly sync + precompute

---

## Do Not

- Do not build Scale 3 or 4 before Scale 1 and 2 are visually approved
- Do not attempt particle assembly (Scale 4 Mode B) before confirming
  performance with a prototype — 10k+ SVG elements will kill frame rate;
  use Canvas not SVG if pursuing this
- Do not change the API layer — all backend work is complete and tested
- Do not recompute the graph at runtime — it must be precomputed and
  served as a static asset
