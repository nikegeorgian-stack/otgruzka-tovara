import type { ContainerReferenceType } from '../types'

export function looksLikeContainerNumber(ref: string): boolean {
  return /^[A-Z]{4}\d{7}$/i.test(ref.trim())
}

export function guessReferenceType(reference: string): ContainerReferenceType {
  const ref = reference.trim().toUpperCase()
  if (looksLikeContainerNumber(ref)) return 'container'
  if (/^\d{8,}$/.test(ref)) return 'booking'
  return 'container'
}
