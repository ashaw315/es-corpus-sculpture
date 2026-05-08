# CLAUDE.md — ES Corpus Sculpture

A multi-scale interactive archive of surreal sentences from WWBH and trace-forms.
Sentences from the `runs` table (Neon Postgres) are indexed into OpenSearch and
visualized as five interconnected D3 views — voronoi corpus, beeswarm search,
exploded pie arc radial, word timeline/co-occurrence, and character treemap —
navigable by zooming through scales of language. Visual language inspired by
Andrew Kuo: hard-edged filled geometry, chart primitives as aesthetic objects,
persistent legend strip.

Specs:
- `docs/es-corpus-sculpture-spec-v2.md` — navigation model, data model, API
- `docs/es-corpus-sculpture-spec-v3-kuo.md` — current visual redesign target

---

## Stack

- **OpenSearch**: Bonsai Hobby tier (hosted, OpenSearch 2.19.4) for production; Docker OpenSearch 2.19 locally
- **Client**: `@opensearch-project/opensearch`
- **API**: Next.js App Router route handlers (`/api/search`, `/api/mlt`, `/api/date-range`)
- **Renderer**: D3 v7 (replaced p5 — do not reinstall p5)
- **Source of truth**: Neon Postgres — `runs` table
- **Sync**: Node.js script (`scripts/sync-to-es.mjs`) run nightly via GitHub Actions
- **Deploy**: Vercel (ashaw315s-projects/es-corpus-sculpture), live at es-corpus-sculpture.vercel.app

---

## Completed Work

### Backend (Steps 1–7) — Do not re-implement

| Step | What was built |
|------|---------------|
| 1 | Local OpenSearch running via Docker |
| 2 | `sentences` index — 7 fields, custom sentence_analyzer |
| 3 | `scripts/sync-to-es.mjs` — 45 docs synced, idempotent upsert |
| 4 | `app/api/search/route.js` — multi_match, style_mode filter, date_histogram |
| 5 | `app/api/mlt/route.js` — MLT with tuned params, exclude_id support |
| 6 | MLT tuning — confirmed working params (see below) |
| 7 | `app/api/date-range/route.js` — corpus min/max dates |

**45/45 Jest tests passing. Do not break this.**

**MLT confirmed params** (do not change without running mlt-coverage.test.mjs):
- `max_query_terms: 50`, `minimum_should_match: 1`
- `min_term_freq: 1`, `min_doc_freq: 1`
- `fields: ['sentence', 'title']`
- As corpus grows past ~100 docs, tighten `minimum_should_match` to `'5%'`

### Frontend v1 (Steps A–G) — Complete, deployed, in production

| Step | What was built |
|------|---------------|
| A | `scripts/precompute-graph.mjs` — graph.json, words.json, word-index.json, chars.json |
| B | Scale 1: D3 force network — 45 nodes, style_mode colors, hover/drag/zoom |
| C | Scale 1b: Beeswarm search — date axis, score y-position, mode transition |
| D | Scale 2: Radial arc — MLT neighbors on concentric rings, date-hue arcs |
| E | Scale 3: Word view — timeline strip (Panel A), co-occurrence network (Panel B) |
| F | Scale 4: Character view — frequency histogram, particle prototype |
| G | Polish + deploy — Bonsai populated, Vercel live, nightly GitHub Actions sync |

**Current production**: https://es-corpus-sculpture.vercel.app/search

**Known state of current renderer**:
- `components/SculptureCanvas.jsx` — D3 force network + beeswarm
- `components/WordView.jsx` — Scale 3 word view
- `components/CharacterView.jsx` — Scale 4 character histogram
- `components/ParticlePrototype.jsx` — Scale 4 particle mode
- Navigation: click node → Scale 2 radial; click word → Scale 3; texture → Scale 4; Escape pops one level

---

## Visual Redesign Target (Steps I–VII — Kuo Treatment)

Full spec: `docs/es-corpus-sculpture-spec-v3-kuo.md`

### Core principles
- **Filled geometry, not strokes** — wedges, cells, ribbons. No thin lines.
- **Hard edges** — flat saturated fills. No gradients, no blur, no opacity fading.
- **Legend strip** — persistent warm off-white band at bottom of every view.
- **Vivid palette** — push saturation on all style_mode colors.

### Updated color palette
```
LIMINAL:              hsl(220, 85%, 65%)   vivid blue
SENSORY/TEXTURAL:     hsl(145, 80%, 50%)   vivid green
ABSTRACT:             hsl(35, 95%, 58%)    vivid amber/orange
REPLETE:              hsl(180, 75%, 50%)   vivid teal
REPRESENTATIONAL:     hsl(290, 70%, 65%)   vivid violet
GLITCH/SYSTEM:        hsl(0, 85%, 58%)     vivid red
Legend strip:         #f0ece4 background, #1a1a1a text
```

### View changes
| View | Current | Target |
|------|---------|--------|
| Corpus | Force network (circles + edges) | Voronoi cells (hard-edged color fields) |
| Search | Beeswarm (circles on axis) | Beeswarm (unchanged form, vivid palette) |
| Sentence | Radial lines + circles | Exploded pie arcs (filled wedges) |
| Chord | — | New view: d3.chord() corpus relationship diagram |
| Word timeline | Colored pills | Unchanged, vivid palette |
| Word co-occur | Force text cloud | Small voronoi word cells |
| Character | Bar histogram | d3.treemap() letter cells |

---

## Environment Variables

```env
OPENSEARCH_URL=http://localhost:9200   # local Docker default
OPENSEARCH_USERNAME=                   # empty locally
OPENSEARCH_PASSWORD=                   # empty locally
DATABASE_URL=                          # Neon connection string
```

