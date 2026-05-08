// Shared helpers for ES integration tests.
// Tests run against the local Docker OpenSearch — never against Bonsai.
import { Client } from '@opensearch-project/opensearch'

export const TEST_NODE = process.env.TEST_OPENSEARCH_URL || 'http://localhost:9200'

export function makeTestClient() {
  return new Client({ node: TEST_NODE })
}

export async function deleteIndexIfExists(client, index) {
  try {
    await client.indices.delete({ index })
  } catch (e) {
    // 404 is fine — index didn't exist
    if (e?.meta?.statusCode !== 404) throw e
  }
}
