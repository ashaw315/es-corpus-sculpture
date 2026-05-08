import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { rowToDoc, indexDocs } from '../scripts/sync-to-es.mjs'
import { createIndex } from '../scripts/create-index.mjs'
import { makeTestClient, deleteIndexIfExists } from './setup.mjs'
import { fixtureRuns } from './fixtures/runs.js'

const INDEX = 'sentences-test'

describe('sync-to-es.mjs', () => {
  const client = makeTestClient()

  beforeAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await createIndex(client, INDEX)
  })

  afterAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await client.close()
  })

  describe('rowToDoc', () => {
    test('formats date as yyyy-MM-dd', () => {
      const doc = rowToDoc(fixtureRuns[0])
      expect(doc.date).toBe('2025-11-01')
    })

    test('prefixes neon_id with "runs-"', () => {
      const doc = rowToDoc(fixtureRuns[0])
      expect(doc.neon_id).toBe('runs-1001')
    })

    test('prefers datamosh_url over video_url for artifact_url', () => {
      const doc = rowToDoc(fixtureRuns[0]) // both set
      expect(doc.artifact_url).toBe('https://example.com/v1-mosh.mp4')
    })

    test('falls back to video_url when datamosh_url is null', () => {
      const doc = rowToDoc(fixtureRuns[1]) // datamosh_url null
      expect(doc.artifact_url).toBe('https://example.com/v2.mp4')
    })

    test('preserves null title', () => {
      const doc = rowToDoc(fixtureRuns[3]) // title: null
      expect(doc.title).toBeNull()
    })

    test('carries through mode and style_mode', () => {
      const doc = rowToDoc(fixtureRuns[2])
      expect(doc.mode).toBe(1)
      expect(doc.style_mode).toBe('SENSORY/TEXTURAL')
    })
  })

  describe('indexDocs (bulk upsert against sentences-test)', () => {
    test('indexes all fixture rows; _count equals fixture length', async () => {
      const docs = fixtureRuns.map(rowToDoc)
      await indexDocs(client, INDEX, docs)
      await client.indices.refresh({ index: INDEX })

      const { body } = await client.count({ index: INDEX })
      expect(body.count).toBe(fixtureRuns.length)
    })

    test('round-trips field values for a known doc', async () => {
      const { body } = await client.get({ index: INDEX, id: 'runs-1003' })
      expect(body._source).toEqual(
        expect.objectContaining({
          neon_id: 'runs-1003',
          sentence: 'Texture against texture: rough wool dragged across wet glass.',
          title: 'Texture Study',
          date: '2026-01-20',
          mode: 1,
          style_mode: 'SENSORY/TEXTURAL',
          artifact_url: 'https://example.com/v3-mosh.mp4',
        })
      )
    })

    test('handles null title round-trip', async () => {
      const { body } = await client.get({ index: INDEX, id: 'runs-1004' })
      expect(body._source.title).toBeNull()
      expect(body._source.style_mode).toBe('ABSTRACT')
    })

    test('is idempotent — re-running same docs leaves count unchanged', async () => {
      const docs = fixtureRuns.map(rowToDoc)
      await indexDocs(client, INDEX, docs)
      await client.indices.refresh({ index: INDEX })

      const { body } = await client.count({ index: INDEX })
      expect(body.count).toBe(fixtureRuns.length)
    })
  })
})
