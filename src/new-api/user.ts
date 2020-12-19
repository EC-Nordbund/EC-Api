import { Express } from 'express'
import { changePWD, login } from '../users'
import { versions } from '../nichtErlaubteVersionen'
import { checkAuth } from '../auth'
import { emptyObj } from '../types'

export default (app: Express, base: string) => {
  app.post<
    emptyObj,
    emptyObj,
    { username: string; password: string; version: string }
  >(base + '/login', async (req, res, next) => {
    await checkAuth(req, res)

    if (versions.includes(req.body.version)) {
      throw new Error(
        'Benutze Version der Verwaltung ist veraltet und wird nicht unterstützt!'
      )
    }

    return login(req.body.username, req.body.password)
  })

  app.post<emptyObj, emptyObj, { oldPassword: string; newPassword: string }>(
    base + '/change-password',
    async (req, res, next) => {
      await checkAuth(req, res)
      return changePWD(
        req.headers.authorization!,
        req.body.oldPassword,
        req.body.newPassword
      )
    }
  )
}
