import { useMemo } from 'react'

const COLORS = ['#2E6A4C', '#F2C46B', '#B87514', '#8FB9A0', '#17241C', '#E2856B']

/** Renders one burst. Change `burst` to fire again; `big` doubles it for milestones. */
export function Confetti({ burst, big }: { burst: number; big: boolean }) {
  const pieces = useMemo(() => {
    if (!burst) return []
    const count = big ? 90 : 42
    return Array.from({ length: count }, (_, i) => ({
      key: `${burst}-${i}`,
      style: {
        left: `${(Math.random() * 100).toFixed(1)}%`,
        width: 6 + Math.round(Math.random() * 5),
        height: 9 + Math.round(Math.random() * 6),
        background: COLORS[i % COLORS.length],
        animationDuration: `${(1.1 + Math.random() * 0.8).toFixed(2)}s`,
        animationDelay: `${(Math.random() * 0.35).toFixed(2)}s`,
      } as React.CSSProperties,
    }))
  }, [burst, big])

  if (!pieces.length) return null
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.key} style={p.style} />
      ))}
    </div>
  )
}
