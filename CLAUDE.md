# CLAUDE.md — ES Corpus Sculpture

A multi-scale interactive archive of surreal sentences from WWBH and trace-forms.
Sentences from the `runs` table (Neon Postgres) are indexed into OpenSearch and
visualized as four interconnected D3 views — animated corpus, beeswarm search,
radial arc sentence view, word timeline/co-occurrence, and character histogram —
navigable by zooming through scales of language.

Specs:
- `docs/es-corpus-sculpture-spec-v2.md` — navigation model, data model, API
- `docs/es-corpus-sculpture-spec-v3-kuo.md` — visual redesign direction (partially implemented)
- `docs/corpus-activation-engine-spec.md` — corpus view animation system
- `docs/radial-cluster-spec.md` — radial cluster layout (IN PROGRESS, replacing force sim)
- `docs/palette-rotation-spec.md` — session palette rotation (BUILT)

---

## Stack

- **OpenSearch**: Bonsai Hobby tier (hosted, OpenSearch 2.19.4) for production; Docker OpenSearch 2.19 locally
- **Client**: `@opensearch-project/opensearch`
- **API**: Next.js App Router route handlers (`/api/search`, `/api/mlt`, `/api/date-range`)
- **Renderer**: D3 v7 (do not reinstall p5)
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
| 3 | `scripts/sync-to-es.mjs` — idempotent upsert, refresh: wait_for |
| 4 | `app/api/search/route.js` — multi_match, style_mode filter, date_histogram |
| 5 | `app/api/mlt/route.js` — MLT with tuned params, exclude_id support |
| 6 | MLT tuning — confirmed working params (see below) |
| 7 | `app/api/date-range/route.js` — corpus min/max dates |

**Tests must stay passing. Do not break this.**

**MLT confirmed params** (do not change without running mlt-coverage.test.mjs):
- `max_query_terms: 50`, `minimum_should_match: 1`
- `min_term_freq: 1`, `min_doc_freq: 1`
- `fields: ['sentence', 'title']`
- As corpus grows past ~100 docs, tighten `minimum_should_match` to `'5%'`

**Precompute race fix**: `precomputeAll()` fetches docs once and passes through
to all builders. `sync-to-es.mjs` uses `refresh: 'wait_for'` on bulk write.
Do not revert either of these — they prevent a production breakage where graph.json
referenced nodes not yet in nodes.json.

### Frontend v1 (Steps A–G) — Complete, deployed

| Step | What was built |
|------|---------------|
| A | `scripts/precompute-graph.mjs` — graph.json, words.json, word-index.json, chars.json |
| B | Scale 1: D3 force network (replaced in Step II) |
| C | Scale 1b: Beeswarm search — date axis, score y-position, mode transition |
| D | Scale 2: Radial arc — MLT neighbors on concentric rings, date-hue arcs |
| E | Scale 3: Word view — timeline strip (Panel A), co-occurrence network (Panel B) |
| F | Scale 4: Character frequency histogram |
| G | Polish + deploy — Bonsai populated, Vercel live, nightly GitHub Actions sync |

### Frontend v2 (Steps I–II) — Complete, in production

| Step | What was built |
|------|---------------|
| I | Vivid palette (`lib/palette.mjs`), legend strip (`components/LegendStrip.jsx`), session palette rotation (4 palettes, random per load) |
| II | Corpus view: radial cluster ring layout (in progress) — sentences on circumference grouped by style_mode, chord paths for MLT connections. Off-white background, sized circles, per-node color variation. See `docs/radial-cluster-spec.md` |

**Current production**: https://es-corpus-sculpture.vercel.app/search

### Current renderer state
- `components/SculptureCanvas.jsx` — corpus activation engine + beeswarm + radial arc
- `components/WordView.jsx` — Scale 3 word view
- `components/CharacterView.jsx` — Scale 4 character histogram (no particles toggle)
- `components/LegendStrip.jsx` — persistent bottom strip, view-aware content
- `lib/palette.mjs` — PALETTE_SETS (4), SESSION_PALETTE, STYLE_COLOR, fadedColor()
- Navigation: click node → Scale 2; click word → Scale 3; texture → Scale 4; Escape pops one level

---

