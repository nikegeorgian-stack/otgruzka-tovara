/** Локальная SQLite-база на диске (общая для всех браузеров на этом ПК). */
export const USE_LOCAL_DB = import.meta.env.VITE_LOCAL_DB === 'true'

/** API store (через Vite proxy в dev: /api → localhost:3847). */
export const LOCAL_DB_API = import.meta.env.VITE_LOCAL_DB_API || '/api'

export const LOCAL_DB_POLL_MS = 3000
export const LOCAL_DB_SAVE_DEBOUNCE_MS = 400
