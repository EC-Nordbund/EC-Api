import { Express } from 'express'
import { changePWD, login } from '../users/users'
import { versions } from '../config/nichtErlaubteVersionen'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { ecError, errorHandler } from '../helpers/error'
import { saveSubscription, sendNotificationToAll } from '../helpers/web-push'

export default (app: Express): void => {
  /**
   * POST /v6/login
   *
   * Gibt einen Array aller Personen aus
   *
   * @name login
   * @noauth
   */
  app.post<
    emptyObj,
    { authToken: string },
    { username: string; password: string; version: string }
  >('/v6/login', async (req, res) => {
    try {
      if (!req.body.version || !req.body.username || !req.body.password) {
        throw new ecError('Daten sind nicht valid!', 400)
      }

      if (versions.includes(req.body.version)) {
        throw new ecError(
          'Version der Verwaltung ist veraltet und wird nicht unterstützt!',
          406
        )
      }

      const authToken = await login(req.body.username, req.body.password)

      res.json({ authToken })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /**
   * POST /v6/change-password
   *
   * Ändert das Passwort eines Nutzers
   *
   * @name changePassword
   */
  app.post<
    emptyObj,
    { status: true },
    { oldPassword: string; newPassword: string }
  >('/v6/change-password', async (req, res) => {
    await checkAuth(req)
    res.json({
      status: await changePWD(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        req.headers.authorization!,
        req.body.oldPassword,
        req.body.newPassword
      )
    })
  })

  /**
   * POST /v6/subscribe
   *
   * Speichert subscription
   *
   * @name subscribe
   */
  app.post<emptyObj, emptyObj, { subscription: any }>(
    '/v6/subscribe',
    async (req, res) => {
      try {
        console.log(req.body)
        console.log(req.body.subscription)
        const payload = await checkAuth(req)
        await saveSubscription(req.body.subscription, payload.userID)
        res.json({})
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get('/v6/test', async (req, res) => {
    await sendNotificationToAll({ body: 'Hello World!', title: 'testing' })
    res.end('DONE')
  })
}
