import type { EmployeeGender } from '@/lib/hr/types'

type PhotoProps = {
  photoDataUrl?: string
  gender?: EmployeeGender
  alt?: string
  className?: string
}

function GenderSilhouette({ gender }: { gender: EmployeeGender }) {
  if (gender === 'male') {
    return (
      <svg viewBox="0 0 80 96" className="h-[62%] w-[62%]" aria-hidden>
        <circle cx="40" cy="22" r="14" fill="currentColor" opacity="0.85" />
        <path
          d="M16 88c2-18 14-28 24-28s22 10 24 28"
          fill="currentColor"
          opacity="0.85"
        />
      </svg>
    )
  }
  if (gender === 'female') {
    return (
      <svg viewBox="0 0 80 96" className="h-[62%] w-[62%]" aria-hidden>
        <circle cx="40" cy="22" r="14" fill="currentColor" opacity="0.85" />
        <path
          d="M12 88c3-16 12-24 28-24s25 8 28 24"
          fill="currentColor"
          opacity="0.85"
        />
        <path d="M28 46c4 8 20 8 24 0" stroke="currentColor" strokeWidth="3" fill="none" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 80 96" className="h-[62%] w-[62%]" aria-hidden>
      <circle cx="40" cy="22" r="14" fill="currentColor" opacity="0.7" />
      <path
        d="M18 88c2-17 12-26 22-26s20 9 22 26"
        fill="currentColor"
        opacity="0.7"
      />
      <path d="M34 40h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const GENDER_TONE: Record<EmployeeGender, string> = {
  male: 'bg-sky-100 text-sky-700',
  female: 'bg-rose-100 text-rose-700',
  unknown: 'bg-stone-200 text-stone-500',
}

/** Фото сотрудника или placeholder по полу (если фото не загружено). */
export function EmployeePhoto({
  photoDataUrl,
  gender = 'unknown',
  alt = '',
  className = 'h-20 w-16 shrink-0 rounded-sm object-cover ring-1 ring-grid',
}: PhotoProps) {
  if (photoDataUrl) {
    return <img src={photoDataUrl} alt={alt} className={className} />
  }
  const resolvedGender = gender ?? 'unknown'
  const placeholderClass = className.replace(/\bobject-cover\b/g, '').trim()
  return (
    <div
      className={`flex items-center justify-center border border-grid ${GENDER_TONE[resolvedGender]} ${placeholderClass}`}
      aria-hidden={!alt}
      title={alt || undefined}
    >
      <GenderSilhouette gender={resolvedGender} />
    </div>
  )
}
