import { Express } from 'express'
import { changePWD, login } from '../users/users'
import { versions } from '../config/nichtErlaubteVersionen'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { ecError, errorHandler } from '../helpers/error'

export default (app: Express): void => {
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
          'Benutze Version der Verwaltung ist veraltet und wird nicht unterstützt!',
          406
        )
      }

      const authToken = await login(req.body.username, req.body.password)

      res.json({ authToken })
    } catch (err) {
      errorHandler(err, res)
    }
  })

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
}
