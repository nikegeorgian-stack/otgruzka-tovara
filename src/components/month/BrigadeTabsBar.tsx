import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { getModalPortalRoot } from '@/lib/ui/modalScope'

export type BrigadeTabId = string | '__all__'

type Props = {
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  activeTab: BrigadeTabId
  onTabChange: (tab: BrigadeTabId) => void
  countForBrigade: (brigade: string) => number
  /** Мастер цеха: показывать только «свои» бригады. */
  myBrigadesOnly?: boolean
  onMyBrigadesOnly?: (on: boolean) => void
  showMyBrigadesToggle?: boolean
  maxVisible?: number
}

export function BrigadeTabsBar({
  brigades,
  brigadeNamesKa,
  activeTab,
  onTabChange,
  countForBrigade,
  myBrigadesOnly = false,
  onMyBrigadesOnly,
  showMyBrigadesToggle = false,
  maxVisible = 8,
}: Props) {
  const { t, locale } = useI18n()
  const [moreOpen, setMoreOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { visibleList, overflowList } = useMemo(() => {
    if (brigades.length <= maxVisible) {
      return { visibleList: brigades, overflowList: [] as string[] }
    }
    let pinned = brigades.slice(0, maxVisible)
    if (
      activeTab !== '__all__' &&
      typeof activeTab === 'string' &&
      !pinned.includes(activeTab)
    ) {
      const rest = brigades.filter((b) => b !== activeTab)
      pinned = [activeTab, ...rest.slice(0, maxVisible - 1)]
    }
    const overflow = brigades.filter((b) => !pinned.includes(b))
    return { visibleList: pinned, overflowList: overflow }
  }, [activeTab, brigades, maxVisible])

  const filteredMenu = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return brigades
    return brigades.filter((b) =>
      brigadeLabel(b, brigadeNamesKa, locale).toLowerCase().includes(q),
    )
  }, [brigades, brigadeNamesKa, locale, query])

  useLayoutEffect(() => {
    if (!moreOpen || !btnRef.current) {
      setMenuPos(null)
      return
    }
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 24)
      let left = r.right - width
      if (left < 12) left = 12
      if (left + width > window.innerWidth - 12) left = window.innerWidth - 12 - width
      let top = r.bottom + 6
      const maxH = Math.min(352, window.innerHeight * 0.7)
      if (top + maxH > window.innerHeight - 12) {
        top = Math.max(12, r.top - maxH - 6)
      }
      setMenuPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [moreOpen])

  useEffect(() => {
    if (!moreOpen) {
      setQuery('')
      return
    }
    const tId = window.setTimeout(() => searchRef.current?.focus(), 0)
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (moreRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(tId)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const showMore = overflowList.length > 0 || brigades.length > maxVisible

  return (
    <div className="bw-tabs-row print:hidden">
      <div className="bw-tabs" role="tablist" aria-label={t('month.brigadesShow')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === '__all__'}
          className={`bw-tab ${activeTab === '__all__' ? 'bw-tab--on' : ''}`}
          onClick={() => onTabChange('__all__')}
        >
          {t('month.brigadesSelectAll')}
          <span className="bw-tab__badge">{brigades.length}</span>
        </button>
        {visibleList.map((b) => {
          const on = activeTab === b
          const count = countForBrigade(b)
          return (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={on}
              className={`bw-tab ${on ? 'bw-tab--on' : ''}`}
              onClick={() => onTabChange(b)}
              title={brigadeLabel(b, brigadeNamesKa, locale)}
            >
              <span className="bw-tab__label">{brigadeLabel(b, brigadeNamesKa, locale)}</span>
              <span className="bw-tab__badge">{count}</span>
            </button>
          )
        })}
        {showMore && (
          <div className="bw-tab-more" ref={moreRef}>
            <button
              ref={btnRef}
              type="button"
              className={`bw-tab bw-tab--more ${moreOpen ? 'bw-tab--on' : ''}`}
              title={t('month.workspace.moreBrigades')}
              aria-expanded={moreOpen}
              aria-haspopup="listbox"
              onClick={() => setMoreOpen((o) => !o)}
            >
              {overflowList.length > 0
                ? `+${overflowList.length}`
                : t('month.workspace.brigadeList')}
            </button>
            {moreOpen && menuPos
              ? createPortal(
                  <div
                    ref={menuRef}
                    className="bw-tab-more__menu"
                    role="listbox"
                    style={{ top: menuPos.top, left: menuPos.left }}
                  >
                    <input
                      ref={searchRef}
                      type="search"
                      className="bw-tab-more__search"
                      placeholder={t('month.workspace.brigadeSearch')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label={t('month.workspace.brigadeSearch')}
                    />
                    <div className="bw-tab-more__list">
                      <button
                        type="button"
                        role="option"
                        aria-selected={activeTab === '__all__'}
                        className={`bw-tab-more__item ${
                          activeTab === '__all__' ? 'bw-tab-more__item--on' : ''
                        }`}
                        onClick={() => {
                          onTabChange('__all__')
                          setMoreOpen(false)
                        }}
                      >
                        <span>{t('month.brigadesSelectAll')}</span>
                        <span className="bw-tab__badge">{brigades.length}</span>
                      </button>
                      {filteredMenu.length === 0 ? (
                        <p className="bw-tab-more__empty">{t('month.workspace.brigadeSearchEmpty')}</p>
                      ) : (
                        filteredMenu.map((b) => (
                          <button
                            key={b}
                            type="button"
                            role="option"
                            aria-selected={activeTab === b}
                            className={`bw-tab-more__item ${
                              activeTab === b ? 'bw-tab-more__item--on' : ''
                            }`}
                            onClick={() => {
                              onTabChange(b)
                              setMoreOpen(false)
                            }}
                          >
                            <span>{brigadeLabel(b, brigadeNamesKa, locale)}</span>
                            <span className="bw-tab__badge">{countForBrigade(b)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>,
                  getModalPortalRoot(),
                )
              : null}
          </div>
        )}
      </div>
      {showMyBrigadesToggle && onMyBrigadesOnly ? (
        <label className="bw-my-brigades">
          <span className="bw-my-brigades__label">{t('month.workspace.myBrigades')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={myBrigadesOnly}
            className={`bw-toggle ${myBrigadesOnly ? 'bw-toggle--on' : ''}`}
            onClick={() => onMyBrigadesOnly(!myBrigadesOnly)}
          />
        </label>
      ) : null}
    </div>
  )
}
