import type { CoachDepth, CoachGuideStep } from '@/lib/coach/guides/types'

export type { CoachDepth }

export const COACH_DEPTHS: CoachDepth[] = ['simple', 'guided', 'full']

const RANK: Record<CoachDepth, number> = {
  simple: 0,
  guided: 1,
  full: 2,
}

export const COACH_DEPTH_STORAGE_KEY = 'fst-coach-depth'

export function normalizeCoachDepth(raw: unknown): CoachDepth {
  if (raw === 'simple' || raw === 'guided' || raw === 'full') return raw
  return 'full'
}

export function readStoredCoachDepth(): CoachDepth {
  try {
    return normalizeCoachDepth(localStorage.getItem(COACH_DEPTH_STORAGE_KEY))
  } catch {
    return 'full'
  }
}

export function writeStoredCoachDepth(depth: CoachDepth): void {
  try {
    localStorage.setItem(COACH_DEPTH_STORAGE_KEY, depth)
  } catch {
    /* ignore */
  }
}

/** Шаги, видимые на выбранной глубине (minDepth ≤ depth). */
export function stepsForDepth(steps: CoachGuideStep[], depth: CoachDepth): CoachGuideStep[] {
  const max = RANK[depth]
  const filtered = steps.filter((s) => RANK[s.minDepth ?? 'simple'] <= max)
  return filtered.length > 0 ? filtered : steps.filter((s) => (s.minDepth ?? 'simple') === 'simple')
}
