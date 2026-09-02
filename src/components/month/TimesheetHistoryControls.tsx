type Props = {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  undoTitle: string
  redoTitle: string
  groupLabel: string
}

/** Стрелки назад / вперёд — как в Word. */
export function TimesheetHistoryControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoTitle,
  redoTitle,
  groupLabel,
}: Props) {
  return (
    <div className="pf-history" role="group" aria-label={groupLabel} data-coach="month:history">
      <button
        type="button"
        className="pf-history__btn"
        disabled={!canUndo}
        onClick={onUndo}
        title={undoTitle}
        aria-label={undoTitle}
        data-coach="month:historyUndo"
      >
        ↶
      </button>
      <button
        type="button"
        className="pf-history__btn"
        disabled={!canRedo}
        onClick={onRedo}
        title={redoTitle}
        aria-label={redoTitle}
        data-coach="month:historyRedo"
      >
        ↷
      </button>
    </div>
  )
}
