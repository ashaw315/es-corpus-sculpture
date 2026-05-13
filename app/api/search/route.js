import { Client } from '@opensearch-project/opensearch'

const client = new Client({
  node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
  auth: process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined,
})

const INDEX = 'sentences'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')
  const style_mode = searchParams.get('style_mode')

  if (!q) {
    return Response.json({ hits: [], aggregations: {}, total: 0 })
  }

  const response = await client.search({
    index: INDEX,
    body: {
      size: 12,
      query: {
        bool: {
          // must: fuzzy multi_match against sentence + title.
          // prefix_length:0 lets fuzziness apply from the very first
          // character so "test" still matches "testing"/"tests" even
          // when the analyzer tokenization wouldn't otherwise hit.
          must: {
            multi_match: {
              query: q,
              fields: ['sentence', 'title'],
              fuzziness: 'AUTO',
              prefix_length: 0,
            },
          },
          // should: any term in the sentence that starts with the
          // query string. Catches mid-typing prefixes that the fuzzy
          // multi_match misses (e.g. "test" not finding a sentence
          // that has "testify" if no other token loosely matches).
          should: [
            { prefix: { sentence: q.toLowerCase() } },
          ],
          minimum_should_match: 0,
          ...(style_mode ? { filter: [{ term: { style_mode } }] } : {}),
        },
      },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'date',
            calendar_interval: 'month',
          },
        },
      },
    },
  })

  // OpenSearch JS v3 returns parsed body directly; v2 wraps in { body }.
  const body = response.body ?? response
  const totalRaw = body.hits.total
  const total = typeof totalRaw === 'number' ? totalRaw : totalRaw.value

  return Response.json({
    hits: body.hits.hits.map(h => ({
      id: h._id,
      score: h._score,
      ...h._source,
    })),
    aggregations: body.aggregations,
    total,
  })
}
