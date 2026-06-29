import { DIRECTORY_SECTIONS, type DirectorySection } from '@/lib/directories/types'

export function directorySectionTitle(
  section: DirectorySection,
  t: (key: string) => string,
): string {
  const row = DIRECTORY_SECTIONS.find((s) => s.id === section)
  return row ? t(row.labelKey) : section
}
