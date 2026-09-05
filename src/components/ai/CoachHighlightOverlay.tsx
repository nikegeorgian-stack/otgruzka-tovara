import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCoach } from '@/context/CoachContext'
import { COACH_Z, getCoachPortalRoot } from '@/lib/ui/chromeLayout'

type Rect = { top: number; left: number; width: number; height: number }

function measureTarget(target: string): Rect | null {
  const sel = `[data-coach="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target) : target}"]`
  const nodes = document.querySelectorAll<HTMLElement>(sel)
  // Берём последний видимый — чаще это элемент в открытой модалке (портал поверх #root)
  let best: Rect | null = null
  for (const el of nodes) {
    const r = el.getBoundingClientRect()
    if (r.width > 2 && r.height > 2) {
      best = { top: r.top, left: r.left, width: r.width, height: r.height }
    }
  }
  return best
}

/** Красная плавная обводка цели гида. Клики проходят сквозь оверлей к элементу. */
export function CoachHighlightOverlay() {
  const { activeHighlight, activeGuide, stepIndex } = useCoach()
  const [rect, setRect] = useState<Rect | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!activeHighlight) {
      setVisible(false)
      setRect(null)
      return
    }

    let alive = true
    let raf = 0

    const apply = () => {
      if (!alive) return
      const next = measureTarget(activeHighlight)
      if (next) {
        setRect(next)
        setVisible(true)
      }
    }

    apply()
    const t1 = window.setTimeout(apply, 80)
    const t2 = window.setTimeout(apply, 280)
    const t3 = window.setTimeout(apply, 600)
    const t4 = window.setTimeout(apply, 1100)
    const iv = window.setInterval(apply, 280)

    const onLayout = () => {
      cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(apply)
    }
    window.addEventListener('scroll', onLayout, true)
    window.addEventListener('resize', onLayout)
    const mo = new MutationObserver(onLayout)
    // Только структура DOM — attributes:true давал мигание рамки на каждом className
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
      clearInterval(iv)
      window.removeEventListener('scroll', onLayout, true)
      window.removeEventListener('resize', onLayout)
      mo.disconnect()
    }
  }, [activeHighlight, activeGuide?.id, stepIndex])

  if (!activeHighlight || !rect || !visible) return null
  if (typeof document === 'undefined') return null

  const pad = 10
  const top = Math.max(4, rect.top - pad)
  const left = Math.max(4, rect.left - pad)
  const width = rect.width + pad * 2
  const height = rect.height + pad * 2

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 print:hidden"
      style={{ zIndex: COACH_Z }}
      aria-hidden
    >
      <style>{`
        @keyframes coachRingPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.92; transform: scale(1.012); }
        }
        @keyframes coachRingGlow {
          0%, 100% { box-shadow: 0 0 0 3px rgba(220,38,38,0.95), 0 0 0 10px rgba(220,38,38,0.2), 0 0 28px rgba(220,38,38,0.35); }
          50% { box-shadow: 0 0 0 4px rgba(220,38,38,1), 0 0 0 16px rgba(220,38,38,0.14), 0 0 36px rgba(220,38,38,0.45); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          top,
          left,
          width,
          height,
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.48)',
          transition:
            'top 0.32s cubic-bezier(0.22,1,0.36,1), left 0.32s cubic-bezier(0.22,1,0.36,1), width 0.32s cubic-bezier(0.22,1,0.36,1), height 0.32s cubic-bezier(0.22,1,0.36,1)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top,
          left,
          width,
          height,
          borderRadius: 12,
          border: '2.5px solid rgb(220, 38, 38)',
          animation: 'coachRingPulse 1.4s ease-in-out infinite, coachRingGlow 1.4s ease-in-out infinite',
          transition:
            'top 0.32s cubic-bezier(0.22,1,0.36,1), left 0.32s cubic-bezier(0.22,1,0.36,1), width 0.32s cubic-bezier(0.22,1,0.36,1), height 0.32s cubic-bezier(0.22,1,0.36,1)',
          transformOrigin: 'center center',
        }}
      />
    </div>,
    getCoachPortalRoot(),
  )
}
