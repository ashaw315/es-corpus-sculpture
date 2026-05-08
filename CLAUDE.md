# CLAUDE.md — ES Corpus Sculpture

A multi-scale interactive archive of surreal sentences from WWBH and trace-forms.
Sentences from the `runs` table (Neon Postgres) are indexed into OpenSearch and
visualized as four interconnected D3 views — corpus network, beeswarm, radial arc,
word co-occurrence, and character frequency — navigable by zooming through scales
of language.

Full implementation spec: `docs/es-corpus-sculpture-spec-v2.md`

---

## Stack

- **OpenSearch**: Bonsai Hobby tier (hosted, OpenSearch 2.19.4) for production; Docker OpenSearch 2.19 locally
- **Client**: `@opensearch-project/opensearch`
- **API**: Next.js App Router route handlers (`/api/search`, `/api/mlt`, `/api/date-range`)
- **Renderer**: D3 v7 (replaced p5 — do not reinstall p5)
- **Source of truth**: Neon Postgres — `runs` table
- **Sync**: Node.js script (`scripts/sync-to-es.mjs`) run nightly via GitHub Actions

---

## Completed Work (Steps 1–7)

The full backend is built, tested, and verified. Do not re-implement any of this.

| Step | What was built                                                                 |
| ---- | ------------------------------------------------------------------------------ |
| 1    | Local OpenSearch running via Docker                                            |
| 2    | `sentences` index created with full mapping (7 fields, custom analyzer)        |
| 3    | `scripts/sync-to-es.mjs` — 44 docs synced from Neon, idempotent upsert         |
| 4    | `app/api/search/route.js` — multi_match, style_mode filter, date_histogram agg |
| 5    | `app/api/mlt/route.js` — MLT with tuned params, exclude_id support             |
| 6    | MLT tuning — confirmed working params (see below)                              |
| 7    | `app/api/date-range/route.js` — corpus min/max dates                           |

**25/25 Jest tests passing.** Do not break this.

**MLT confirmed params** (do not change without running mlt-coverage.test.mjs):

- `max_query_terms: 50`, `minimum_should_match: 1`
- `min_term_freq: 1`, `min_doc_freq: 1`
- `fields: ['sentence', 'title']`
- As corpus grows past ~100 docs, tighten `minimum_should_match` to `'5%'`

**Renderer pivot**: p5 was tried and replaced with D3 v7. Do not reinstall p5.
`components/SculptureCanvas.jsx` currently has a D3 implementation that needs
to be replaced with the multi-scale system described in spec v2.

---

## Environment Variables

```env
OPENSEARCH_URL=http://localhost:9200   # local Docker default
OPENSEARCH_USERNAME=                   # empty locally
OPENSEARCH_PASSWORD=                   # empty locally
DATABASE_URL=                          # Neon connection string
```

Production (Vercel + GitHub Actions secrets):

```
OPENSEARCH_URL       → Bonsai cluster URL
OPENSEARCH_USERNAME  → Bonsai Access Key
OPENSEARCH_PASSWORD  → Bonsai Access Secret
```

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

