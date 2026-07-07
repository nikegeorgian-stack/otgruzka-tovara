export const MOCK_MONTH = '2026-06'
export const MOCK_SITE = 'FiberCell · Тбилиси'

export const MOCK_BRIGADES = ['Бригада 1', 'Бригада 2', 'Упаковка', 'Склад ГП']
export const MOCK_DAYS = Array.from({ length: 30 }, (_, i) => i + 1)

export const MOCK_ROWS = [
  { name: 'Иванов И.И.', brigade: 'Бригада 1', tab: '001' },
  { name: 'Петров П.П.', brigade: 'Бригада 1', tab: '002' },
  { name: 'Гиоргадзе Г.Г.', brigade: 'Бригада 2', tab: '014' },
  { name: 'Беридзе Б.Б.', brigade: 'Бригада 2', tab: '021' },
  { name: 'Слот свободен', brigade: 'Упаковка', tab: '—' },
  { name: 'Кобахидзе К.К.', brigade: 'Упаковка', tab: '033' },
]

export const MOCK_STATS = { plan: 1840, fact: 1762, delta: -78, problems: 3 }
