import { Express, Request, Response } from 'express'
import expressRateLimit from 'express-rate-limit'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import { clientIp } from '../portal/audit'
import { loeschen, ruecknahme, type Ziel } from '../anmeldung/aktionen'
import { hatProtokollTabelle, leseProtokoll } from '../anmeldung/protokoll'

/**
 * Eingreifende Aktionen auf einer Anmeldung und deren Protokoll.
 *
 * Unter /v6 mit dem Verwaltungs-Token und der dortigen Fehlerkonvention
 * (text/plain), damit die Meldungen direkt im Fehlerdialog der Verwaltung
 * stehen ("Auf dieser Anmeldung stehen noch 45,00 € offen …").
 *
 * Bewusst KEIN GraphQL, obwohl die Anmeldungsmaske sonst darueber laeuft:
 * `handleAuth` in helpers/sonstiges.ts verwirft das Token-Payload, waehrend
 * `checkAuth` hier die userID liefert. Ein Protokoll ohne Urheber waere die
 * halbe Sache -- und dieselbe Ueberlegung fuehrte schon bei der
 * Dubletten-Pflege zu REST (siehe api/dubletten.ts).
 *
 * Bekannte Einschraenkung: checkAuth kennt keine Rollen, jeder gueltige
 * Verwaltungs-Token darf loeschen. Das ist der Stand des gesamten /v6- und
 * GraphQL-Bereichs und wird hier nicht verschaerft; abgefedert wird es durch
 * das Protokoll.
 */

/**
 * 20 Loeschungen pro Minute liegen weit ueber Menschengeschwindigkeit und
 * begrenzen den Schaden, wenn eine Client-Schleife durchdreht -- jede
 * Loeschung entfernt einen Datensatz endgueltig.
 */
const loeschLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 20
})

/**
 * anmeldeIDs sind Buchstaben und Ziffern (aus Namensanfang, Kurzbezeichnung,
 * Jahr, Zufall und Rolle zusammengesetzt) -- Umlaute inklusive, weil der
 * Namensanfang ungefiltert eingeht. Bindestrich und Unterstrich zusaetzlich,
 * weil aelter angelegte bzw. von Hand vergebene IDs sie enthalten (die
 * Demo-Daten etwa "SF27-TN-001"). Die Werte werden ohnehin gebunden, die
 * Pruefung faengt nur Unsinn ab.
 */
function anmeldeID(wert: unknown): string {
  const id = String(wert ?? '')
  if (!/^[\p{L}\p{N}_-]{1,15}$/u.test(id)) {
    throw new ecError('Ungültige AnmeldeID.', 400)
  }
  return id
}

/**
 * Die Begruendung ist Pflicht und nicht nur Formsache: sie ist im Protokoll
 * das Einzige, was das Warum festhaelt. Zahlen und Status stehen ohnehin drin.
 */
function begruendung(wert: unknown): string {
  const text = String(wert ?? '').trim()
  if (text.length < 3) {
    throw new ecError(
      'Bitte gib eine Begründung an (mindestens 3 Zeichen).',
      400
    )
  }
  return text.slice(0, 500)
}

function ganzzahl(wert: unknown): number | undefined {
  const n = Number(wert)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** Fehlt das Schema, gibt es kein Protokoll -- und ohne Protokoll keinen Eingriff. */
async function pruefeSchema(): Promise<void> {
  if (!(await hatProtokollTabelle())) {
    throw new ecError(
      'Das Protokoll (sql/anmeldung-protokoll.sql) ist in dieser Datenbank nicht ' +
        'eingespielt. Rücknahme und Löschung sind deshalb gesperrt.',
      503
    )
  }
}

export default (app: Express): void => {
  /* ------------------------------------------------------------- Protokoll -- */
  /**
   * Filter sind anmeldeID, personID und veranstaltungsID. Ohne Filter kommt
   * eine leere Liste: eine ungefilterte Gesamtausgabe waere eine Liste aller
   * Ab- und Ummeldungen des Verbandes und gehoert nicht in eine Detailmaske.
   */
  app.get('/v6/anmeldung/protokoll', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      if (!(await hatProtokollTabelle())) {
        res.json({ eintraege: [], schemaHinweis: schemaHinweis() })
        return
      }
      const eintraege = await leseProtokoll({
        anmeldeID: req.query.anmeldeID
          ? anmeldeID(req.query.anmeldeID)
          : undefined,
        personID: ganzzahl(req.query.personID),
        veranstaltungsID: ganzzahl(req.query.veranstaltungsID)
      })
      res.json({ eintraege, schemaHinweis: null })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /* ------------------------------------------------------------- Ruecknahme -- */
  app.post(
    '/v6/anmeldung/:anmeldeID/ruecknahme',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await pruefeSchema()

        const ziel = String(req.body?.ziel ?? '')
        if (ziel !== 'angemeldet' && ziel !== 'warteliste') {
          throw new ecError(
            'Unbekanntes Ziel – erlaubt sind "angemeldet" und "warteliste".',
            400
          )
        }

        const ergebnis = await ruecknahme(
          anmeldeID(req.params.anmeldeID),
          ziel as Ziel,
          begruendung(req.body?.begruendung),
          payload.userID,
          clientIp(req)
        )
        res.json(ergebnis)
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /* ---------------------------------------------------------------- Loeschen -- */
  /**
   * POST und nicht DELETE: die Begruendung gehoert zwingend in den Body, und
   * Bodies an DELETE-Anfragen werden von Proxys und Clients gern kommentarlos
   * verworfen. Bei einer Aktion, deren einziger bleibender Beleg das Protokoll
   * ist, ist das kein akzeptables Risiko.
   */
  app.post(
    '/v6/anmeldung/:anmeldeID/loeschen',
    loeschLimiter,
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await pruefeSchema()

        const ergebnis = await loeschen(
          anmeldeID(req.params.anmeldeID),
          begruendung(req.body?.begruendung),
          req.body?.trotzOffenerZahlung === true,
          payload.userID,
          clientIp(req)
        )
        res.json(ergebnis)
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}

function schemaHinweis(): string {
  return (
    'sql/anmeldung-protokoll.sql ist nicht eingespielt. Abmeldungen können ' +
    'deshalb weder zurückgenommen noch gelöscht werden.'
  )
}
