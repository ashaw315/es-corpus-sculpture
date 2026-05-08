import { describe, test, expect, beforeAll } from '@jest/globals'
import { GET } from '../app/api/search/route.js'

// Tests run against the live local `sentences` index — populated in Step 3
// with the 44 real Neon rows. We do not seed `sentences-test` here because
// the route handler reads from the production index name. The corpus is
// stable enough (and small enough) that asserting on aggregate behavior
// rather than specific document IDs keeps tests robust.

function makeRequest(path) {
  return new Request(`http://localhost:3000${path}`)
}

async function callGet(path) {
  const res = await GET(makeRequest(path))
  expect(res.status).toBe(200)
  return res.json()
}

describe('GET /api/search', () => {
  beforeAll(async () => {
    // Sanity: corpus must be populated for these tests to be meaningful.
    const { Client } = await import('@opensearch-project/opensearch')
    const client = new Client({ node: 'http://localhost:9200' })
    const { body } = await client.count({ index: 'sentences' })
    if (body.count < 10) {
      throw new Error(
        `sentences index has ${body.count} docs — run \`node scripts/sync-to-es.mjs\` first`
      )
    }
    await client.close()
  })

  test('returns top-level shape { hits, aggregations, total }', async () => {
    const data = await callGet('/api/search?q=surface')
    expect(data).toHaveProperty('hits')
    expect(data).toHaveProperty('aggregations')
    expect(data).toHaveProperty('total')
    expect(Array.isArray(data.hits)).toBe(true)
    expect(typeof data.total).toBe('number')
  })

  test('q=surface returns hits (corpus has known matches)', async () => {
    const data = await callGet('/api/search?q=surface')
    expect(data.total).toBeGreaterThan(0)
    expect(data.hits.length).toBeGreaterThan(0)
  })

  test('each hit carries id, score, and all source fields', async () => {
    const data = await callGet('/api/search?q=surface')
    const hit = data.hits[0]
    expect(hit).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        score: expect.any(Number),
        sentence: expect.any(String),
        // title may be null for some docs — assert presence, not type
        date: expect.any(String),
        style_mode: expect.any(String),
      })
    )
    // Presence (value can be null)
    expect('title' in hit).toBe(true)
    expect('mode' in hit).toBe(true)
    expect('artifact_url' in hit).toBe(true)
  })

  test('aggregations.over_time.buckets is an array', async () => {
    const data = await callGet('/api/search?q=surface')
    expect(Array.isArray(data.aggregations?.over_time?.buckets)).toBe(true)
  })

  test('empty q returns empty hits without erroring', async () => {
    const data = await callGet('/api/search')
    expect(data.hits).toEqual([])
  })

  describe('style_mode filter', () => {
    test('q=light filters to LIMINAL: every hit has style_mode === "LIMINAL"', async () => {
      const filtered = await callGet('/api/search?q=light&style_mode=LIMINAL')
      expect(filtered.total).toBeGreaterThan(0)
      for (const hit of filtered.hits) {
        expect(hit.style_mode).toBe('LIMINAL')
      }
    })

    test('filter genuinely narrows: filtered total < unfiltered total', async () => {
      const unfiltered = await callGet('/api/search?q=light')
      const filtered = await callGet('/api/search?q=light&style_mode=LIMINAL')
      expect(filtered.total).toBeLessThan(unfiltered.total)
    })
  })
})
