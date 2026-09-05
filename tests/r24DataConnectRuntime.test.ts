/**
 * PHASE R2.4 — Data Connect runtime routing + Preview fail-closed isolation.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  FST_DC_DEFAULT_SERVICE_ID,
  FST_STAGING_PROJECT_ID,
  FST_STAGING_SERVICE_ID,
  isStagingIsolatedRuntime,
  resolveAdminDataConnectConfig,
} from '../server/fst/_dataConnectRuntime.mjs'
import { assertStagingServiceAccountIsolation } from '../server/fst/_adminAuth.mjs'

const ENV_KEYS = [
  'VERCEL_ENV',
  'FST_CLOUD_ENV',
  'FST_EXPECTED_FIREBASE_PROJECT_ID',
  'FST_SQL_CONNECT_SERVICE_ID',
  'FST_SQL_CONNECT_LOCATION',
  'FST_SQL_CONNECT_CONNECTOR',
  'FST_DATACONNECT_SERVICE_ID',
]

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('r24 data connect runtime', () => {
  it('defaults to production service/location/connector', () => {
    const cfg = resolveAdminDataConnectConfig({
      connector: 'fst-admin',
      serviceId: FST_DC_DEFAULT_SERVICE_ID,
      location: 'europe-west3',
    })
    expect(cfg.serviceId).toBe(FST_DC_DEFAULT_SERVICE_ID)
    expect(cfg.location).toBe('europe-west3')
    expect(cfg.connector).toBe('fst-admin')
    expect(isStagingIsolatedRuntime()).toBe(false)
  })

  it('applies env overrides without staging isolation', () => {
    process.env.FST_SQL_CONNECT_SERVICE_ID = 'custom-service'
    process.env.FST_SQL_CONNECT_LOCATION = 'us-central1'
    const cfg = resolveAdminDataConnectConfig({
      connector: 'fst-admin',
      serviceId: FST_DC_DEFAULT_SERVICE_ID,
      location: 'europe-west3',
    })
    expect(cfg.serviceId).toBe('custom-service')
    expect(cfg.location).toBe('us-central1')
  })

  it('Preview requires staging service id', () => {
    process.env.VERCEL_ENV = 'preview'
    expect(isStagingIsolatedRuntime()).toBe(true)
    expect(() =>
      resolveAdminDataConnectConfig({
        connector: 'fst-admin',
        serviceId: FST_DC_DEFAULT_SERVICE_ID,
        location: 'europe-west3',
      }),
    ).toThrow(/dataconnect_staging_service_required/)
  })

  it('Preview accepts exact staging service id', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.FST_SQL_CONNECT_SERVICE_ID = FST_STAGING_SERVICE_ID
    const cfg = resolveAdminDataConnectConfig({
      connector: 'fst-admin',
      serviceId: FST_DC_DEFAULT_SERVICE_ID,
      location: 'europe-west3',
    })
    expect(cfg.serviceId).toBe(FST_STAGING_SERVICE_ID)
  })

  it('rejects Preview SA for non-staging project without printing JSON', () => {
    process.env.VERCEL_ENV = 'preview'
    const raw = JSON.stringify({
      type: 'service_account',
      project_id: 'otgruzka-tovara',
      private_key: 'REDACTED',
    })
    expect(() => assertStagingServiceAccountIsolation(raw)).toThrow(
      /staging_service_account_project_mismatch/,
    )
  })

  it('accepts Preview SA for staging project', () => {
    process.env.VERCEL_ENV = 'preview'
    const raw = JSON.stringify({
      type: 'service_account',
      project_id: FST_STAGING_PROJECT_ID,
    })
    expect(() => assertStagingServiceAccountIsolation(raw)).not.toThrow()
  })
})
