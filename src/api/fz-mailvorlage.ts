import { Express, Request, Response } from 'express'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import {
  BEISPIELWERTE,
  ladeVersion,
  ladeVorlage,
  listeVersionen,
  listeVorlagen,
  speichereVorlage,
  stelleWiederHer
} from '../fzmail/vorlagen'

/**
 * Pflege der FZ-Mailtexte aus EC-Verwaltung.
 *
 * Unter /v6 mit dem Verwaltungs-Token, dortiger json()-Parser, dortige
 * Fehlerkonvention (text/plain) -- die Meldungen aus pruefeEingabe() landen so
 * direkt im Fehlerdialog der Verwaltung und sagen der Referentin, welcher
 * Platzhalter falsch geschrieben ist.
 *
 * Verschickt werden die Mails weiterhin vom FZ-System (eigenes Repo, PHP-Cron).
 * Die API kennt nur die Texte.
 */
export default (app: Express): void => {
  app.get('/v6/fz-mailvorlage', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      res.json({
        vorlagen: await listeVorlagen(),
        beispielwerte: BEISPIELWERTE
      })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.get(
    '/v6/fz-mailvorlage/:schluessel',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        res.json(await ladeVorlage(req.params.schluessel))
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.put(
    '/v6/fz-mailvorlage/:schluessel',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)

        const betreff = req.body?.betreff
        const text = req.body?.text
        if (typeof betreff !== 'string' || typeof text !== 'string') {
          throw new ecError('Betreff und Text müssen Text sein', 400)
        }

        await speichereVorlage(
          req.params.schluessel,
          betreff,
          text,
          payload.userID
        )
        res.json(await ladeVorlage(req.params.schluessel))
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get(
    '/v6/fz-mailvorlage/:schluessel/versionen',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        res.json({ versionen: await listeVersionen(req.params.schluessel) })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get(
    '/v6/fz-mailvorlage/:schluessel/version/:versionID',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const versionID = parseInt(req.params.versionID, 10)
        if (!versionID) throw new ecError('Ungültige Fassung', 400)
        res.json(await ladeVersion(req.params.schluessel, versionID))
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.post(
    '/v6/fz-mailvorlage/:schluessel/wiederherstellen',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        const versionID = parseInt(req.body?.versionID, 10)
        if (!versionID) throw new ecError('Ungültige Fassung', 400)

        await stelleWiederHer(req.params.schluessel, versionID, payload.userID)
        res.json(await ladeVorlage(req.params.schluessel))
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}
