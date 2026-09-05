/**
 * G5.2 — MRP workspace module + SSR markup smoke (no production login).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tf: (k: string) => k,
    locale: 'ru',
  }),
}))

describe('G5.2 MRP workspace DOM smoke', () => {
  it('SSR markup includes horizon recalculate and capacity section', async () => {
    const { G5MrpWorkspace } = await import('../src/components/planner/G5MrpWorkspace')
    const html = renderToStaticMarkup(
      createElement(G5MrpWorkspace, {
        asOfDate: '2026-09-01',
        store: null,
        canViewPayment: false,
        initialPlanning: {
          planningRuns: [
            {
              id: 'run-1',
              calculatedAt: '2026-09-01T10:00:00.000Z',
              inputCriticalRevision: 1,
              horizon: {
                detailedMonths: [{ month: '2026-09', totalQty: 10, weekly: { '2026-W36': 5 } }],
                aggregateMonths: [{ month: '2026-12', totalQty: 20 }],
                capacityNotCalculated: true,
              },
              demandEvents: [],
              supplyEvents: [],
            },
          ],
          shortages: [],
        },
      }),
    )
    expect(html).toContain('g5.mrp.recalculate')
    expect(html).toContain('run-1')
    expect(html).toContain('g5.mrp.section.capacity')
    expect(html).toContain('planner:mrp')
  })
})
