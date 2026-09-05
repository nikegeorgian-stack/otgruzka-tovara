import { describe, expect, it } from 'vitest'
import {
  directorySectionsForRole,
  resolveDirectoryTabs,
} from '@/lib/directories/access'

describe('directory access overrides', () => {
  it('uses role default when no overrides', () => {
    const tabs = resolveDirectoryTabs({ roleId: 'sales_dispatcher' })
    expect(tabs).toEqual(['counterparties', 'finishedProducts'])
  })

  it('prefers user directorySections over role', () => {
    const tabs = resolveDirectoryTabs({
      roleId: 'sales_dispatcher',
      userDirectorySections: ['nomenclature', 'finishedProducts'],
    })
    expect(tabs).toEqual(['nomenclature', 'finishedProducts'])
  })

  it('uses roleDirectorySections from access store', () => {
    const tabs = directorySectionsForRole('hr', {
      roleDirectorySections: { hr: ['brigades', 'employees'] },
    })
    expect(tabs).toEqual(['brigades', 'employees'])
  })

  it('applies warehouse web filter after personal list', () => {
    const tabs = resolveDirectoryTabs({
      roleId: 'sysadmin',
      userDirectorySections: ['finishedProducts', 'nomenclature', 'counterparties'],
      webWarehouseMode: true,
    })
    expect(tabs).toEqual(['nomenclature', 'counterparties'])
  })
})
