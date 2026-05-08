import 'dotenv/config'
import { config as loadDotenv } from 'dotenv'
import { Client } from '@opensearch-project/opensearch'
import { fileURLToPath } from 'url'

// Next.js convention: .env.local overrides .env. Load it explicitly so this
// script picks up the same values the dev server uses.
loadDotenv({ path: '.env.local', override: true })

export function rowToDoc(r) {
  return {
    neon_id:      `runs-${r.id}`,
    sentence:     r.sentence,
    title:        r.title ?? null,
    date:         r.date.toISOString().split('T')[0],
    mode:         r.mode ?? null,
    style_mode:   r.style_mode ?? null,
    artifact_url: r.datamosh_url ?? r.video_url ?? null,
  }
}

export async function indexDocs(client, index, docs) {
  if (docs.length === 0) return { indexed: 0, errors: [] }

  const operations = docs.flatMap(doc => [
    { update: { _index: index, _id: doc.neon_id } },
    { doc, doc_as_upsert: true },
  ])

  // refresh: 'wait_for' blocks until newly-indexed docs are visible to search,
  // so any caller that runs precompute right after sync sees a consistent
  // corpus. Without this, the next /_search can miss just-indexed docs and
  // emit an inconsistent graph (precompute fetches twice — see CLAUDE.md).
  const response = await client.bulk({ refresh: 'wait_for', body: operations })
  // OpenSearch JS v3 returns the parsed body directly; v2 wraps in { body }.
  const result = response.body ?? response

  const errors = result.items.filter(i => i.update?.error)
  return { indexed: docs.length - errors.length, errors }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isDirectRun) {
  const dryRun = process.env.DRY_RUN === 'true'
  const node = process.env.OPENSEARCH_URL || 'http://localhost:9200'
  const auth = process.env.OPENSEARCH_USERNAME
    ? { username: process.env.OPENSEARCH_USERNAME, password: process.env.OPENSEARCH_PASSWORD }
    : undefined
  const indexName = process.env.INDEX || 'sentences'

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL)

  try {
    const rows = await sql`
      SELECT id, date, sentence, video_url, datamosh_url, mode, style_mode, title
      FROM runs
      WHERE sentence IS NOT NULL
      ORDER BY date DESC
    `
    const docs = rows.map(rowToDoc)
    console.log(`Fetched ${rows.length} rows from Neon`)

    if (dryRun) {
      console.log('--- DRY RUN: first 3 docs ---')
      for (const doc of docs.slice(0, 3)) console.log(JSON.stringify(doc, null, 2))
      console.log(`--- DRY RUN: total docs = ${docs.length}, no indexing performed ---`)
    } else {
      const client = new Client({ node, auth })
      try {
        const { indexed, errors } = await indexDocs(client, indexName, docs)
        if (errors.length) console.error('Bulk errors:', errors)
        console.log(`Synced ${indexed} documents to "${indexName}" at ${node}`)
      } finally {
        await client.close()
      }
    }
  } finally {
    await sql.end()
  }
}
