import { Client } from '@opensearch-project/opensearch'
import { runMlt } from '../../../lib/mlt.mjs'

const client = new Client({
  node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
  auth: process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined,
})

const INDEX = 'sentences'

export async function POST(request) {
  const { sentence, exclude_id } = await request.json().catch(() => ({}))

  if (!sentence) {
    return Response.json({ hits: [] })
  }

  const hits = await runMlt(client, {
    index: INDEX,
    sentence,
    excludeId: exclude_id,
    size: 10,
  })

  return Response.json({ hits })
}