# Verify
curl http://localhost:9200
# Expected: "tagline": "The OpenSearch Project: https://opensearch.org/"
```

### Sync Neon → OpenSearch

```bash
DRY_RUN=true node scripts/sync-to-es.mjs   # dry run first
node scripts/sync-to-es.mjs                 # live sync
curl http://localhost:9200/sentences/_count | jq
```

### Next.js dev server

```bash
npm run dev
```

### Run tests

```bash
npm test             # 25 tests across 5 suites — must stay green
npm run test:watch
```

---

## TDD Approach

### What gets tested

| Layer             | Tested? | How                                                                     |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| Index creation    | Yes     | Verify mapping shape returned from OpenSearch                           |
| Sync script       | Yes     | Seed fixture rows, verify indexed doc count and field values            |
| `/api/search`     | Yes     | Integration test against local OpenSearch, verify response shape        |
| `/api/mlt`        | Yes     | Integration test + corpus-wide coverage gate (mlt-coverage.test.mjs)    |
| D3 renderer       | No      | Visual review only                                                      |
| Precompute script | Yes     | Verify graph.json, words.json, word-index.json, chars.json output shape |

### Rules

1. **Write the test before the implementation.** Watch it fail, then implement.
2. **Tests run against local Docker OpenSearch** — never Bonsai.
3. **Use `sentences-test` index** — created and destroyed per test run.
4. **No mocking OpenSearch.** Integration tests call the real local instance.
5. **Fixture data**: `tests/fixtures/runs.js` — 5 rows covering overlapping vocab,
   4 distinct style_modes, 3 distinct modes, one null title.
6. **maxWorkers: 1** in jest.config.mjs — suites run serially to avoid index race conditions.

---

## Build Order

Steps 1–7 complete. Continue from Step A.

### Step A — Static data precomputation

- [ ] Write test first: verify output shape of all 4 JSON files
- [ ] `scripts/precompute-graph.mjs` — generates:
  - `/public/data/graph.json` — edge graph (each neon_id → top 5 MLT neighbors with scores)
  - `/public/data/words.json` — word frequency across corpus (stopwords excluded)
  - `/public/data/word-index.json` — word → array of neon_ids containing it
  - `/public/data/chars.json` — letter frequency a–z across corpus
- [ ] Dry run: verify all 44 nodes in graph, edges bidirectional, word counts sensible
- [ ] **Verify**: `node scripts/precompute-graph.mjs && cat public/data/graph.json | jq keys | wc -l` = 44

### Step B — Scale 1: Network graph

- [ ] Replace current `components/SculptureCanvas.jsx` with D3 force simulation
- [ ] Nodes from `graph.json`, edges as force links
- [ ] Node color → style_mode palette (see spec v2 for exact HSL values)
- [ ] Node size → sentence length
- [ ] Edge thickness → MLT score, edge opacity 0.2
- [ ] Hover: label (first 4 words), connected edges highlight, others fade
- [ ] Zoom/pan via `d3.zoom`, nodes draggable
- [ ] **Verify**: visual review — all 44 nodes visible, clusters apparent, zoom works

### Step C — Scale 1b: Beeswarm (search mode)

- [ ] Search input wired to `/api/search`
- [ ] Query → network dissolves → beeswarm transition (~800ms, d3.easeCubicInOut)
- [ ] x-axis = date, y-axis = relevance score
- [ ] Non-result nodes fade to 10% opacity
- [ ] Clear query → transition back to network
- [ ] **Verify**: visual review — date axis readable, score gradient visible

### Step D — Scale 2: Radial arc

- [ ] Click any node → radial transition (~1000ms)
- [ ] Selected sentence at center, MLT neighbors on concentric rings (top 3 inner, next 4 outer)
- [ ] Arcs: thickness = score, color = date hue (220° → 35°, corpus-wide range)
- [ ] Node typography → style_mode treatment per spec v2
- [ ] Click neighbor → requery, composition reforms around new center
- [ ] Escape → return to Scale 1
- [ ] **Verify**: visual review — arc weights visible, typography differentiation clear

### Step E — Scale 3: Word view

- [ ] Click a word in the center sentence (Scale 2) → word view
- [ ] Panel A (default): timeline strip — sentences containing word, pills by date,
      colored by style_mode, hover to read full sentence
- [ ] Panel B (toggle): co-occurrence mini-network — selected word at center,
      co-occurring words radially, sized by co-occurrence count
- [ ] Click sentence pill → Scale 2 for that sentence
- [ ] Click co-occurring word → pivot to that word's view
- [ ] Escape → return to Scale 2
- [ ] **Verify**: visual review — both panels working, navigation in/out clean

### Step F — Scale 4: Character view

- [ ] Frequency histogram (Mode A): 26 bars a–z, height = frequency, bars hue-colored
- [ ] Hovering a bar highlights Scale 1 nodes where that letter is above-average frequent
- [ ] Particle assembly (Mode B): prototype first at 100 particles — if performance
      acceptable at full corpus scale (~10k chars), build out using Canvas not SVG.
      If frame rate drops below 30fps, skip Mode B and ship Mode A only.
- [ ] **Verify**: visual review — histogram readable, cross-scale highlight works

### Step G — Polish + deploy

- [ ] Transitions between all scales feel cohesive (consistent easing, no jarring jumps)
- [ ] Keyboard navigation: Escape always goes up one scale
- [ ] Scale indicator (subtle, top-left): current scale + breadcrumb
- [ ] Add precompute step to WWBH GitHub Actions nightly workflow
- [ ] Bonsai production deploy — create-index against Bonsai, live sync, env vars in Vercel
- [ ] **Verify**: full navigation loop in browser — corpus → sentence → word → character → back

---

## Visual System

```
Background:               #000000
LIMINAL:                  hsl(220, 70%, 60%)   blue      / italic serif
SENSORY/TEXTURAL:         hsl(140, 65%, 55%)   green     / monospace
ABSTRACT:                 hsl(35, 80%, 60%)    amber     / condensed sans
REPLETE:                  hsl(180, 60%, 55%)   teal      / regular sans
REPRESENTATIONAL:         hsl(280, 60%, 65%)   violet    / regular sans
GLITCH:                   hsl(0, 70%, 60%)     red       / monospace
Date hue (MLT arcs):      220° → 35°           blue → amber
Transitions:              800–1200ms, d3.easeCubicInOut
UI chrome:                monospace, small, low contrast
```

---

## Do Not

- **Do not run live sync against Bonsai without `DRY_RUN=true` first.**
- **Do not use `@elastic/elasticsearch`.** Use `@opensearch-project/opensearch`.
- **Do not reinstall p5.** Renderer is D3. p5 was removed intentionally.
- **Do not mock OpenSearch in tests.** Tests run against real local instance.
- **Do not add replicas to the index.** Bonsai free tier requires `number_of_replicas: 0`.
- **Do not build Scale 3 or 4 before Scales 1 and 2 are visually approved.**
- **Do not compute the graph at runtime.** Must be precomputed and served as static JSON.
- **Do not attempt Scale 4 particle assembly in SVG.** Use Canvas. Prototype at 100
  particles first before committing to full corpus scale.
- **Do not break the 25 passing tests.** Run `npm test` after every step.

---

## Key ES Concepts (already encountered)

| Concept                             | Where            |
| ----------------------------------- | ---------------- |
| Mappings, analyzers, shards         | create-index.mjs |
| Bulk API, doc_as_upsert             | sync-to-es.mjs   |
| multi_match, bool/filter, fuzziness | /api/search      |
| date_histogram aggregation          | /api/search      |
| More Like This, tuning params       | /api/mlt         |
| BM25 scoring                        | MLT tuning       |
