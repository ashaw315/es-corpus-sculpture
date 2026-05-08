import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGraph,
  buildWordsAndIndex,
  buildChars,
  buildNodes,
  precomputeAll,
  STOPWORDS,
} from '../scripts/precompute-graph.mjs'
import { rowToDoc, indexDocs } from '../scripts/sync-to-es.mjs'
import { createIndex } from '../scripts/create-index.mjs'
import { makeTestClient, deleteIndexIfExists } from './setup.mjs'
import { fixtureRuns } from './fixtures/runs.js'

const INDEX = 'sentences-test'
// Docs the buildWords / buildChars unit tests use directly. Shape matches
// what comes back from OpenSearch _search hits._source.
const fixtureDocs = fixtureRuns.map(rowToDoc)

describe('buildWordsAndIndex (pure)', () => {
  test('counts word frequencies across all sentences', () => {
    const { words } = buildWordsAndIndex(fixtureDocs)
    // "surface" appears in runs-1001 sentence + title "Surface Memory" (2),
    // runs-1002 sentence (1), runs-1005 sentence (1) — title text counts.
    expect(words.surface).toBe(4)
    // "texture" appears twice in runs-1003 sentence + once in title "Texture Study"
    expect(words.texture).toBe(3)
    // "follows" appears twice in runs-1004 ("form follows pressure follows form")
    expect(words.follows).toBe(2)
    // "form" also twice in runs-1004
    expect(words.form).toBe(2)
  })

  test('excludes stopwords', () => {
    const { words } = buildWordsAndIndex(fixtureDocs)
    for (const sw of ['the', 'a', 'of', 'with', 'that', 'it', 'its', 'every']) {
      expect(words[sw]).toBeUndefined()
    }
  })

  test('STOPWORDS is non-empty and lowercase', () => {
    expect(STOPWORDS.size).toBeGreaterThan(20)
    for (const w of STOPWORDS) expect(w).toBe(w.toLowerCase())
  })

  test('word-index lists doc ids per word, deduped', () => {
    const { wordIndex } = buildWordsAndIndex(fixtureDocs)
    // surface in 3 distinct docs
    expect(wordIndex.surface).toEqual(
      expect.arrayContaining(['runs-1001', 'runs-1002', 'runs-1005'])
    )
    expect(wordIndex.surface.length).toBe(3) // deduped — not counting twice
    // texture appears twice in runs-1003 — should appear once in the index
    expect(wordIndex.texture).toEqual(['runs-1003'])
  })

  test('words and word-index share the same key set', () => {
    const { words, wordIndex } = buildWordsAndIndex(fixtureDocs)
    expect(new Set(Object.keys(words))).toEqual(new Set(Object.keys(wordIndex)))
  })

  test('drops tokens with digits or underscores', () => {
    const docs = [{
      neon_id: 'runs-x',
      sentence: 'word1 word_two real_word.mov 2026 plain hello',
      title: null,
    }]
    const { words } = buildWordsAndIndex(docs)
    expect(words.plain).toBe(1)
    expect(words.hello).toBe(1)
    // tokens with digits/underscores excluded
    expect(words.word1).toBeUndefined()
    expect(words.word_two).toBeUndefined()
    expect(words['2026']).toBeUndefined()
  })

  test('includes title text when present', () => {
    const docs = [{
      neon_id: 'runs-z',
      sentence: 'just a body',
      title: 'cathedral whisper',
    }]
    const { words, wordIndex } = buildWordsAndIndex(docs)
    expect(words.cathedral).toBe(1)
    expect(words.whisper).toBe(1)
    expect(wordIndex.cathedral).toEqual(['runs-z'])
    // Null titles don't crash
    const { words: w2 } = buildWordsAndIndex([
      { neon_id: 'runs-y', sentence: 'body only', title: null },
    ])
    expect(w2.body).toBe(1)
  })
})

describe('buildNodes (pure)', () => {
  test('emits one node per doc with id, sentence, style_mode, length', () => {
    const nodes = buildNodes(fixtureDocs)
    expect(nodes.length).toBe(fixtureDocs.length)
    for (const n of nodes) {
      expect(typeof n.id).toBe('string')
      expect(n.id.startsWith('runs-')).toBe(true)
      expect(typeof n.sentence).toBe('string')
      expect(typeof n.length).toBe('number')
      expect(n.length).toBe(n.sentence.length)
      // style_mode is required by the renderer's color palette
      expect(typeof n.style_mode).toBe('string')
    }
  })

  test('preserves null titles from the underlying doc', () => {
    const nodes = buildNodes(fixtureDocs)
    const nullTitled = nodes.find(n => n.id === 'runs-1004')
    expect(nullTitled.title).toBeNull()
  })
})

