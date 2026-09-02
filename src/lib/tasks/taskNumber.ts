import type { WorkTask } from './types'

export function formatTaskNumber(seq: number, year = new Date().getFullYear()): string {
  return `З-${year}-${String(seq).padStart(3, '0')}`
}

export function nextTaskNumber(tasks: WorkTask[]): string {
  const year = new Date().getFullYear()
  const prefix = `З-${year}-`
  let max = 0
  for (const t of tasks) {
    if (!t.number?.startsWith(prefix)) continue
    const n = parseInt(t.number.slice(prefix.length), 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return formatTaskNumber(max + 1, year)
}

export function taskDisplayLabel(task: WorkTask): string {
  return task.number?.trim() || task.title.slice(0, 24)
}
