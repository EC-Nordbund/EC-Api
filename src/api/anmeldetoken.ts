import { Express } from 'express'
import { json } from 'body-parser'
import { checkAuth } from '../auth'
import { errorHandler } from '../helpers/error'
import { query } from '../helpers/mysql'
import { createToken } from '../nuxt/jwt'

/**
 * Mitarbeiter-Anmeldelinks für eine Veranstaltung erzeugen (Ablösung des
 * alten externen /api-v4/anmeldetoken-Dienstes).
 *
 * Pro Rolle (rollen.rollenID >= 2, dynamisch aus der DB) wird ein JWT mit
 * Payload { d: "<veranstaltungsID>|<position>" } signiert — exakt das Format,
 * das /nuxt/anmeldung/ma/* der Website-Anmeldung erwartet. Gültigkeit:
 * bis einen Tag nach Veranstaltungsbeginn, gekappt auf 100 Tage (das war
 * schon immer der kommunizierte Rahmen der Links).
 */
export default (app: Express): void => {
  app.post('/v6/anmeldetoken', json(), async (req, res) => {
    try {
      await checkAuth(req)

      const veranstaltungsID = parseInt(req.body?.id)
      if (!Number.isInteger(veranstaltungsID) || veranstaltungsID <= 0) {
        res.status(400)
        res.json({ error: 'id (veranstaltungsID) fehlt oder ungültig' })
        return
      }

      const vRows = await query<{ bezeichnung: string; begin: Date }>(
        `SELECT bezeichnung, \`begin\` FROM veranstaltungen WHERE veranstaltungsID = ${veranstaltungsID}`
      )
      if (vRows.length === 0) {
        res.status(404)
        res.json({ error: 'Veranstaltung nicht gefunden' })
        return
      }

      // Link-Gültigkeit: bis begin + 1 Tag, maximal 100 Tage, mindestens 1 h
      const MAX = 100 * 24 * 60 * 60
      const untilBegin = Math.floor(
        (new Date(vRows[0].begin).getTime() +
          24 * 60 * 60 * 1000 -
          Date.now()) /
          1000
      )
      const expiresIn = Math.max(60 * 60, Math.min(MAX, untilBegin))

      const rollen = await query<{ rollenID: number; bezeichnung: string }>(
        'SELECT rollenID, bezeichnung FROM rollen WHERE rollenID >= 2 ORDER BY rollenID'
      )

      const data = await Promise.all(
        rollen.map(async (rolle) => {
          const token = await createToken(
            { d: `${veranstaltungsID}|${rolle.rollenID}` },
            expiresIn
          )
          return {
            position: rolle.rollenID,
            bezeichnung: rolle.bezeichnung,
            token,
            url: `https://www.ec-nordbund.de/anmeldung/mitarbeiter/${token}`
          }
        })
      )

      res.json({
        veranstaltung: vRows[0].bezeichnung,
        gueltigTage: Math.round(expiresIn / (24 * 60 * 60)),
        data
      })
    } catch (error) {
      errorHandler(error, res)
    }
  })
}
