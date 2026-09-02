import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { useI18n } from '@/context/I18nContext'
import { registryPersonKey, type RegistryPerson } from '@/lib/hr/registryImport'

type Props = {
  open: boolean
  missing: RegistryPerson[]
  matchedCount: number
  onCancel: () => void
  onConfirm: (keys: Set<string>) => void
}

export function HrRegistryMissingPicker({
  open,
  missing,
  matchedCount,
  onCancel,
  onConfirm,
}: Props) {
  const { t, tf } = useI18n()
  const rows = useMemo(
    () => missing.map((person) => ({ person, key: registryPersonKey(person) })),
    [missing],
  )
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  if (!open) return null

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <ModalBackdrop open={open} onClose={onCancel}>
      <div className="mx-auto max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-sm border border-grid bg-white shadow-xl">
        <div className="border-b border-grid px-5 py-4">
          <h3 className="text-base font-bold text-ink">{t('hr.registryImport.missingTitle')}</h3>
          <p className="mt-1 text-sm text-stone-600">
            {tf('hr.registryImport.missingHint', {
              matched: matchedCount,
              missing: missing.length,
            })}
          </p>
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          <ul className="space-y-2">
            {rows.map(({ person, key }, index) => (
              <li key={`${key}-${index}`}>
                <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-grid px-3 py-2 hover:bg-paper-dark">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium text-ink">{person.fullName}</span>
                    {person.nameKa ? (
                      <span className="mt-0.5 block text-xs text-stone-500">{person.nameKa}</span>
                    ) : null}
                    {person.tabNumber ? (
                      <span className="mt-0.5 block text-xs text-stone-400">
                        {tf('hr.registryImport.missingTab', { tab: person.tabNumber })}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grid px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelected(new Set(rows.map((r) => r.key)))}
            >
              {t('hr.registryImport.selectAllMissing')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              {t('hr.registryImport.selectNoneMissing')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => onConfirm(selected)}>
              {tf('hr.registryImport.confirmMissing', { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  )
}
