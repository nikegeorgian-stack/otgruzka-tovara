import { useEffect, useState } from 'react'
import { useCoach } from '@/context/CoachContext'

type Rect = { top: number; left: number; width: number; height: number }

export function CoachHighlightOverlay() {
  const { activeHighlight } = useCoach()
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!activeHighlight) {
      setRect(null)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-coach="${activeHighlight}"]`)
    if (!el) {
      setRect(null)
      return
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    const raf = setTimeout(measure, 350)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(raf)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [activeHighlight])

  if (!activeHighlight || !rect) return null

  const pad = 6
  return (
    <div
      className="pointer-events-none fixed z-[120] rounded-sm print:hidden"
      style={{
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        boxShadow: '0 0 0 3px rgba(13,148,136,0.9), 0 0 0 9999px rgba(15,23,42,0.35)',
        transition: 'all 0.2s ease',
        animation: 'coachPulse 1s ease-in-out infinite',
      }}
    >
      <style>{`@keyframes coachPulse{0%,100%{box-shadow:0 0 0 3px rgba(13,148,136,0.9),0 0 0 9999px rgba(15,23,42,0.35)}50%{box-shadow:0 0 0 6px rgba(13,148,136,0.55),0 0 0 9999px rgba(15,23,42,0.35)}}`}</style>
    </div>
  )
}
