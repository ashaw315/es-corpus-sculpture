import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { createIndex } from '../scripts/create-index.mjs'
import { makeTestClient, deleteIndexIfExists } from './setup.mjs'

const INDEX = 'sentences-test'

describe('create-index.mjs', () => {
  const client = makeTestClient()

  beforeAll(async () => {
    await deleteIndexIfExists(client, INDEX)
  })

  afterAll(async () => {
    await deleteIndexIfExists(client, INDEX)
    await client.close()
  })

  test('creates index with all required fields and correct types', async () => {
    await createIndex(client, INDEX)

    const { body: existsBody } = await client.indices.exists({ index: INDEX })
    expect(existsBody).toBe(true)

    const { body: mappingBody } = await client.indices.getMapping({ index: INDEX })
    const props = mappingBody[INDEX].mappings.properties

    expect(props.sentence).toEqual(
      expect.objectContaining({ type: 'text', analyzer: 'sentence_analyzer' })
    )
    expect(props.title).toEqual(
      expect.objectContaining({ type: 'text', analyzer: 'sentence_analyzer' })
    )
    expect(props.date).toEqual(
      expect.objectContaining({ type: 'date', format: 'yyyy-MM-dd' })
    )
    expect(props.mode).toEqual(expect.objectContaining({ type: 'integer' }))
    expect(props.style_mode).toEqual(expect.objectContaining({ type: 'keyword' }))
    expect(props.artifact_url).toEqual(
      expect.objectContaining({ type: 'keyword', index: false })
    )
    expect(props.neon_id).toEqual(expect.objectContaining({ type: 'keyword' }))
  })

  test('configures custom sentence_analyzer (standard tokenizer + lowercase/stop/snowball)', async () => {
    // Index already created by previous test
    const { body: settingsBody } = await client.indices.getSettings({ index: INDEX })
    const analysis = settingsBody[INDEX].settings.index.analysis
    expect(analysis.analyzer.sentence_analyzer).toEqual(
      expect.objectContaining({
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'stop', 'snowball'],
      })
    )
  })

  test('uses 0 replicas (required for Bonsai free tier)', async () => {
    const { body: settingsBody } = await client.indices.getSettings({ index: INDEX })
    expect(settingsBody[INDEX].settings.index.number_of_replicas).toBe('0')
  })
})
