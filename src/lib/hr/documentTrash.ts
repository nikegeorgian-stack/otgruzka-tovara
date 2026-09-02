import type { Employee } from '@/lib/types'
import type {
  HrDocument,
  HrDocumentTrashItem,
  HrEmploymentContract,
  HrEmploymentContractTrashItem,
} from './types'

function nowIso(): string {
  return new Date().toISOString()
}

export function removeHrDocumentToTrash(emp: Employee, id: string): Employee {
  const current = emp.hrDocuments ?? []
  const target = current.find((d) => d.id === id)
  if (!target) return emp
  const trashItem: HrDocumentTrashItem = { deletedAt: nowIso(), document: target }
  return {
    ...emp,
    hrDocuments: current.filter((d) => d.id !== id),
    hrDocumentsTrash: [trashItem, ...(emp.hrDocumentsTrash ?? [])],
  }
}

export function restoreHrDocumentFromTrash(emp: Employee, deletedAt: string): Employee {
  const item = (emp.hrDocumentsTrash ?? []).find((x) => x.deletedAt === deletedAt)
  if (!item) return emp
  const docsById = new Map<string, HrDocument>((emp.hrDocuments ?? []).map((d) => [d.id, d]))
  docsById.set(item.document.id, item.document)
  return {
    ...emp,
    hrDocuments: [...docsById.values()],
    hrDocumentsTrash: (emp.hrDocumentsTrash ?? []).filter((x) => x.deletedAt !== deletedAt),
  }
}

export function purgeHrDocumentTrash(emp: Employee, deletedAt: string): Employee {
  return {
    ...emp,
    hrDocumentsTrash: (emp.hrDocumentsTrash ?? []).filter((x) => x.deletedAt !== deletedAt),
  }
}

export function removeHrContractToTrash(emp: Employee, id: string): Employee {
  const current = emp.hrContracts ?? []
  const target = current.find((c) => c.id === id)
  if (!target) return emp
  const trashItem: HrEmploymentContractTrashItem = { deletedAt: nowIso(), contract: target }
  return {
    ...emp,
    hrContracts: current.filter((c) => c.id !== id),
    hrContractsTrash: [trashItem, ...(emp.hrContractsTrash ?? [])],
  }
}

export function restoreHrContractFromTrash(emp: Employee, deletedAt: string): Employee {
  const item = (emp.hrContractsTrash ?? []).find((x) => x.deletedAt === deletedAt)
  if (!item) return emp
  const contractsById = new Map<string, HrEmploymentContract>(
    (emp.hrContracts ?? []).map((c) => [c.id, c]),
  )
  contractsById.set(item.contract.id, item.contract)
  return {
    ...emp,
    hrContracts: [...contractsById.values()],
    hrContractsTrash: (emp.hrContractsTrash ?? []).filter((x) => x.deletedAt !== deletedAt),
  }
}

export function purgeHrContractTrash(emp: Employee, deletedAt: string): Employee {
  return {
    ...emp,
    hrContractsTrash: (emp.hrContractsTrash ?? []).filter((x) => x.deletedAt !== deletedAt),
  }
}

export function applyHrEmbeddedTrashTombstones(emp: Employee): Employee {
  const docDeleted = new Set((emp.hrDocumentsTrash ?? []).map((x) => x.document.id))
  const contractDeleted = new Set((emp.hrContractsTrash ?? []).map((x) => x.contract.id))
  return {
    ...emp,
    hrDocuments: (emp.hrDocuments ?? []).filter((d) => !docDeleted.has(d.id)),
    hrContracts: (emp.hrContracts ?? []).filter((c) => !contractDeleted.has(c.id)),
  }
}
