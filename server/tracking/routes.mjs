import { getCapabilities, syncTracking } from './sync.mjs'

export function registerTrackingRoutes(app, auth) {
  app.get('/api/tracking/capabilities', auth, (_req, res) => {
    res.json(getCapabilities())
  })

  app.post('/api/tracking/sync', auth, async (req, res) => {
    const { carrier, reference, referenceType, currentStatus } = req.body ?? {}
    const result = await syncTracking({
      carrier,
      reference,
      referenceType,
      currentStatus,
    })
    res.status(result.ok ? 200 : result.configured === false ? 200 : 502).json(result)
  })
}
