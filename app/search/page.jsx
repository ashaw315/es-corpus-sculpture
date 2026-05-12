'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SculptureCanvas from '../../components/SculptureCanvas'
import WordView from '../../components/WordView'
import CharacterView from '../../components/CharacterView'
import LegendStrip from '../../components/LegendStrip'
import { STYLE_FONT, DEFAULT_FONT, PALETTE_SETS } from '../../lib/palette.mjs'

// Steps E + F — Scales 1, 1b, 2, 3, 4. Page owns the navigation state
// machine:
//
//   query                 — beeswarm filter (Scale 1b)
//   selectedId            — Scale 2 anchor sentence
//   selectedWord          — Scale 3 anchor word (lifts above Scale 2)
//   inCharacterView       — Scale 4 character view (lifts above Scale 1)
//
// Escape pops one level. Order: character view → word → sentence → query/net.

const DEBOUNCE_MS = 250

// Lowercased alpha-only key for word-index lookup.
function tokenKey(displayWord) {
  return displayWord.toLowerCase().replace(/[^a-z]/g, '')
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [mltHits, setMltHits] = useState(null)
  const [selectedWord, setSelectedWord] = useState(null)
  const [wordPanel, setWordPanel] = useState('timeline')
  const [inCharacterView, setInCharacterView] = useState(false)
  const [highlightIds, setHighlightIds] = useState(null)
  const [nodesById, setNodesById] = useState(null)
  const [wordIndex, setWordIndex] = useState(null)
  // sessionConfig — palette + RNG seed, chosen once per page load.
  // Server renders deterministic defaults (palette[0], seed=1) so SSR
  // and first hydration agree; the useEffect below swaps in random
  // values once the client has mounted, which avoids the hydration-
  // mismatch class of bugs we hit with module-level Math.random().
  // The Marimekko corpus renderer uses `seed` to shuffle column and
  // row order so each load reads as a different composition.
  const [sessionConfig, setSessionConfig] = useState({
    palette: PALETTE_SETS[0],
    seed: 1,
  })
  const palette = sessionConfig.palette
  const debounceRef = useRef(null)

  useEffect(() => {
    setSessionConfig({
      palette: PALETTE_SETS[Math.floor(Math.random() * PALETTE_SETS.length)],
      seed: Math.floor(Math.random() * 2 ** 32),
    })
  }, [])

  // Load nodes.json + word-index.json once. nodes is needed for sentence
  // lookup (selectedId → MLT body); word-index is needed to know which
  // tokens in the center sentence are clickable content words.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/data/nodes.json').then(r => r.json()),
      fetch('/data/word-index.json').then(r => r.json()),
    ])
      .then(([nodes, wIndex]) => {
        if (cancelled) return
        setNodesById(new Map(nodes.map(n => [n.id, n])))
        setWordIndex(wIndex)
      })
      .catch(err => console.error('static data load failed:', err))
    return () => { cancelled = true }
  }, [])

  // Search query → /api/search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setHits(null)
      return
    }

    const params = new URLSearchParams(window.location.search)
    const wait = params.get('snap') === '1' ? 0 : DEBOUNCE_MS

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        if (!res.ok) throw new Error(`/api/search ${res.status}`)
        const data = await res.json()
        setHits(data.hits || [])
      } catch (err) {
        console.error('search failed:', err)
        setHits([])
      }
    }, wait)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // selectedId → /api/mlt (radial body).
  useEffect(() => {
    if (!selectedId || !nodesById) {
      setMltHits(null)
      return
    }
    const node = nodesById.get(selectedId)
    if (!node) {
      console.warn('selectedId not in corpus:', selectedId)
      setMltHits(null)
      return
    }
    let cancelled = false
    fetch('/api/mlt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence: node.sentence, exclude_id: selectedId }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setMltHits(data.hits || [])
      })
      .catch(err => {
        console.error('mlt fetch failed:', err)
        if (!cancelled) setMltHits([])
      })
    return () => { cancelled = true }
  }, [selectedId, nodesById])

  // URL params for the headless harness:
  //   ?q=light&select=runs-3        — radial entered from beeswarm
  //   ?select=runs-3&word=surface   — Scale 3 from a chosen sentence
  //   ?word=surface&panel=cooccurrence — Scale 3 directly
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const initialQ = params.get('q')
    const initialSelect = params.get('select')
    const initialWord = params.get('word')
    const initialPanel = params.get('panel')
    if (initialQ) setQuery(initialQ)
    if (initialSelect) setSelectedId(initialSelect)
    if (initialWord) setSelectedWord(initialWord.toLowerCase())
    if (initialPanel === 'cooccurrence' || initialPanel === 'timeline') {
      setWordPanel(initialPanel)
    }
    // Scale 4 entry from URL — for screenshot harness and direct deep links.
    if (params.get('scale') === 'characters') setInCharacterView(true)
  }, [])

  // Escape pops one level: characters → word → sentence → search/network.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (inCharacterView) setInCharacterView(false)
      else if (selectedWord) setSelectedWord(null)
      else if (selectedId) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inCharacterView, selectedWord, selectedId])

  const onSelectNode = (id) => {
    setSelectedId(id)
  }
  const onSelectSentence = (id) => {
    // From Panel A pill → Scale 2 for that sentence. Clear word view.
    setSelectedWord(null)
    setSelectedId(id)
  }
  const onPivotWord = (newWord) => {
    setSelectedWord(newWord.toLowerCase())
  }

  const inRadial = selectedId && mltHits && !selectedWord && !inCharacterView
  const inWordView = !!selectedWord && !inCharacterView
  const inScale1 = !inRadial && !inWordView && !inCharacterView
  // Pure network mode = the bare corpus map: no search, no selection, no
  // deeper scale active. Used to gate the "texture →" button so it only
  // shows when there's somewhere to texturize *from*.
  const inNetworkOnly =
    inScale1 && !query && !selectedId && !hits
  const selectedNode = selectedId ? nodesById?.get(selectedId) : null

  // Wrap setHighlightIds in useCallback so the CharacterView's effect dep
  // array doesn't see a fresh function on every render and infinite-loop.
  const onHighlightIds = useCallback((ids) => {
    setHighlightIds(ids ?? null)
  }, [])

  // Per-word renderable spans for the center sentence (Scale 2 only).
  // Splits on whitespace to preserve punctuation, then makes content
  // words clickable based on word-index membership.
  const centerWordSpans = useMemo(() => {
    if (!selectedNode || !wordIndex) return null
    const display = selectedNode.sentence
    return display.split(/(\s+)/).map((chunk, i) => {
      if (/^\s+$/.test(chunk)) return chunk
      const key = tokenKey(chunk)
      const clickable = key.length >= 2 && wordIndex[key]
      return { display: chunk, key, clickable, i }
    })
  }, [selectedNode, wordIndex])

  const centerTreatment =
    selectedNode ? (STYLE_FONT[selectedNode.style_mode] || DEFAULT_FONT) : DEFAULT_FONT

  // ===== Legend-strip content per current view =====
  // Derive the scale name + center label + right-slot control from the
  // existing state. Right-slot is a small monospace control set (a button
  // or an inline toggle); style is consistent with the rest of the strip.
  const totalSentences = nodesById ? nodesById.size : null
  let legendScale = 'corpus'
  let legendCenter = totalSentences ? `${totalSentences} sentences` : ''
  let legendRight = null

  if (inCharacterView) {
    legendScale = 'character'
    legendCenter = 'character frequency'
    legendRight = <span style={{ color: '#9a958c' }}>esc to exit</span>
  } else if (inWordView) {
    legendScale = 'word'
    legendCenter = `word: ${selectedWord}`
    legendRight = (
      <span style={{ display: 'inline-flex', gap: 14 }}>
        <span
          onClick={() => setWordPanel('timeline')}
          style={{
            cursor: 'pointer',
            color: wordPanel === 'timeline' ? '#1a1a1a' : '#9a958c',
          }}
        >timeline</span>
        <span style={{ color: '#9a958c' }}>·</span>
        <span
          onClick={() => setWordPanel('cooccurrence')}
          style={{
            cursor: 'pointer',
            color: wordPanel === 'cooccurrence' ? '#1a1a1a' : '#9a958c',
          }}
        >co-occurrence</span>
      </span>
    )
  } else if (inRadial) {
    legendScale = 'sentence'
    legendCenter = `${selectedId} · ${selectedNode?.style_mode ?? '?'}`
    legendRight = <span style={{ color: '#9a958c' }}>esc to exit</span>
  } else if (query && hits) {
    legendScale = 'corpus'
    legendCenter = `${hits.length} result${hits.length === 1 ? '' : 's'}`
  } else if (inNetworkOnly) {
    // Texture button lives here in pure network mode; relations → arrives in Step IV.
    legendRight = (
      <span
        style={{ cursor: 'pointer', color: '#1a1a1a' }}
        onClick={() => setInCharacterView(true)}
      >texture →</span>
    )
  }

  return (
    <>
      {/* Top-left status / search input (visible across all scales) */}
      <div style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'none',
      }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search corpus…"
          spellCheck={false}
          autoComplete="off"
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid #333',
            color: '#bbb',
            fontFamily: 'monospace',
            fontSize: 13,
            outline: 'none',
            padding: '4px 0',
            width: 280,
            caretColor: '#888',
            pointerEvents: 'auto',
          }}
        />
        {/* View status (result count, radial badge, word badge) lives in
            the legend strip at the bottom — see <LegendStrip> below. */}
      </div>

      {/* Center-sentence HTML overlay — Scale 2 only. Per-word clickable
          spans drive Scale 3 entry. */}
      {inRadial && centerWordSpans && (
        <div
          style={{
            position: 'fixed',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 720, maxHeight: 320,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center',
            color: '#eee',
            fontSize: 22,
            lineHeight: 1.35,
            fontFamily: centerTreatment.family,
            fontStyle: centerTreatment.style,
            pointerEvents: 'none', // wrapper passive; spans opt-in
            zIndex: 5,
            userSelect: 'none',
          }}
        >
          <div>
            {centerWordSpans.map((part, idx) =>
              typeof part === 'string'
                ? <span key={idx}>{part}</span>
                : (
                  <span
                    key={idx}
                    onClick={() => part.clickable && onPivotWord(part.key)}
                    style={{
                      cursor: part.clickable ? 'pointer' : 'default',
                      pointerEvents: part.clickable ? 'auto' : 'none',
                      borderBottom: part.clickable
                        ? '1px dotted rgba(255,255,255,0.18)'
                        : 'none',
                    }}
                  >{part.display}</span>
                )
            )}
          </div>
        </div>
      )}

      {/* The "texture →" button moved to the legend strip's right slot
          in network mode. See <LegendStrip> below. */}

      {/* Scene rendering. WordView fully replaces the canvas. CharacterView
          overlays the dimmed canvas as a backdrop. */}
      {inWordView ? (
        <WordView
          word={selectedWord}
          panel={wordPanel}
          onSelectSentence={onSelectSentence}
          onPivotWord={onPivotWord}
          onSetPanel={setWordPanel}
          palette={palette}
        />
      ) : (
        <>
          <SculptureCanvas
            query={inCharacterView ? '' : query}
            hits={inCharacterView ? null : hits}
            selectedId={inCharacterView ? null : selectedId}
            mltHits={inCharacterView ? null : mltHits}
            onSelect={onSelectNode}
            dim={inCharacterView}
            highlightIds={inCharacterView ? highlightIds : null}
            sessionConfig={sessionConfig}
          />
          {inCharacterView && (
            <CharacterView
              mode="histogram"
              onHighlightIds={onHighlightIds}
            />
          )}
        </>
      )}

      <LegendStrip
        scale={legendScale}
        centerLabel={legendCenter}
        right={legendRight}
        palette={palette}
      />
    </>
  )
}
