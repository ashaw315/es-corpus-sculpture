'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SculptureCanvas from '../../components/SculptureCanvas'
import WordView from '../../components/WordView'
import CharacterView from '../../components/CharacterView'
import ParticlePrototype from '../../components/ParticlePrototype'

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

// Same per-style typography as the canvas's ring labels — the center
// sentence overlay matches its style_mode treatment.
const STYLE_FONT = {
  'LIMINAL':           { family: 'Georgia, serif',          style: 'italic' },
  'SENSORY/TEXTURAL':  { family: '"Courier New", monospace', style: 'normal' },
  'ABSTRACT':          { family: 'Impact, "Arial Narrow", sans-serif', style: 'normal' },
  'REPLETE':           { family: 'system-ui, sans-serif',    style: 'normal' },
  'REPRESENTATIONAL':  { family: 'system-ui, sans-serif',    style: 'normal' },
  'GLITCH/SYSTEM':     { family: '"Courier New", monospace', style: 'normal' },
}
const DEFAULT_FONT = { family: 'system-ui, sans-serif', style: 'normal' }

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
  const [characterMode, setCharacterMode] = useState('histogram') // or 'particles'
  const [particleCount, setParticleCount] = useState(100)
  const [highlightIds, setHighlightIds] = useState(null)
  const [nodesById, setNodesById] = useState(null)
  const [wordIndex, setWordIndex] = useState(null)
  const debounceRef = useRef(null)

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
    const initialMode = params.get('mode')
    if (initialMode === 'particles' || initialMode === 'histogram') {
      setCharacterMode(initialMode)
    }
    const pCount = Number(params.get('particles'))
    if (Number.isFinite(pCount) && pCount > 0) setParticleCount(pCount)
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
        {query && hits && !inRadial && !inWordView && (
          <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 11 }}>
            {hits.length} result{hits.length === 1 ? '' : 's'}
          </div>
        )}
        {inRadial && (
          <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 11 }}>
            {selectedId} · {selectedNode?.style_mode ?? '?'} · esc to exit
          </div>
        )}
        {inWordView && (
          <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 11 }}>
            word: {selectedWord} · esc to return
          </div>
        )}
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

      {/* "texture" button — visible only in Scale 1 (network/beeswarm/radial)
          since Scale 3 already takes over the chrome. Subtle, low-contrast. */}
      {!inWordView && !inCharacterView && (
        <div style={{
          position: 'fixed',
          top: 18,
          right: 24,
          zIndex: 10,
          color: '#555',
          fontFamily: 'monospace',
          fontSize: 12,
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
          onClick={() => setInCharacterView(true)}
        >
          texture →
        </div>
      )}

      {/* Scene rendering. WordView fully replaces the canvas. CharacterView
          overlays the dimmed canvas as a backdrop. */}
      {inWordView ? (
        <WordView
          word={selectedWord}
          panel={wordPanel}
          onSelectSentence={onSelectSentence}
          onPivotWord={onPivotWord}
          onSetPanel={setWordPanel}
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
          />
          {inCharacterView && characterMode === 'histogram' && (
            <CharacterView
              mode="histogram"
              onHighlightIds={onHighlightIds}
            />
          )}
          {inCharacterView && characterMode === 'particles' && (
            <ParticlePrototype particleCount={particleCount} />
          )}
          {/* Single mode toggle for Scale 4, positioned consistently with
              the other top-right chrome regardless of which Mode is active. */}
          {inCharacterView && (
            <div style={{
              position: 'fixed', top: 18, right: 24,
              fontFamily: 'monospace', fontSize: 12,
              color: '#555', zIndex: 11, pointerEvents: 'auto',
            }}>
              <span
                style={{
                  cursor: 'pointer',
                  color: characterMode === 'histogram' ? '#ddd' : '#555',
                }}
                onClick={() => setCharacterMode('histogram')}
              >histogram</span>
              <span style={{ color: '#333', margin: '0 8px' }}>·</span>
              <span
                style={{
                  cursor: 'pointer',
                  color: characterMode === 'particles' ? '#ddd' : '#555',
                }}
                onClick={() => setCharacterMode('particles')}
              >particles</span>
            </div>
          )}
          {inCharacterView && (
            <div style={{
              position: 'fixed', top: 56, left: 16,
              color: '#666', fontFamily: 'monospace', fontSize: 11,
              zIndex: 10, pointerEvents: 'none',
            }}>
              scale 4: characters · esc to return
            </div>
          )}
        </>
      )}
    </>
  )
}
