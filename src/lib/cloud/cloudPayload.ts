import { stripUndefinedDeep } from './firestoreSanitize'
import type { AppStore } from '@/lib/types'

export type PreparedCloudPayload = {
  payload: AppStore
  json: string
  bytes: number
  fingerprint: string
}

/** Быстрый отпечаток JSON для пропуска повторной записи в Firestore. */
export function fingerprintJson(json: string): string {
  let h = 5381
  for (let i = 0; i < json.length; i++) h = (h * 33) ^ json.charCodeAt(i)
  return `${json.length}:${h >>> 0}`
}

/** Один проход: очистка undefined + сериализация (дорого — не дублировать). */
export function prepareCloudPayload(store: AppStore): PreparedCloudPayload {
  const payload = stripUndefinedDeep(store)
  const json = JSON.stringify(payload)
  return {
    payload,
    json,
    bytes: json.length,
    fingerprint: fingerprintJson(json),
  }
}
