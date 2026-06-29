import { lookupCecVoterServer } from './lookup.mjs'

export function registerCecRoutes(app, auth) {
  app.post('/api/cec/voter-lookup', auth, async (req, res) => {
    const { personalId, surname } = req.body ?? {}
    const result = await lookupCecVoterServer({ personalId, surname })
    res.status(result.ok ? 200 : 502).json(result)
  })
}
