import { Client } from '@opensearch-project/opensearch'

const client = new Client({
  node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
  auth: process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined,
})

const INDEX = 'sentences'

export async function GET() {
  const response = await client.search({
    index: INDEX,
    body: {
      size: 0,
      aggs: {
        min_date: { min: { field: 'date' } },
        max_date: { max: { field: 'date' } },
      },
    },
  })

  const body = response.body ?? response
  return Response.json({
    min: body.aggregations.min_date.value_as_string ?? null,
    max: body.aggregations.max_date.value_as_string ?? null,
  })
}
