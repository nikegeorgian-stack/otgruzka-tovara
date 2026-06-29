import { newId } from '@/lib/hr/files'
import { applyHrStatus } from '@/lib/hr/sync'
import { suggestNextTabNumber } from '@/lib/hr/tabNumber'
import type { Employee } from '@/lib/types'
import type { Candidate, CandidateStatus, HrDocument, HrEducation, HrWorkExperience } from './types'

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  'new',
  'interview_scheduled',
  'interviewed',
  'probation',
  'accepted',
  'reserve',
  'rejected_interview',
  'no_show',
  'declined',
]

/** Статусы, которые переводят кандидата в сотрудники. */
export const HIRE_STATUSES: CandidateStatus[] = ['accepted', 'probation']

export function isHireStatus(status: CandidateStatus): boolean {
  return HIRE_STATUSES.includes(status)
}

export function candidateStatusLabel(status: CandidateStatus, locale: 'ru' | 'ka'): string {
  const ru: Record<CandidateStatus, string> = {
    new: 'Новый',
    interview_scheduled: 'Собеседование назначено',
    interviewed: 'Прошёл собеседование',
    probation: 'Принят на испытательный срок',
    accepted: 'Принят',
    reserve: 'Резерв',
    rejected_interview: 'Не прошёл собеседование',
    no_show: 'Не явился на собеседование',
    declined: 'Отказался',
  }
  const ka: Record<CandidateStatus, string> = {
    new: 'ახალი',
    interview_scheduled: 'გასაუბრება დანიშნულია',
    interviewed: 'გაიარა გასაუბრება',
    probation: 'მიღებულია გამოსაცდელ ვადაზე',
    accepted: 'მიღებულია',
    reserve: 'რეზერვი',
    rejected_interview: 'ვერ გაიარა გასაუბრება',
    no_show: 'არ გამოცხადდა გასაუბრებაზე',
    declined: 'უარი თქვა',
  }
  return locale === 'ka' ? ka[status] : ru[status]
}

export type CandidateTone = 'neutral' | 'progress' | 'ok' | 'bad'

export function candidateStatusTone(status: CandidateStatus): CandidateTone {
  switch (status) {
    case 'accepted':
    case 'probation':
      return 'ok'
    case 'rejected_interview':
    case 'no_show':
    case 'declined':
      return 'bad'
    case 'interview_scheduled':
    case 'interviewed':
      return 'progress'
    default:
      return 'neutral'
  }
}

export function createNewCandidate(): Candidate {
  const now = new Date().toISOString()
  return {
    id: newId(),
    fullName: '',
    status: 'new',
    currency: 'GEL',
    education: [],
    workExperience: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
  }
}

function normArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : []
}

export function normalizeCandidate(raw: unknown): Candidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const fullName = typeof r.fullName === 'string' ? r.fullName : ''
  const now = new Date().toISOString()
  const status = (CANDIDATE_STATUSES as string[]).includes(r.status as string)
    ? (r.status as CandidateStatus)
    : 'new'
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    fullName,
    nameKa: typeof r.nameKa === 'string' ? r.nameKa : undefined,
    phone: typeof r.phone === 'string' ? r.phone : undefined,
    email: typeof r.email === 'string' ? r.email : undefined,
    position: typeof r.position === 'string' ? r.position : undefined,
    department: typeof r.department === 'string' ? r.department : undefined,
    desiredSalary: typeof r.desiredSalary === 'number' ? r.desiredSalary : undefined,
    currency: (['GEL', 'USD', 'RUB'].includes(r.currency as string)
      ? (r.currency as Candidate['currency'])
      : 'GEL'),
    status,
    source: typeof r.source === 'string' ? r.source : undefined,
    interviewDate: typeof r.interviewDate === 'string' ? r.interviewDate : undefined,
    birthDate: typeof r.birthDate === 'string' ? r.birthDate : undefined,
    personalId: typeof r.personalId === 'string' ? r.personalId : undefined,
    citizenship: typeof r.citizenship === 'string' ? r.citizenship : undefined,
    address: typeof r.address === 'string' ? r.address : undefined,
    photoDataUrl: typeof r.photoDataUrl === 'string' ? r.photoDataUrl : undefined,
    note: typeof r.note === 'string' ? r.note : undefined,
    education: normArray<HrEducation>(r.education),
    workExperience: normArray<HrWorkExperience>(r.workExperience),
    documents: normArray<HrDocument>(r.documents),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  }
}

/**
 * Превращает кандидата в нового сотрудника.
 * probation → сотрудник с испытательным сроком (probationMonths по умолчанию 3).
 */
export function candidateToEmployee(
  candidate: Candidate,
  brigades: string[],
  employees: Employee[],
): Employee {
  const today = new Date().toISOString().slice(0, 10)
  const brigade = brigades[0] ?? ''
  const onProbation = candidate.status === 'probation'
  return applyHrStatus(
    {
      id: newId(),
      fullName: candidate.fullName,
      nameKa: candidate.nameKa,
      tabNumber: suggestNextTabNumber(employees),
      position: candidate.position ?? '',
      brigade,
      schedule: '2/2 11ч',
      group2x2: 'А',
      cycleStart: today,
      active: true,
      hireDate: today,
      phone: candidate.phone,
      email: candidate.email,
      birthDate: candidate.birthDate,
      personalId: candidate.personalId,
      citizenship: candidate.citizenship,
      gender: candidate.gender,
      address: candidate.address,
      photoDataUrl: candidate.photoDataUrl,
      department: candidate.department ?? brigade,
      line: brigade,
      currency: (candidate.currency ?? 'GEL') as Employee['currency'],
      monthlySalary: candidate.desiredSalary,
      contractType: 'full_time',
      shiftMode: 'day',
      employmentStatus: 'active',
      probationMonths: onProbation ? 3 : undefined,
      hrNotes: candidate.note,
      education: candidate.education ?? [],
      workExperience: candidate.workExperience ?? [],
      hrDocuments: candidate.documents ?? [],
      hrAbsences: [],
      hrTrainings: [],
      bankAccounts: [],
      relatives: [],
      fromCandidateId: candidate.id,
    },
    'active',
  )
}
