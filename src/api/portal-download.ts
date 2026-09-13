import { Express, Request, Response } from 'express'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import {
  BEREICH_NAME,
  MAX_BYTES,
  TYPEN_KLARTEXT,
  TYPEN_MIME,
  aendern,
  anlegen,
  ladeDatei,
  listeAlle,
  loeschen
} from '../portal/downloads'
import { PortalFehler } from '../portal/error'

/**
 * Pflege des Download-Bereichs aus EC-Verwaltung.
 *
 * Unter /v6 mit dem Verwaltungs-Token und der dortigen Fehlerkonvention
 * (text/plain) -- die Meldungen aus der Pruefung landen so direkt im
 * Fehlerdialog ("Die Datei ist 14,2 MB groß, erlaubt sind 10 MB").
 *
 * Der groessere json()-Parser fuer diesen Pfad steht in index.ts; er muss vor
 * dem allgemeinen /v6-Parser registriert sein.
 */

/** PortalFehler traegt einen Code, der errorHandler kennt nur ecError. */
function reiche(err: unknown): unknown {
  if (err instanceof PortalFehler) return new ecError(err.message, err.status)
  return err
}

function ganzzahl(wert: string): number {
  const n = parseInt(wert, 10)
  if (!n || n < 1) throw new ecError('Ungültige ID', 400)
  return n
}

export default (app: Express): void => {
  app.get('/v6/portal-download', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      res.json({
        dateien: await listeAlle(),
        bereiche: BEREICH_NAME,
        maxBytes: MAX_BYTES,
        typen: TYPEN_MIME,
        typenKlartext: TYPEN_KLARTEXT
      })
    } catch (err) {
      errorHandler(reiche(err), res)
    }
  })

  app.post('/v6/portal-download', async (req: Request, res: Response) => {
    try {
      const payload = await checkAuth(req)
      const downloadID = await anlegen(req.body ?? {}, payload.userID)
      res.status(201).json({ downloadID })
    } catch (err) {
      errorHandler(reiche(err), res)
    }
  })

  app.put('/v6/portal-download/:id', async (req: Request, res: Response) => {
    try {
      const payload = await checkAuth(req)
      await aendern(ganzzahl(req.params.id), req.body ?? {}, payload.userID)
      res.json({ status: 'OK' })
    } catch (err) {
      errorHandler(reiche(err), res)
    }
  })

  app.delete('/v6/portal-download/:id', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      await loeschen(ganzzahl(req.params.id))
      res.json({ status: 'OK' })
    } catch (err) {
      errorHandler(reiche(err), res)
    }
  })

  /**
   * Die Datei selbst -- damit sich in der Verwaltung nachsehen laesst, was
   * tatsaechlich hochgeladen wurde. Ohne das muesste man sich im Portal
   * anmelden, um die eigene Pflege zu kontrollieren.
   */
  app.get(
    '/v6/portal-download/:id/datei',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const { kopf, inhalt } = await ladeDatei(ganzzahl(req.params.id))
        res
          .type(kopf.mimetype)
          .set(
            'Content-Disposition',
            `attachment; filename="datei"; filename*=UTF-8''${encodeURIComponent(
              kopf.dateiname
            )}`
          )
          .send(inhalt)
      } catch (err) {
        errorHandler(reiche(err), res)
      }
    }
  )
}
