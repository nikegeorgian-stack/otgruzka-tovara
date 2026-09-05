import type { ViewId } from '@/lib/types'

/** Глубина сопровождения (см. также src/lib/coach/depth.ts). */
export type CoachDepth = 'simple' | 'guided' | 'full'

/** Один шаг гида: подсветка цели, переход только после клика по ней. */
export type CoachGuideStep = {
  /** Значение data-coach на элементе UI. */
  target: string
  /** i18n ключ заголовка шага */
  titleKey: string
  /** i18n ключ пояснения */
  bodyKey: string
  /**
   * Минимальная глубина, с которой шаг показывается.
   * simple — всегда; guided — средний и полный; full — только полное сопровождение.
   */
  minDepth?: CoachDepth
}

export type CoachGuide = {
  id: string
  /** Раздел, в котором живёт функция */
  view: ViewId
  /** Показывать в каталоге любого раздела (виджеты вроде обратной связи). */
  global?: boolean
  /** i18n ключ названия функции в списке */
  titleKey: string
  /** i18n ключ короткого описания в списке */
  blurbKey: string
  steps: CoachGuideStep[]
}