## Visual System

### Session palette rotation
4 palettes rotate randomly per page load (stored in sessionConfig useState,
client-side only to avoid SSR hydration mismatch):

```
Palette A — Primary:   blue / green / amber / teal / violet / red
Palette B — Warm:      coral / yellow / pink / purple / sky / teal-green
Palette C — Cool:      cyan / periwinkle / mint / magenta / yellow-green / burnt-orange
Palette D — Muted Kuo: steel-blue / forest / ochre / brick / dusty-violet / slate
```

Legend strip swatches always reflect the active session palette.

### Legend strip
Fixed bottom, height 48px, background #f0ece4, text #1a1a1a.
Content varies by current view — see LegendStrip.jsx.

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
docker start opensearch-local
# or if container doesn't exist:
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
npm test   # must stay passing
```

---

## TDD Approach

| Layer | Tested? | How |
|-------|---------|-----|
| Index creation | Yes | Mapping shape from OpenSearch |
| Sync script | Yes | Fixture rows → doc count + field values |
| `/api/search` | Yes | Integration test, response shape |
| `/api/mlt` | Yes | Integration + mlt-coverage.test.mjs |
| Precompute script | Yes | Output shape of all 4 JSON files |
| D3 renderer | No | Visual review only |

Rules:
1. Write test before implementation. Watch it fail, then implement.
2. Tests run against local Docker OpenSearch — never Bonsai.
3. Use `sentences-test` index — created and destroyed per run.
4. No mocking OpenSearch.
5. `maxWorkers: 1` in jest.config.mjs — serialize to avoid index races.

---

## Build Order — Remaining

Steps I–II complete. Remaining steps from the Kuo visual redesign.
Build and visually approve each before advancing.

### Step III — Exploded pie arc radial (Scale 2)
Replace the current radial lines + circles with filled D3 arc wedges.
Full spec in `docs/es-corpus-sculpture-spec-v3-kuo.md`.

- [ ] Replace radial line + circle layout with d3.pie() + d3.arc() wedges
- [ ] Inner radius 120px (void containing center sentence text)
- [ ] Segment angle proportional to MLT score, fill = neighbor style_mode color
- [ ] padAngle 0.02 (slight gap between segments, Kuo aesthetic)
- [ ] Hover: segment outer radius extends +20px, label at arc midpoint
- [ ] Click segment → arc tween transition to new center sentence
- [ ] Escape → return to corpus activation view
- [ ] **Verify**: wedge geometry clear, score sizing visible, tween smooth

### Step IV — Chord diagram (new corpus-level view)
- [ ] Precompute chord matrix (style_mode → style_mode edge counts) → chord.json
- [ ] Build chord view: d3.chord() + d3.ribbon()
- [ ] Access via "relations →" in legend strip (corpus view only)
- [ ] **Verify**: ribbons readable, group sizes proportional

### Step V — Polish + deploy
- [ ] Transitions cohesive across all views
- [ ] Push to main → Vercel deploy
- [ ] **Verify**: full navigation loop on live URL

---

## Do Not

- **Do not run live sync against Bonsai without `DRY_RUN=true` first.**
- **Do not use `@elastic/elasticsearch`.** Use `@opensearch-project/opensearch`.
- **Do not reinstall p5.** Renderer is D3.
- **Do not mock OpenSearch in tests.**
- **Do not add replicas to the index.** Bonsai free tier: `number_of_replicas: 0`.
- **Do not revert the precompute single-fetch or refresh:wait_for fixes.**
- **Do not break the passing tests.**
- **Do not compute the graph at runtime.** Precomputed static JSON only.
- **Do not reinstall ParticlePrototype.** It was removed intentionally.
- **Do not use opacity fading for hover states in Kuo-influenced views.** Hard color shifts only.

---

## Key ES Concepts (already encountered)

| Concept | Where |
|---------|-------|
| Mappings, analyzers, shards | create-index.mjs |
| Bulk API, doc_as_upsert, refresh:wait_for | sync-to-es.mjs |
| multi_match, bool/filter, fuzziness | /api/search |
| date_histogram aggregation | /api/search |
| More Like This, tuning params | /api/mlt |
| BM25 scoring | MLT tuning |