describe('buildChars (pure)', () => {
  test('counts only a–z, lowercase', () => {
    const docs = [
      { neon_id: 'runs-a', sentence: 'AB cd! 99 — ee', title: null },
    ]
    const chars = buildChars(docs)
    expect(chars.a).toBe(1)
    expect(chars.b).toBe(1)
    expect(chars.c).toBe(1)
    expect(chars.d).toBe(1)
    expect(chars.e).toBe(2)
    // No digits, punctuation, whitespace, em-dashes
    expect(chars['9']).toBeUndefined()
    expect(chars['!']).toBeUndefined()
    expect(chars[' ']).toBeUndefined()
  })

  test('returns all 26 letters as keys (zero counts allowed)', () => {
    const chars = buildChars([
      { neon_id: 'runs-a', sentence: 'a', title: null },
    ])
    for (const code of 'abcdefghijklmnopqrstuvwxyz') {
      expect(chars).toHaveProperty(code)
      expect(typeof chars[code]).toBe('number')
    }
    expect(Object.keys(chars).length).toBe(26)
  })

  test('totals across the fixture corpus are sensible', () => {
    const chars = buildChars(fixtureDocs)
    const total = Object.values(chars).reduce((a, b) => a + b, 0)
    // Sentence + title combined character count, lowercase letters only
    let expected = 0
    for (const d of fixtureDocs) {
      const text = `${d.sentence} ${d.title || ''}`.toLowerCase()
      for (const ch of text) if (ch >= 'a' && ch <= 'z') expected++
    }
    expect(total).toBe(expected)
    expect(total).toBeGreaterThan(100)
  })
})

describe('buildGraph (integration)', () => {
  const client = makeTestClient()

  beforeAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await createIndex(client, INDEX)
    await indexDocs(client, INDEX, fixtureDocs)
    await client.indices.refresh({ index: INDEX })
  })

  afterAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await client.close()
  })

  test('returns object with one key per indexed doc', async () => {
    const graph = await buildGraph(client, INDEX)
    expect(Object.keys(graph).sort()).toEqual(
      fixtureDocs.map(d => d.neon_id).sort()
    )
  })

  test('each value is an array of {id, score} of length <= 5', async () => {
    const graph = await buildGraph(client, INDEX)
    for (const [neonId, neighbors] of Object.entries(graph)) {
      expect(Array.isArray(neighbors)).toBe(true)
      expect(neighbors.length).toBeLessThanOrEqual(5)
      for (const n of neighbors) {
        expect(typeof n.id).toBe('string')
        expect(typeof n.score).toBe('number')
        expect(n.id).not.toBe(neonId) // never self-references
      }
    }
  })

  test('every neighbor id is itself a key in the graph', async () => {
    const graph = await buildGraph(client, INDEX)
    const allKeys = new Set(Object.keys(graph))
    for (const neighbors of Object.values(graph)) {
      for (const n of neighbors) {
        expect(allKeys.has(n.id)).toBe(true)
      }
    }
  })
})

describe('precomputeAll (end-to-end)', () => {
  const client = makeTestClient()
  let outDir

  beforeAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await createIndex(client, INDEX)
    await indexDocs(client, INDEX, fixtureDocs)
    await client.indices.refresh({ index: INDEX })

    outDir = join(tmpdir(), `precompute-test-${Date.now()}`)
    await mkdir(outDir, { recursive: true })
    await precomputeAll({ client, index: INDEX, outDir })
  })

  afterAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await client.close()
    if (outDir) await rm(outDir, { recursive: true, force: true })
  })

  test('writes nodes.json with metadata for every doc', async () => {
    const data = JSON.parse(await readFile(join(outDir, 'nodes.json'), 'utf8'))
    expect(data.length).toBe(fixtureDocs.length)
    expect(data.map(n => n.id).sort()).toEqual(
      fixtureDocs.map(d => d.neon_id).sort()
    )
    for (const n of data) {
      expect(n).toHaveProperty('sentence')
      expect(n).toHaveProperty('style_mode')
      expect(n).toHaveProperty('length')
    }
  })

  test('writes graph.json with one key per fixture doc', async () => {
    const data = JSON.parse(await readFile(join(outDir, 'graph.json'), 'utf8'))
    expect(Object.keys(data).sort()).toEqual(fixtureDocs.map(d => d.neon_id).sort())
  })

  test('writes words.json with stopwords excluded and content words present', async () => {
    const data = JSON.parse(await readFile(join(outDir, 'words.json'), 'utf8'))
    expect(data.surface).toBe(4)
    expect(data.the).toBeUndefined()
  })

  test('writes word-index.json keyed identically to words.json', async () => {
    const words = JSON.parse(await readFile(join(outDir, 'words.json'), 'utf8'))
    const idx = JSON.parse(await readFile(join(outDir, 'word-index.json'), 'utf8'))
    expect(new Set(Object.keys(words))).toEqual(new Set(Object.keys(idx)))
    expect(idx.surface.length).toBe(3)
  })

  test('writes chars.json with 26 lowercase letter keys', async () => {
    const data = JSON.parse(await readFile(join(outDir, 'chars.json'), 'utf8'))
    expect(Object.keys(data).length).toBe(26)
    for (const code of 'abcdefghijklmnopqrstuvwxyz') {
      expect(data).toHaveProperty(code)
    }
  })
})
