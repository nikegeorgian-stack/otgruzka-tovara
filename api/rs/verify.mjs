import { verifyRsAuth } from '../../server/rs/soap.mjs'

import { resolveRsCredentials, verifySysAdminRequest } from './_store.mjs'



/** POST — проверить сохранённый логин/пароль у RS.ge (без TIN сотрудника). */

export default async function handler(req, res) {

  if (req.method !== 'POST') {

    res.status(405).json({ error: 'method_not_allowed' })

    return

  }



  const auth = await verifySysAdminRequest(req)

  if (!auth.ok) {

    res.status(auth.status).json({ ok: false, error: auth.error })

    return

  }



  try {

    const creds = await resolveRsCredentials()

    if (!creds) {

      res.status(503).json({ ok: false, authOk: false, error: 'rs_not_configured' })

      return

    }

    const result = await verifyRsAuth({

      username: creds.username,

      password: creds.password,

    })

    res.status(200).json(result)

  } catch (err) {

    console.error('rs verify failed', err)

    res.status(500).json({ ok: false, authOk: false, error: 'rs_failed' })

  }

}


