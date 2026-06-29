import type { Employee } from '@/lib/types'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'

type Props = {
  employee: Pick<Employee, 'photoDataUrl' | 'gender' | 'fullName'>
  size?: 'sm' | 'md'
}

export function EmployeeAvatar({ employee, size = 'md' }: Props) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  return (
    <EmployeePhoto
      photoDataUrl={employee.photoDataUrl}
      gender={employee.gender ?? 'unknown'}
      className={`${dim} shrink-0 rounded-sm object-cover ring-1 ring-grid`}
    />
  )
}
