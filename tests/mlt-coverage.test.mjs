import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { POST } from '../app/api/mlt/route.js'
import { Client } from '@opensearch-project/opensearch'

// Step 6 verification: every sentence in the live `sentences` index must
// return at least MIN_HITS MLT results when its own document is excluded.
// This guards against MLT params that return 0 or near-0 hits on a small
// corpus.

const MIN_HITS = 3

function makeRequest(body) {
  return new Request('http://localhost:3000/api/mlt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callMlt(body) {
  const res = await POST(makeRequest(body))
  expect(res.status).toBe(200)
  return res.json()
}

describe('MLT corpus coverage', () => {
  let client
  let allDocs

  beforeAll(async () => {
    client = new Client({ node: 'http://localhost:9200' })
    // Pull every doc — small corpus, single page is fine.
    const { body } = await client.search({
      index: 'sentences',
      body: { size: 200, query: { match_all: {} }, _source: ['neon_id', 'sentence'] },
    })
    allDocs = body.hits.hits.map(h => ({ id: h._id, sentence: h._source.sentence }))
    if (allDocs.length < 10) {
      throw new Error(`expected populated corpus, got ${allDocs.length} docs`)
    }
  })

  afterAll(async () => {
    await client.close()
  })

  test(`every doc returns at least ${MIN_HITS} MLT hits (excluding self)`, async () => {
    const failures = []
    for (const doc of allDocs) {
      const data = await callMlt({ sentence: doc.sentence, exclude_id: doc.id })
      if (data.hits.length < MIN_HITS) {
        failures.push({ id: doc.id, hits: data.hits.length })
      }
    }
    if (failures.length > 0) {
      // Build a readable diagnostic — easier than scrolling jest output
      const summary = failures.map(f => `${f.id}: ${f.hits} hits`).join('\n  ')
      throw new Error(
        `${failures.length}/${allDocs.length} docs returned < ${MIN_HITS} MLT hits:\n  ${summary}`
      )
    }
    expect(failures).toEqual([])
  }, 60_000)
})
