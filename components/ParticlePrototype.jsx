'use client'

import { useEffect, useRef } from 'react'

// Step F Mode B prototype. Tests whether HTML5 Canvas can sustain 30+ FPS
// at the target particle counts. The animation is intentionally simple
// (drift + retarget) so what we're measuring is rendering throughput, not
// algorithmic complexity. Particle count is controllable via prop so we
// can step from 100 → 10k and check at each level.

export default function ParticlePrototype({ particleCount = 100 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = W
    canvas.height = H

    // Build the particle pool. Each one drifts from its current (x,y)
    // toward a target (tx,ty); when it gets close, a new target is set.
    const particles = []
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        tx: Math.random() * W,
        ty: Math.random() * H,
        // Hue per-particle stays constant so the cloud reads as a palette.
        hue: Math.random() * 360,
      })
    }

    const ctx = canvas.getContext('2d')
    let raf = null
    let lastTs = performance.now()
    let frameTimes = []
    const FRAME_AVG_WINDOW = 60
    let stopped = false

    let allFrames = [] // for "average over the run" reporting

    function frame(_ts) {
      if (stopped) return
      // Use performance.now() not the RAF timestamp — under headless
      // virtual-time the RAF arg is a virtual clock, but performance.now()
      // (when not also virtualized) reflects real wall time. Either way,
      // for an interactive browser this is straightforward real-time FPS.
      const now = performance.now()
      const dt = now - lastTs
      lastTs = now
      const fpsNow = 1000 / dt
      frameTimes.push(fpsNow)
      if (frameTimes.length > FRAME_AVG_WINDOW) frameTimes.shift()
      allFrames.push(fpsNow)

      // Update positions
      for (const p of particles) {
        p.x += (p.tx - p.x) * 0.04
        p.y += (p.ty - p.y) * 0.04
        if (Math.hypot(p.tx - p.x, p.ty - p.y) < 4) {
          p.tx = Math.random() * W
          p.ty = Math.random() * H
        }
      }

      // Draw: black trail (low alpha) for a fade effect, then particles.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
      ctx.fillRect(0, 0, W, H)
      for (const p of particles) {
        ctx.fillStyle = `hsl(${p.hue}, 65%, 60%)`
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }

      // Bake the FPS readout straight into the canvas so headless screenshots
      // can capture the perf number without needing console-log scraping.
      if (frameTimes.length === FRAME_AVG_WINDOW) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
        // Solid black background under the text so it remains readable
        // through the trail layer even after many frames.
        ctx.fillStyle = 'rgba(0, 0, 0, 1)'
        ctx.fillRect(W - 360, H - 60, 340, 40)
        ctx.fillStyle = '#fff'
        ctx.font = '20px monospace'
        ctx.textAlign = 'right'
        ctx.fillText(
          `particles: ${particleCount} · fps: ${Math.round(avg)}`,
          W - 30, H - 32
        )
      }

      // Periodic console FPS log — useful for headless perf capture and
      // for the dev console while tuning particle counts.
      if (frameTimes.length === FRAME_AVG_WINDOW
          && allFrames.length % 60 === 0) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
        // eslint-disable-next-line no-console
        console.log(`particles=${particleCount} avgFps=${Math.round(avg)}`)
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      // Report a final average across the full run window
      if (allFrames.length) {
        const tail = allFrames.slice(-Math.min(allFrames.length, 300))
        const avg = tail.reduce((a, b) => a + b, 0) / tail.length
        // eslint-disable-next-line no-console
        console.log(`final particles=${particleCount} avgFpsLast=${Math.round(avg)}`)
      }
    }
  }, [particleCount])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed', inset: 0,
          width: '100%', height: '100%',
          display: 'block',
          background: '#000',
          pointerEvents: 'none',
        }}
      />
      {/* The fps + particle-count readout is baked into the canvas itself
          (see ctx.fillText in the draw loop). One indicator is enough. */}
    </>
  )
}
