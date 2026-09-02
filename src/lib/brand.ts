import logoLockupOnDarkUrl from '@/assets/fibercell-logo-on-dark.png'
import logoLockupOnLightUrl from '@/assets/fibercell-logo-on-light.png'
import logoMarkUrl from '@/assets/fibercell-mark.png'

/**
 * Бренд FiberCell (новое лого 2026).
 * - onLight: оранжевый знак + тёмный «Fibercell» — светлый UI / печать
 * - onDark: белый знак+текст на оранжевой плашке — тёмный фон / акценты
 * - mark: только знак (favicon, этикетки, watermark)
 */
export const BRAND = {
  mark: logoMarkUrl,
  lockupOnLight: logoLockupOnLightUrl,
  lockupOnDark: logoLockupOnDarkUrl,
  /** @deprecated используйте lockupOnLight */
  wordmark: logoLockupOnLightUrl,
  accent: '#EF6521',
} as const
