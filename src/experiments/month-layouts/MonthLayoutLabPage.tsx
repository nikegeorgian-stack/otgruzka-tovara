import type { ReactElement } from 'react'
import { useState } from 'react'
import './month-layout-lab.css'
import {
  MONTH_LAYOUT_GROUPS,
  MONTH_LAYOUT_VARIANTS,
  type MonthLayoutVariantId,
} from './types'
import { VariantA_Toolbar } from './variants/VariantA_Toolbar'
import { VariantB_IconRail } from './variants/VariantB_IconRail'
import { VariantC_BottomBar } from './variants/VariantC_BottomBar'
import { VariantD_Accordion } from './variants/VariantD_Accordion'
import { VariantE_Focus } from './variants/VariantE_Focus'
import { VariantF_IdeSidebar } from './variants/VariantF_IdeSidebar'
import { VariantG_BrigadeTabs } from './variants/VariantG_BrigadeTabs'
import { VariantH_Fullscreen } from './variants/VariantH_Fullscreen'
import { VariantI_Cards } from './variants/VariantI_Cards'

const VARIANT_COMPONENTS: Record<MonthLayoutVariantId, () => ReactElement> = {
  a: VariantA_Toolbar,
  b: VariantB_IconRail,
  c: VariantC_BottomBar,
  d: VariantD_Accordion,
  e: VariantE_Focus,
  f: VariantF_IdeSidebar,
  g: VariantG_BrigadeTabs,
  h: VariantH_Fullscreen,
  i: VariantI_Cards,
}

const DEFAULT_VARIANT: MonthLayoutVariantId = 'f'

/**
 * Локальная лаборатория макетов табеля.
 * Открыть: http://localhost:5173/#/dev/month-layouts
 */
export function MonthLayoutLabPage() {
  const [variant, setVariant] = useState<MonthLayoutVariantId>(() => {
    if (typeof window === 'undefined') return DEFAULT_VARIANT
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const v = q.get('v') as MonthLayoutVariantId | null
    return v && v in VARIANT_COMPONENTS ? v : DEFAULT_VARIANT
  })

  const meta = MONTH_LAYOUT_VARIANTS.find((v) => v.id === variant)!
  const Preview = VARIANT_COMPONENTS[variant]

  function pick(id: MonthLayoutVariantId) {
    setVariant(id)
    const base = window.location.hash.split('?')[0]
    window.history.replaceState(null, '', `${base}?v=${id}`)
  }

  return (
    <div className="ml-lab">
      <div className="ml-lab__picker">
        <strong>Табель — лаборатория макетов</strong>
        <a href="#/month">← Боевой табель</a>

        {MONTH_LAYOUT_GROUPS.map((group) => (
          <div key={group.id} className="ml-lab__group">
            <span className="ml-lab__group-label">{group.label}</span>
            <div className="ml-lab__tabs" role="tablist">
              {MONTH_LAYOUT_VARIANTS.filter((v) => v.group === group.id).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={variant === v.id}
                  className={`ml-lab__tab ${variant === v.id ? 'ml-lab__tab--on' : ''} ${
                    group.id === 'radical' ? 'ml-lab__tab--radical' : ''
                  }`}
                  onClick={() => pick(v.id)}
                >
                  {v.title}
                </button>
              ))}
            </div>
          </div>
        ))}

        <p className="ml-lab__meta">{meta.tagline}</p>
      </div>

      <div className="ml-lab__proscons">
        <div>
          <strong className="text-emerald-400">+</strong>
          <ul>
            {meta.pros.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong className="text-amber-400">−</strong>
          <ul>
            {meta.cons.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="ml-lab__stage ml-lab__stage--framed">
        <p className="px-2 py-1 text-[10px] text-stone-400">
          Заглушка данных. AppShell скрыт — оценивайте только компоновку табеля.
          {meta.group === 'radical' ? ' Варианты F–I — принципиально другая логика экрана.' : null}
        </p>
        <Preview />
      </div>
    </div>
  )
}
