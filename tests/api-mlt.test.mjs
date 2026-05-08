import { describe, test, expect, beforeAll } from '@jest/globals'
import { POST } from '../app/api/mlt/route.js'

// Tests run against the live local `sentences` index (44 docs from Step 3).
// We seed against `runs-3`, which uses common vocabulary ("surface",
// "translucent", "geometric") that appears in multiple sibling docs.

const SEED_ID = 'runs-3'

function makeRequest(body) {
  return new Request('http://localhost:3000/api/mlt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callPost(body) {
  const res = await POST(makeRequest(body))
  expect(res.status).toBe(200)
  return res.json()
}

describe('POST /api/mlt', () => {
  let seedSentence

  beforeAll(async () => {
    const { Client } = await import('@opensearch-project/opensearch')
    const client = new Client({ node: 'http://localhost:9200' })
    const { body } = await client.count({ index: 'sentences' })
    if (body.count < 10) {
      throw new Error(
        `sentences index has ${body.count} docs — run \`node scripts/sync-to-es.mjs\` first`
      )
    }
    const { body: doc } = await client.get({ index: 'sentences', id: SEED_ID })
    seedSentence = doc._source.sentence
    await client.close()
  })

  test('returns at least 1 hit for a known corpus sentence', async () => {
    const data = await callPost({ sentence: seedSentence })
    expect(Array.isArray(data.hits)).toBe(true)
    expect(data.hits.length).toBeGreaterThanOrEqual(1)
  })

  test('each hit has id, score, and full source fields', async () => {
    const data = await callPost({ sentence: seedSentence })
    const hit = data.hits[0]
    expect(hit).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        score: expect.any(Number),
        sentence: expect.any(String),
        date: expect.any(String),
        style_mode: expect.any(String),
      })
    )
    expect('title' in hit).toBe(true)
    expect('mode' in hit).toBe(true)
    expect('artifact_url' in hit).toBe(true)
  })

  test('exclude_id removes the source document from results', async () => {
    const without = await callPost({ sentence: seedSentence })
    // Without exclude, the seed itself can appear (it matches itself).
    const seedAppearsInResults = without.hits.some(h => h.id === SEED_ID)

    const withExclude = await callPost({ sentence: seedSentence, exclude_id: SEED_ID })
    expect(withExclude.hits.every(h => h.id !== SEED_ID)).toBe(true)

    // Sanity: excluding actually drops a hit (only meaningful if it would have appeared)
    if (seedAppearsInResults) {
      expect(withExclude.hits.length).toBeLessThanOrEqual(without.hits.length)
    }
  })

  test('empty body returns empty hits gracefully', async () => {
    const data = await callPost({})
    expect(data.hits).toEqual([])
  })
})
