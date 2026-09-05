/**
 * «Запомнить учётную запись» на экране входа.
 * Email — всегда в localStorage.
 * Пароль:
 *  - Windows Electron → OS safeStorage (шифр ОС);
 *  - веб — пароль НЕ сохраняем (ключ AES в localStorage не даёт реальной защиты).
 */

const STORAGE_KEY = 'fst-remember-account-v1'
const WEB_KEY_STORAGE = 'fst-remember-account-key-v1'

export type RememberedAccount = {
  email: string
  password?: string
}

type StoredBlob = {
  email: string
  /** base64 от Electron safeStorage */
  passwordSafe?: string
  /** AES-GCM payload (base64url) для веб — legacy, больше не пишем */
  passwordWeb?: string
  rememberPassword: boolean
}

declare global {
  interface Window {
    otgruzkaDesktop?: {
      isDesktop?: boolean
      canEncrypt: () => Promise<boolean>
      encryptString: (plain: string) => Promise<string | null>
      decryptString: (payload: string) => Promise<string | null>
    }
  }
}

function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && Boolean(window.otgruzkaDesktop?.isDesktop)
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const str = atob(b64)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes.buffer
}

async function getOrCreateWebKey(): Promise<CryptoKey> {
  const raw = localStorage.getItem(WEB_KEY_STORAGE)
  if (raw) {
    const jwk = JSON.parse(raw) as JsonWebKey
    return crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ])
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const jwk = await crypto.subtle.exportKey('jwk', key)
  localStorage.setItem(WEB_KEY_STORAGE, JSON.stringify(jwk))
  return key
}

async function decryptWeb(payload: string): Promise<string | null> {
  try {
    const key = await getOrCreateWebKey()
    const combined = new Uint8Array(base64urlToBuffer(payload))
    const iv = combined.slice(0, 12)
    const cipher = combined.slice(12)
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return new TextDecoder().decode(dec)
  } catch {
    return null
  }
}

function readBlob(): StoredBlob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredBlob
    if (!parsed.email?.trim()) return null
    return parsed
  } catch {
    return null
  }
}

export function hasRememberedAccount(): boolean {
  return readBlob() !== null
}

export function clearRememberedAccount(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(WEB_KEY_STORAGE)
}

/** Загрузить сохранённый email/пароль (если были). */
export async function loadRememberedAccount(): Promise<{
  email: string
  password: string
  rememberPassword: boolean
} | null> {
  const blob = readBlob()
  if (!blob) return null
  let password = ''
  if (blob.rememberPassword) {
    if (blob.passwordSafe && window.otgruzkaDesktop) {
      password = (await window.otgruzkaDesktop.decryptString(blob.passwordSafe)) ?? ''
    } else if (isDesktopShell() && blob.passwordWeb) {
      // Legacy web AES — только если вдруг оказались в desktop без safeStorage
      password = (await decryptWeb(blob.passwordWeb)) ?? ''
    }
    // Веб-браузер: намеренно не расшифровываем passwordWeb (и чистим при следующем save).
  }
  return {
    email: blob.email,
    password,
    rememberPassword: Boolean(blob.rememberPassword && password),
  }
}

/** Сохранить учётку. На вебе — только email; пароль — только OS safeStorage (desktop). */
export async function saveRememberedAccount(input: {
  email: string
  password?: string
  rememberPassword: boolean
}): Promise<void> {
  const email = input.email.trim()
  if (!email) {
    clearRememberedAccount()
    return
  }

  const blob: StoredBlob = {
    email,
    rememberPassword: false,
  }

  if (input.rememberPassword && input.password && isDesktopShell() && window.otgruzkaDesktop) {
    const can = await window.otgruzkaDesktop.canEncrypt()
    if (can) {
      const enc = await window.otgruzkaDesktop.encryptString(input.password)
      if (enc) {
        blob.passwordSafe = enc
        blob.rememberPassword = true
      }
    }
  }

  // Стираем legacy web-шифр с диска браузера
  localStorage.removeItem(WEB_KEY_STORAGE)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
}

export function isOtgruzkaDesktopApp(): boolean {
  return isDesktopShell()
}

/** На вебе «запомнить» = только email (без пароля). */
export function canRememberPasswordOnThisDevice(): boolean {
  return isDesktopShell()
}
