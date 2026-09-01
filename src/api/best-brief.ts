import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import {
  createBriefVeranstaltung,
  createBriefAnmeldung
} from '../helpers/bestMail'

// Lauf-Sperre: ein Serienversand pro Veranstaltung zur Zeit. Ohne Sperre
// führte ein zweiter Klick (der alte Endpoint antwortete nie, sah also
// immer wie ein Fehler aus) zu parallelen Läufen und Doppelversand.
const laufendeVeranstaltungen = new Set<number>()

export default (app: Express): void => {
  app.get<{ target: string }, any, emptyObj>(
    '/v6/best-brief/anmeldung/:target',
    async (req, res) => {
      try {
        await checkAuth(req)

        const anmeldeID = req.params.target

        await createBriefAnmeldung(anmeldeID)

        res.json({ status: 'OK', anmeldeID })
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )

  app.get<{ target: string }, any, emptyObj>(
    '/v6/best-brief/veranstaltung/:target',
    async (req, res) => {
      try {
        await checkAuth(req)

        const veranstaltung = parseInt(req.params.target)
        if (!Number.isInteger(veranstaltung) || veranstaltung <= 0) {
          res.status(400)
          res.json({ status: 'ERROR', context: 'Ungültige veranstaltungsID' })
          return
        }

        if (laufendeVeranstaltungen.has(veranstaltung)) {
          res.status(409)
          res.json({
            status: 'RUNNING',
            context:
              'Für diese Veranstaltung läuft bereits ein Serienversand — bitte warten.'
          })
          return
        }

        laufendeVeranstaltungen.add(veranstaltung)
        try {
          const report = await createBriefVeranstaltung(veranstaltung)
          res.json({ status: 'OK', ...report })
        } finally {
          laufendeVeranstaltungen.delete(veranstaltung)
        }
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )
}
