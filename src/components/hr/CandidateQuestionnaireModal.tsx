import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import {
  createEmptyQuestionnaireItem,
  createQuestionnaireFromTemplate,
  questionnaireAnsweredCount,
} from '@/lib/hr/candidateQuestionnaire'
import type { Candidate, CandidateQuestionnaire, CandidateQuestionnaireItem } from '@/lib/hr/types'

type Props = {
  candidate: Candidate
  onClose: () => void
  onSave: (questionnaire: CandidateQuestionnaire) => void
}

export function CandidateQuestionnaireModal({ candidate, onClose, onSave }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<CandidateQuestionnaire>(() =>
    createQuestionnaireFromTemplate(candidate.questionnaire),
  )
  const [baseline] = useState(() => JSON.stringify(createQuestionnaireFromTemplate(candidate.questionnaire)))
  const dirty = JSON.stringify(draft) !== baseline
  const answered = questionnaireAnsweredCount(draft)

  const title = useMemo(
    () =>
      candidate.fullName?.trim()
        ? `${t('hr.anketa.title')} — ${candidate.fullName}`
        : t('hr.anketa.title'),
    [candidate.fullName, t],
  )

  function patchItem(id: string, patch: Partial<CandidateQuestionnaireItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      updatedAt: new Date().toISOString(),
    }))
  }

  function addCustomQuestion() {
    setDraft((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyQuestionnaireItem(t('hr.anketa.newQuestionPlaceholder'))],
      updatedAt: new Date().toISOString(),
    }))
  }

  function removeItem(id: string) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleSave() {
    onSave({ ...draft, updatedAt: new Date().toISOString() })
  }

  function handlePrint() {
    document.body.classList.add('candidate-anketa-print-open')
    const cleanup = () => {
      document.body.classList.remove('candidate-anketa-print-open')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    requestAnimationFrame(() => {
      window.print()
      window.setTimeout(cleanup, 500)
    })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={title}
      subtitle={t('hr.anketa.subtitle')}
      size="preview"
      dirty={dirty}
      onSaveDirty={handleSave}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-xs text-stone-500">
            {t('hr.anketa.progress')
              .replace('{n}', String(answered))
              .replace('{total}', String(draft.items.length))}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
              onClick={handlePrint}
              data-coach="hr:anketaPrint"
            >
              {t('hr.anketa.print')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-2 text-sm"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600"
              onClick={handleSave}
              data-coach="hr:anketaSave"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      }
    >
      <div className="candidate-anketa space-y-4 print:space-y-3">
        <header className="candidate-anketa-print-header hidden border-b border-stone-800 pb-3 print:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Fibercell</p>
          <h1 className="text-lg font-bold text-ink">{t('hr.anketa.title')}</h1>
          {candidate.fullName?.trim() ? (
            <p className="mt-1 text-sm text-stone-700">{candidate.fullName}</p>
          ) : null}
        </header>

        <div className="rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white px-4 py-3 print:hidden">
          <p className="text-sm font-semibold text-teal-900">{t('hr.anketa.banner')}</p>
          <p className="mt-1 text-xs leading-relaxed text-teal-800/90">{t('hr.anketa.bannerHint')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
          <label className="block text-xs font-medium text-stone-500">
            {t('hr.anketa.filledAt')}
            <input
              type="date"
              className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm print:border-0 print:px-0"
              value={draft.filledAt ?? ''}
              onChange={(e) =>
                setDraft((p) => ({ ...p, filledAt: e.target.value, updatedAt: new Date().toISOString() }))
              }
            />
          </label>
          <label className="block text-xs font-medium text-stone-500">
            {t('hr.anketa.interviewerNote')}
            <input
              className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm print:border-0 print:px-0"
              value={draft.interviewerNote ?? ''}
              placeholder={t('hr.anketa.interviewerNotePh')}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  interviewerNote: e.target.value,
                  updatedAt: new Date().toISOString(),
                }))
              }
            />
          </label>
        </div>

        <div className="space-y-3" data-coach="hr:anketaForm">
          {draft.items.map((item, index) => (
            <article
              key={item.id}
              className="rounded-xl border border-grid bg-white p-3 shadow-sm print:break-inside-avoid print:rounded-none print:border-stone-300 print:shadow-none"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-stone-100 px-1.5 text-[11px] font-bold text-stone-600 print:bg-transparent">
                  {index + 1}
                </span>
                {!item.templateKey ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-red-600 hover:underline print:hidden"
                    onClick={() => removeItem(item.id)}
                  >
                    {t('hr.anketa.removeQuestion')}
                  </button>
                ) : null}
              </div>
              <label className="block text-xs font-medium text-stone-500">
                {t('hr.anketa.question')}
                <textarea
                  className="mt-1 w-full resize-y rounded-sm border border-grid bg-stone-50/80 px-3 py-2 text-sm leading-relaxed text-ink print:border-0 print:bg-transparent print:px-0 print:font-semibold"
                  rows={2}
                  value={item.question}
                  onChange={(e) => patchItem(item.id, { question: e.target.value })}
                />
              </label>
              <label className="mt-2 block text-xs font-medium text-stone-500">
                {t('hr.anketa.answer')}
                <textarea
                  className="mt-1 w-full resize-y rounded-sm border border-grid bg-white px-3 py-2 text-sm leading-relaxed print:min-h-[2.5rem] print:border-b print:border-stone-400 print:px-0"
                  rows={3}
                  value={item.answer}
                  placeholder={t('hr.anketa.answerPh')}
                  onChange={(e) => patchItem(item.id, { answer: e.target.value })}
                />
              </label>
            </article>
          ))}
        </div>

        <button
          type="button"
          className="w-full rounded-xl border border-dashed border-teal-300 bg-teal-50/40 px-4 py-3 text-sm font-semibold text-teal-800 hover:bg-teal-50 print:hidden"
          onClick={addCustomQuestion}
          data-coach="hr:anketaAddQuestion"
        >
          + {t('hr.anketa.addQuestion')}
        </button>

        <label className="flex items-start gap-2 rounded-xl border border-grid bg-stone-50/60 px-3 py-3 text-sm text-ink print:border-0 print:bg-transparent">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.consent === true}
            onChange={(e) =>
              setDraft((p) => ({ ...p, consent: e.target.checked, updatedAt: new Date().toISOString() }))
            }
          />
          <span>{t('hr.anketa.consent')}</span>
        </label>

        <div className="hidden border-t border-stone-400 pt-4 text-sm print:block">
          <p>{t('hr.anketa.signLine')}</p>
          <p className="mt-6 text-stone-600">
            ________________ / ________________  {t('hr.anketa.filledAt')}: {draft.filledAt || '____'}
          </p>
        </div>
      </div>
    </AppDialog>
  )
}
