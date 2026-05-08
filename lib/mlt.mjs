// Shared MLT query parameters + executor.
// Both the live /api/mlt route and scripts/precompute-graph.mjs use this so
// the graph baked at build time matches what the runtime API would return.
//
// Tuned so every doc in the corpus returns >= 3 hits (Step 6 verification).
// Defaults (min_term_freq=2, min_doc_freq=5, max_query_terms=25) leave most
// docs with 0-2 hits at this scale; raising max_query_terms to 50 and
// minimum_should_match to 1 covers outlier sentences (e.g. runs-62
// "lions/champagne") without making MLT meaningless on common ones.

export const MLT_PARAMS = {
  min_term_freq:        1,
  min_doc_freq:         1,
  max_query_terms:      50,
  boost_terms:          1.5,
  minimum_should_match: 1,
}

export const MLT_FIELDS = ['sentence', 'title']

export function buildMltQuery({ sentence, excludeId, index, size = 10 }) {
  return {
    size,
    query: {
      more_like_this: {
        fields: MLT_FIELDS,
        like: sentence,
        ...MLT_PARAMS,
        ...(excludeId
          ? { unlike: [{ _index: index, _id: excludeId }] }
          : {}),
      },
    },
  }
}

// Run an MLT search and shape the response into [{ id, score, ...source }].
export async function runMlt(client, { index, sentence, excludeId, size = 10 }) {
  if (!sentence) return []

  const body = buildMltQuery({ sentence, excludeId, index, size })
  const response = await client.search({ index, body })
  const result = response.body ?? response

  return result.hits.hits
    .map(h => ({ id: h._id, score: h._score, ...h._source }))
    // Defensive: also drop the excluded id in case `unlike` doesn't fully
    // suppress it (depends on MLT internals).
    .filter(h => !excludeId || h.id !== excludeId)
}
