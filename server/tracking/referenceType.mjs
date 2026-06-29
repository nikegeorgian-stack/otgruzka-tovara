/** ISO 6346: 4 буквы + 7 цифр */
export function looksLikeContainerNumber(ref) {
  return /^[A-Z]{4}\d{7}$/i.test(String(ref ?? '').trim())
}

export function guessReferenceType(reference) {
  const ref = String(reference ?? '').trim().toUpperCase()
  if (looksLikeContainerNumber(ref)) return 'container'
  if (/^[A-Z]{3,4}[A-Z0-9]{8,12}$/.test(ref)) return 'bl'
  if (/^\d{8,}$/.test(ref)) return 'booking'
  return 'container'
}

export function referenceTypesToTry(reference, referenceType) {
  const guessed = guessReferenceType(reference)
  const order = [referenceType, guessed, 'container', 'booking', 'bl']
  return [...new Set(order.filter(Boolean))]
}

/** Отсекаем демо-ответ MSC API (чужие номера контейнеров) */
export function filterEventsForReference(events, reference) {
  const ref = String(reference ?? '').trim().toUpperCase()
  if (!events.length) return events

  const withEquipment = events.filter((e) => {
    const eq = String(e.equipmentReference ?? e.raw?.equipmentReference ?? '').toUpperCase()
    return eq && eq === ref
  })
  if (withEquipment.length) return withEquipment

  const mentioned = events.filter((e) => {
    const blob = JSON.stringify(e.raw ?? e).toUpperCase()
    return blob.includes(ref)
  })
  if (mentioned.length) return mentioned

  return []
}
