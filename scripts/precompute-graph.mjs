// Step A — precompute four static data files for the multi-scale renderer.
// Run nightly (and locally) to bake corpus-derived structure into JSON so
// the frontend can render scales 1–4 without any runtime computation.

import 'dotenv/config'
import { config as loadDotenv } from 'dotenv'
import { Client } from '@opensearch-project/opensearch'
import { fileURLToPath } from 'url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { runMlt } from '../lib/mlt.mjs'

loadDotenv({ path: '.env.local', override: true })

// English stopwords matching the OpenSearch `stop` token filter (Lucene
// English defaults), so the precomputed vocabulary aligns with what the
// search index actually treats as content words.
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by',
  'for', 'if', 'in', 'into', 'is', 'it',
  'no', 'not', 'of', 'on', 'or',
  'such', 'that', 'the', 'their', 'then', 'there', 'these',
  'they', 'this', 'to', 'was', 'will', 'with',
  // A few high-frequency function words the Lucene list omits but that
  // would otherwise dominate corpus stats.
  'its', 'her', 'his', 'them', 'while', 'each',
  'every', 'from', 'has', 'have', 'had', 'been',
])

const NEIGHBOR_COUNT = 5
const FILES = ['nodes.json', 'graph.json', 'words.json', 'word-index.json', 'chars.json']

// Tokenize text → lowercase tokens of pure a–z (plus apostrophes ignored).
// Drops anything containing digits or underscores — keeps the vocabulary to
// real words. Length 2+ to drop incidental noise like single letters.
function tokenize(text) {
  if (!text) return []
  const tokens = []
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length >= 2) tokens.push(raw)
  }
  return tokens
}

export function buildWordsAndIndex(docs) {
  const words = Object.create(null)
  const wordIndex = Object.create(null) // word → Set<neon_id> (deduped)

  for (const doc of docs) {
    const text = `${doc.sentence || ''} ${doc.title || ''}`
    for (const tok of tokenize(text)) {
      if (STOPWORDS.has(tok)) continue
      words[tok] = (words[tok] || 0) + 1
      if (!wordIndex[tok]) wordIndex[tok] = new Set()
      wordIndex[tok].add(doc.neon_id)
    }
  }

  // Materialize sets to sorted arrays so JSON output is stable.
  const wordIndexFlat = Object.create(null)
  for (const [word, idSet] of Object.entries(wordIndex)) {
    wordIndexFlat[word] = Array.from(idSet).sort()
  }

  return { words, wordIndex: wordIndexFlat }
}

// Per-node metadata that the renderer needs but graph.json doesn't carry —
// style_mode for color, sentence length for size, the sentence itself for
// the hover label. Keeps the runtime layer purely static-asset driven.
export function buildNodes(docs) {
  return docs.map(d => ({
    id: d.neon_id,
    sentence: d.sentence,
    title: d.title,
    date: d.date,
    mode: d.mode,
    style_mode: d.style_mode,
    artifact_url: d.artifact_url,
    length: (d.sentence || '').length,
  }))
}

export function buildChars(docs) {
  // Always-26-keys output so the histogram view doesn't have to backfill.
  const chars = Object.create(null)
  for (const code of 'abcdefghijklmnopqrstuvwxyz') chars[code] = 0

  for (const doc of docs) {
    const text = `${doc.sentence || ''} ${doc.title || ''}`.toLowerCase()
    for (const ch of text) {
      if (ch >= 'a' && ch <= 'z') chars[ch]++
    }
  }
  return chars
}

// Pull every doc from the index. Uses scroll for forward compat — at 44 docs
// a single page is fine, but the script should still work as the corpus grows.
async function fetchAllDocs(client, index) {
  const docs = []
  let response = await client.search({
    index,
    scroll: '1m',
    body: { size: 200, query: { match_all: {} } },
  })
  let body = response.body ?? response
  let scrollId = body._scroll_id

  while (body.hits.hits.length) {
    for (const h of body.hits.hits) docs.push({ id: h._id, ...h._source })
    response = await client.scroll({ scroll: '1m', scroll_id: scrollId })
    body = response.body ?? response
    scrollId = body._scroll_id
  }

  if (scrollId) {
    try { await client.clearScroll({ scroll_id: scrollId }) } catch {}
  }
  return docs
}

// Caller passes docs explicitly — precomputeAll fetches them once and shares
// them across every output, so nodes.json and graph.json can never diverge
// when OpenSearch indexes a new doc mid-run.
export async function buildGraph(client, docs, index) {
  // Back-compat for callers that pass an index string instead of a docs array
  // (kept for the integration tests that still call buildGraph(client, INDEX)).
  if (typeof docs === 'string') {
    index = docs
    docs = await fetchAllDocs(client, index)
  }

  const graph = Object.create(null)
  for (const doc of docs) {
    const neonId = doc.neon_id || doc.id
    // Request one extra so the self-exclude filter still leaves us with the
    // requested neighbor count. `unlike` usually drops self before scoring,
    // but the route's defensive post-filter would otherwise short us by one.
    const hits = await runMlt(client, {
      index,
      sentence: doc.sentence,
      excludeId: neonId,
      size: NEIGHBOR_COUNT + 1,
    })
    graph[neonId] = hits.slice(0, NEIGHBOR_COUNT).map(h => ({
      id: h.id,
      score: Math.round(h.score * 100) / 100, // 2 decimals — JSON noise floor
    }))
  }
  return graph
}

export async function precomputeAll({ client, index, outDir }) {
  await mkdir(outDir, { recursive: true })

  const docs = await fetchAllDocs(client, index)
  const nodes = buildNodes(docs)
  const graph = await buildGraph(client, docs, index)
  const { words, wordIndex } = buildWordsAndIndex(docs)
  const chars = buildChars(docs)

  await writeFile(join(outDir, 'nodes.json'), JSON.stringify(nodes, null, 2))
  await writeFile(join(outDir, 'graph.json'), JSON.stringify(graph, null, 2))
  await writeFile(join(outDir, 'words.json'), JSON.stringify(words, null, 2))
  await writeFile(join(outDir, 'word-index.json'), JSON.stringify(wordIndex, null, 2))
  await writeFile(join(outDir, 'chars.json'), JSON.stringify(chars, null, 2))

  return {
    counts: {
      docs: docs.length,
      nodes: nodes.length,
      graph: Object.keys(graph).length,
      words: Object.keys(words).length,
      chars: 26,
    },
    files: FILES.map(f => join(outDir, f)),
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isDirectRun) {
  const node = process.env.OPENSEARCH_URL || 'http://localhost:9200'
  const auth = process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined
  const indexName = process.env.INDEX || 'sentences'
  const outDir = process.env.OUT_DIR || 'public/data'

  const client = new Client({ node, auth })
  try {
    console.log(`Precomputing from "${indexName}" at ${node}…`)
    const { counts, files } = await precomputeAll({ client, index: indexName, outDir })
    console.log(`docs:   ${counts.docs}`)
    console.log(`graph:  ${counts.graph} keys`)
    console.log(`words:  ${counts.words} unique tokens`)
    console.log(`chars:  ${counts.chars} letters`)
    for (const f of files) console.log(`wrote   ${f}`)
  } finally {
    await client.close()
  }
}
