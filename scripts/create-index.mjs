import { Client } from '@opensearch-project/opensearch'
import { fileURLToPath } from 'url'

export async function createIndex(client, index = 'sentences') {
  await client.indices.create({
    index,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            sentence_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop', 'snowball'],
            },
          },
        },
      },
      mappings: {
        properties: {
          sentence:     { type: 'text', analyzer: 'sentence_analyzer' },
          title:        { type: 'text', analyzer: 'sentence_analyzer' },
          date:         { type: 'date', format: 'yyyy-MM-dd' },
          mode:         { type: 'integer' },
          style_mode:   { type: 'keyword' },
          artifact_url: { type: 'keyword', index: false },
          neon_id:      { type: 'keyword' },
        },
      },
    },
  })
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isDirectRun) {
  const node = process.env.OPENSEARCH_URL || 'http://localhost:9200'
  const auth = process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined
  const indexName = process.env.INDEX || 'sentences'

  const client = new Client({ node, auth })
  try {
    await createIndex(client, indexName)
    console.log(`Index "${indexName}" created at ${node}`)
  } finally {
    await client.close()
  }
}