Bonsai creds in `.env.bonsai.local` (gitignored) for ad-hoc ops.
Production: Vercel env vars + GitHub Actions secrets (4 keys).

---

## Dev Commands

### Start local OpenSearch (Docker)
```bash
docker run -d \
  --name opensearch-local \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "DISABLE_INSTALL_DEMO_CONFIG=true" \
  -e "DISABLE_SECURITY_PLUGIN=true" \
  opensearchproject/opensearch:2.19.0

curl http://localhost:9200
# Expected tagline: "The OpenSearch Project: https://opensearch.org/"
```

### Sync + precompute
```bash
DRY_RUN=true node scripts/sync-to-es.mjs
node scripts/sync-to-es.mjs
node scripts/precompute-graph.mjs
```

### Dev + tests
```bash
npm run dev
npm test   # must stay 45/45
```

---

## TDD Approach

| Layer | Tested? | How |
|-------|---------|-----|
| Index creation | Yes | Mapping shape from OpenSearch |
| Sync script | Yes | Fixture rows → doc count + field values |
| `/api/search` | Yes | Integration test, response shape |
| `/api/mlt` | Yes | Integration + mlt-coverage.test.mjs (all 45 docs ≥3 hits) |
| Precompute script | Yes | Output shape of all 4 JSON files |
| D3 renderer | No | Visual review only |

Rules:
1. Write test before implementation. Watch it fail, then implement.
2. Tests run against local Docker OpenSearch — never Bonsai.
3. Use `sentences-test` index — created and destroyed per run.
4. No mocking OpenSearch.
5. `maxWorkers: 1` in jest.config.mjs — serialize to avoid index races.

---

## Build Order — Current Phase

Steps 1–7 and A–G complete. Now on Steps I–VII (Kuo visual redesign).
Build and visually approve each step before advancing.

### Step I — Palette + legend strip
- [ ] Update all HSL constants to vivid palette
- [ ] Build legend strip HTML component (fixed bottom, #f0ece4, 48px)
- [ ] Wire strip content to current view state (swatches, labels, view name)
- [ ] **Verify**: screenshot — strip visible across all views, colors vivid

### Step II — Voronoi corpus view
- [ ] Replace force-network circles/edges with Delaunay voronoi cells
- [ ] Seed positions from settled force sim (run headlessly)
- [ ] Cell fill = style_mode color, 1px black hairline borders
- [ ] Hover: border thickens (3px white hovered, 2px white neighbors), label appears
- [ ] Search mode: darken non-result cells (hard color shift, not opacity fade)
- [ ] Click cell → Scale 2
- [ ] **Verify**: all 45 cells visible, style_mode clustering apparent, edges clean

### Step III — Exploded pie arc radial
- [ ] Replace radial lines + circles with d3.pie() + d3.arc() wedges
- [ ] Inner radius 120px (void with center sentence), outer varies by rank
- [ ] Segment angle proportional to MLT score, fill = neighbor style_mode
- [ ] padAngle 0.02 (slight gap between segments)
- [ ] Hover: segment outer radius extends +20px, label at arc midpoint
- [ ] Click segment → arc tween transition to new center
- [ ] Escape → voronoi
- [ ] **Verify**: wedge geometry clear, score sizing visible, tween smooth

### Step IV — Chord diagram (new view)
- [ ] Precompute chord matrix — add to precompute-graph.mjs as chord.json
- [ ] Build chord view: d3.chord() + d3.ribbon(), style_mode groups
- [ ] Hover ribbons (highlight pair) and group arcs (highlight all ribbons)
- [ ] Click group arc → filter voronoi to that style_mode
- [ ] Access via "relations →" in legend strip (corpus view only)
- [ ] **Verify**: ribbons readable, group sizes proportional to sentence count

### Step V — Co-occurrence voronoi (word view Panel B)
- [ ] Replace force text cloud with small voronoi word cells
- [ ] Cell size = co-occurrence count
- [ ] **Verify**: cleaner than text cloud, words legible

### Step VI — Treemap character view
- [ ] Replace bar histogram with d3.treemap() letter cells
- [ ] All 26 letters fill defined area, sized by frequency, colored by hue
- [ ] Letters labeled inside rects
- [ ] Hover: cross-scale highlight (unchanged behavior)
- [ ] **Verify**: all 26 letters visible, frequency sizing legible

### Step VII — Polish + deploy
- [ ] Transitions cohesive across all views
- [ ] Legend strip consistent across all views and modes
- [ ] Push to main → Vercel deploy
- [ ] **Verify**: full navigation loop on live URL

---

## Do Not

- **Do not run live sync against Bonsai without `DRY_RUN=true` first.**
- **Do not use `@elastic/elasticsearch`.** Use `@opensearch-project/opensearch`.
- **Do not reinstall p5.** Renderer is D3.
- **Do not mock OpenSearch in tests.**
- **Do not add replicas to the index.** Bonsai free tier: `number_of_replicas: 0`.
- **Do not build Step III before Step II is visually approved.**
- **Do not build Step IV before Step III is visually approved.**
- **Do not use opacity fading for hover states.** Hard color shifts only.
- **Do not use gradients or drop shadows.**
- **Do not break the 45/45 passing tests.**
- **Do not compute the graph at runtime.** Precomputed static JSON only.

---

## Key ES Concepts (already encountered)

| Concept | Where |
|---------|-------|
| Mappings, analyzers, shards | create-index.mjs |
| Bulk API, doc_as_upsert | sync-to-es.mjs |
| multi_match, bool/filter, fuzziness | /api/search |
| date_histogram aggregation | /api/search |
| More Like This, tuning params | /api/mlt |
| BM25 scoring | MLT tuning |