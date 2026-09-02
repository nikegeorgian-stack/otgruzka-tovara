import type { ViewId } from '@/lib/types'
import type { CoachGuide, CoachGuideStep } from './types'

/** Как TabBar: fact → Fact → prefix:tabFact */
export function coachTabTarget(prefix: string, tabId: string): string {
  return `${prefix}:tab${tabId.charAt(0).toUpperCase()}${tabId.slice(1)}`
}

function navStep(view: ViewId): CoachGuideStep {
  return {
    target: `nav:${view}`,
    titleKey: `coach.guide.nav.${view}.title`,
    bodyKey: `coach.guide.nav.${view}.body`,
  }
}

/** Гид: меню раздела → клик по вкладке (и опционально кнопка). */
export function makeTabGuide(opts: {
  view: ViewId
  /** slug в id и i18n: coach.guide.{view}.{slug}.* */
  slug: string
  tabId: string
  /** data-coach префикс вкладок (по умолчанию = view) */
  tabPrefix?: string
  /** Доп. шаг после вкладки (кнопка CTA) */
  action?: { target: string; stepKey: string }
  skipNav?: boolean
}): CoachGuide {
  const prefix = opts.tabPrefix ?? opts.view
  const base = `coach.guide.${opts.view}.${opts.slug}`
  const steps: CoachGuideStep[] = []
  if (!opts.skipNav) steps.push(navStep(opts.view))
  steps.push({
    target: coachTabTarget(prefix, opts.tabId),
    titleKey: `${base}.s1.title`,
    bodyKey: `${base}.s1.body`,
  })
  if (opts.action) {
    steps.push({
      target: opts.action.target,
      titleKey: `${base}.${opts.action.stepKey}.title`,
      bodyKey: `${base}.${opts.action.stepKey}.body`,
    })
  }
  return {
    id: `${opts.view}.${opts.slug}`,
    view: opts.view,
    titleKey: `${base}.title`,
    blurbKey: `${base}.blurb`,
    steps,
  }
}

export function makeActionGuide(opts: {
  view: ViewId
  slug: string
  target: string
  skipNav?: boolean
}): CoachGuide {
  const base = `coach.guide.${opts.view}.${opts.slug}`
  const steps: CoachGuideStep[] = []
  if (!opts.skipNav) steps.push(navStep(opts.view))
  steps.push({
    target: opts.target,
    titleKey: `${base}.s1.title`,
    bodyKey: `${base}.s1.body`,
  })
  return {
    id: `${opts.view}.${opts.slug}`,
    view: opts.view,
    titleKey: `${base}.title`,
    blurbKey: `${base}.blurb`,
    steps,
  }
}
