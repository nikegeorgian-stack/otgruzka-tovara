import { afterEach, describe, expect, it } from 'vitest'

describe('resolveFirebaseStorageBucket', () => {
  const prev = { ...process.env }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k]
    }
    Object.assign(process.env, prev)
    // drop module cache so env re-read — import fresh via dynamic after reset not needed:
    // function reads process.env at call time
  })

  it('prefers FST_FIREBASE_STORAGE_BUCKET env', async () => {
    process.env.FST_FIREBASE_STORAGE_BUCKET = 'custom-bucket.example'
    process.env.FST_CLOUD_ENV = 'staging'
    const { resolveFirebaseStorageBucket } = await import('../server/fst/_adminAuth.mjs')
    expect(resolveFirebaseStorageBucket('otgruzka-tovara-stg')).toBe('custom-bucket.example')
  })

  it('defaults staging project to .firebasestorage.app', async () => {
    delete process.env.FST_FIREBASE_STORAGE_BUCKET
    process.env.FST_CLOUD_ENV = 'staging'
    const { resolveFirebaseStorageBucket } = await import('../server/fst/_adminAuth.mjs')
    expect(resolveFirebaseStorageBucket('otgruzka-tovara-stg')).toBe(
      'otgruzka-tovara-stg.firebasestorage.app',
    )
  })

  it('does not invent a production bucket from empty env', async () => {
    delete process.env.FST_FIREBASE_STORAGE_BUCKET
    delete process.env.FST_CLOUD_ENV
    delete process.env.VERCEL_ENV
    delete process.env.FST_EXPECTED_FIREBASE_PROJECT_ID
    const { resolveFirebaseStorageBucket } = await import('../server/fst/_adminAuth.mjs')
    expect(resolveFirebaseStorageBucket('otgruzka-tovara')).toBeUndefined()
  })
})
