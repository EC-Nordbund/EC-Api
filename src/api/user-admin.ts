import { Express, Request, Response } from 'express'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import {
  ganzzahl,
  legeUserAn,
  listeUser,
  setzeAblaufDatum,
  setzePasswort,
  sperreUser
} from '../users/admin'

/**
 * Administration der Verwaltungs-Konten aus EC-Verwaltung
 * (Sonstiges -> Administration).
 *
 * Unter /v6 mit dem Verwaltungs-Token, dortiger json()-Parser, dortige
 * Fehlerkonvention (text/plain). Keine Rollenprüfung: jeder angemeldete
 * Benutzer ist Admin. Eine Route zum Löschen gibt es absichtlich nicht
 * (Begründung in users/admin.ts).
 */
export default (app: Express): void => {
  app.get('/v6/user', async (req: Request, res: Response) => {
    try {
      const payload = await checkAuth(req)
      res.json({ users: await listeUser(), eigeneUserID: payload.userID })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.post('/v6/user', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      const userID = await legeUserAn({
        personID: req.body?.personID,
        username: req.body?.username,
        passwort: req.body?.passwort,
        ablaufDatum: req.body?.ablaufDatum
      })
      res.status(201).json({ userID })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /**
   * PATCH /v6/user/:id
   *
   * Genau eine der drei Änderungen je Aufruf:
   * `{ gesperrt: true }`, `{ ablaufDatum: 'JJJJ-MM-TT' }` (verlängern bzw.
   * entsperren) oder `{ passwort: '…' }`.
   */
  app.patch('/v6/user/:id', async (req: Request, res: Response) => {
    try {
      const payload = await checkAuth(req)
      const userID = ganzzahl(req.params.id)
      if (!userID) throw new ecError('Ungültige ID', 400)

      if (req.body?.gesperrt === true) {
        await sperreUser(userID, payload.userID)
      } else if (req.body?.ablaufDatum !== undefined) {
        await setzeAblaufDatum(userID, req.body.ablaufDatum, payload.userID)
      } else if (req.body?.passwort !== undefined) {
        await setzePasswort(userID, req.body.passwort)
      } else {
        throw new ecError('Keine Änderung übermittelt.', 400)
      }
      res.json({})
    } catch (err) {
      errorHandler(err, res)
    }
  })
}
