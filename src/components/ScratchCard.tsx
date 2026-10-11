import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { money } from '../lib/chart'
import { scratchTick } from '../lib/feedback'
import { BackIcon, CheckCircle, LockIcon } from './Icons'

type Props = {
  amount: number
  /** Where the tapped square sits on screen, so the card can grow out of it. */
  from: DOMRect | null
  onClose: () => void
  onFirstScratch: () => void
  onComplete: () => void
}

const CLEAR_THRESHOLD = 0.55

export function ScratchCard({ amount, from, onClose, onFirstScratch, onComplete }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [locked, setLocked] = useState(false)
  const [gone, setGone] = useState(false)
  const [pct, setPct] = useState(0)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const moves = useRef(0)
  const finished = useRef(false)
  const lockedRef = useRef(false)

  // Grow out of the tapped square.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !from || !card.animate) return
    const r = card.getBoundingClientRect()
    const dx = from.left + from.width / 2 - (r.left + r.width / 2)
    const dy = from.top + from.height / 2 - (r.top + r.height / 2)
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.15, from.width / r.width)})`, opacity: 0.5 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 360, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' },
    )
  }, [from])

  // Paint the foil.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      // offsetWidth ignores the grow-in animation's scale transform.
      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.globalCompositeOperation = 'source-over'
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      g.addColorStop(0, '#C9CFC7')
      g.addColorStop(0.5, '#B4BBB2')
      g.addColorStop(1, '#C6CCC4')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      const step = 7 * dpr
      for (let y = step / 2; y < canvas.height; y += step)
        for (let x = (y / step) % 2 ? step / 2 : step; x < canvas.width; x += step) ctx.fillRect(x, y, dpr, dpr)
      ctx.fillStyle = '#2F3A33'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${16 * dpr}px 'DM Sans', system-ui, sans-serif`
      ctx.fillText('Scratch here with your finger', canvas.width / 2, canvas.height / 2 + 14 * dpr)
      ctx.lineWidth = 2 * dpr
      ctx.strokeStyle = '#2F3A33'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (const off of [-22, -12]) {
        const cy = canvas.height / 2 + off * dpr
        const cx = canvas.width / 2
        ctx.moveTo(cx - 12 * dpr, cy)
        ctx.bezierCurveTo(cx - 6 * dpr, cy - 6 * dpr, cx, cy - 6 * dpr, cx, cy)
        ctx.bezierCurveTo(cx, cy + 6 * dpr, cx + 6 * dpr, cy + 6 * dpr, cx + 12 * dpr, cy)
      }
      ctx.stroke()
    }
    paint()
    // Fonts may arrive after first paint; repaint once if nothing has been scratched yet.
    void document.fonts?.ready.then(() => {
      if (moves.current === 0) paint()
    })
  }, [])

  // Escape key acts like back, until the first scratch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, onClose])

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height }
  }

  function scratch(p: { x: number; y: number }) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = canvas.width / (canvas.offsetWidth || 1)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 38 * dpr
    ctx.beginPath()
    const from = last.current ?? p
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
    last.current = p
    scratchTick()
    if (!lockedRef.current) {
      lockedRef.current = true
      setLocked(true)
      onFirstScratch()
    }
    if (++moves.current % 6 === 0) measure()
  }

  function measure() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx || finished.current) return
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let clear = 0
    let total = 0
    for (let i = 3; i < data.length; i += 4 * 24) {
      total++
      if (data[i] < 40) clear++
    }
    const ratio = total ? clear / total : 0
    setPct(Math.min(100, Math.round((ratio / CLEAR_THRESHOLD) * 100)))
    if (ratio >= CLEAR_THRESHOLD) {
      finished.current = true
      drawing.current = false
      setGone(true)
      window.setTimeout(onComplete, 450)
    }
  }

  return (
    <div className="overlay">
      <button type="button" className="backdrop" aria-label="Back to the chart" onClick={() => !locked && onClose()} />
      <div ref={cardRef} className="scratch-card" role="dialog" aria-modal="true" aria-label={`Scratch card for ${money(amount)}`}>
        <div className="card-top">
          {locked ? (
            <span className="locked">
              <LockIcon /> Locked in
            </span>
          ) : (
            <button type="button" className="icon-btn" aria-label="Back to the chart" onClick={onClose}>
              <BackIcon />
            </button>
          )}
          <span className="small">Your pick</span>
        </div>
        <div className="saving">
          <span>You're saving</span>
          <strong>{money(amount)}</strong>
          <span>today</span>
        </div>
        <div className="scratch-area">
          <div className="scratch-reveal">
            <CheckCircle />
            <strong>{money(amount)} saved</strong>
            <span>One square closer, together.</span>
          </div>
          <canvas
            ref={canvasRef}
            className={'scratch-canvas' + (gone ? ' gone' : '')}
            aria-label="Scratch-off foil. Drag across it to scratch."
            role="img"
            onPointerDown={(e) => {
              if (finished.current) return
              drawing.current = true
              last.current = null
              e.currentTarget.setPointerCapture?.(e.pointerId)
              scratch(point(e))
            }}
            onPointerMove={(e) => drawing.current && scratch(point(e))}
            onPointerUp={() => {
              drawing.current = false
              measure()
            }}
            onPointerCancel={() => (drawing.current = false)}
          />
        </div>
        <p className="small center" style={{ margin: 0, minHeight: 18 }}>
          {locked ? `Keep going · ${pct}% scratched` : 'Changed your mind? Tap back. Nothing is saved yet.'}
        </p>
      </div>
    </div>
  )
}
