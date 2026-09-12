import { Express, Request, Response } from 'express'
import expressRateLimit from 'express-rate-limit'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import { queryP } from '../helpers/mysql'
import { entfernePaar, hole, invalidiere } from '../dubletten/cache'
import { bewertePaar } from '../dubletten/erkennung'
import {
  listeKeineDubletten,
  loescheKeinDuplikat,
  markiereKeinDuplikat,
  paarKey
} from '../dubletten/keine'
import {
  kollisionenVorschau,
  mergePersonen,
  type AnmeldungStrategie,
  type LoginStrategie
} from '../dubletten/merge'
import { hatSchemaErweiterung, schemaHinweis } from '../dubletten/schema'

/**
 * Dubletten-Pflege fuer Personen (Oberflaeche: EC-Verwaltung /#/dublikate/personen).
 *
 * Routen liegen unter /v6: dort sind json() und die Fehlerkonvention der
 * Verwaltung (text/plain) schon registriert, und checkAuth nimmt denselben
 * Token wie alle anderen Masken.
 *
 * Bewusst KEIN GraphQL -- die Vorschlagsliste und die "kein Duplikat"-Markierung
 * sind neu und werden als REST gebaut; der Merge nutzt dieselbe Funktion wie die
 * bestehende Mutation `mergePersons`, es entsteht also kein zweiter Merge-Pfad.
 *
 * Bekannte Einschraenkung, die fuer eine loeschende Aktion erwaehnenswert ist:
 * checkAuth kennt keine Rollen, jeder gueltige Verwaltungs-Token darf mergen.
 * Das ist der Stand des gesamten /v6- und GraphQL-Bereichs und wird hier nicht
 * verschaerft; abgefedert wird es durch das Protokoll in `dublettenLog`.
 */

/**
 * Die Neuberechnung ist CPU-teuer (ein voller Paarvergleich) -- ohne eigene
 * Bremse waere das ein offener Angriffspunkt, auch wenn das /v6-Limit
 * grosszuegig ist.
 */
const neuBerechnenLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 6
})

/**
 * 30 Zusammenfuehrungen pro Minute liegen weit ueber Menschengeschwindigkeit.
 * Die Grenze begrenzt den Schaden, wenn eine Client-Schleife durchdreht -- jeder
 * Merge loescht einen Personensatz.
 */
const mergeLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 30
})

function ganzzahl(v: unknown, name: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) {
    throw new ecError(`${name} muss eine positive Ganzzahl sein.`, 400)
  }
  return n
}

/** Klemmt einen Zahlenparameter in einen erlaubten Bereich. */
function klemme(
  v: unknown,
  min: number,
  max: number,
  standard: number
): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return standard
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export default (app: Express): void => {
  /* ------------------------------------------------------- Kandidatenliste -- */

  /**
   * GET /v6/dubletten/kandidaten
   *
   * Liefert die Vorschlagsliste aus dem Cache. Die Personendaten sind
   * eingebettet, damit die Seite mit einem einzigen Request auskommt.
   */
  app.get('/v6/dubletten/kandidaten', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      const min = klemme(req.query.min, 40, 200, 0)
      const limit = klemme(req.query.limit, 1, 500, 200)
      const offset = klemme(req.query.offset, 0, 100000, 0)

      const c = await hole()
      const gefiltert =
        min > 0 ? c.paare.filter((p) => p.score >= min) : c.paare
      const seite = gefiltert.slice(offset, offset + limit)

      res.json({
        berechnetAm: c.berechnetAm,
        dauerMs: c.dauerMs,
        anzahlPersonen: c.anzahlPersonen,
        anzahlPaare: gefiltert.length,
        abgeschnitten: c.abgeschnitten,
        schemaHinweis: await schemaHinweis(),
        paare: seite
      })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /**
   * POST /v6/dubletten/neu-berechnen
   *
   * Erzwingt einen Lauf, auch wenn der Cache noch gueltig waere.
   */
  app.post(
    '/v6/dubletten/neu-berechnen',
    neuBerechnenLimiter,
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const c = await hole(true)
        res.json({
          status: 'OK',
          berechnetAm: c.berechnetAm,
          dauerMs: c.dauerMs,
          anzahlPaare: c.paare.length
        })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------------ Paar-Detail -- */

  /**
   * GET /v6/dubletten/paar/:idA/:idB
   *
   * Volldaten beider Saetze, Bewertung und der kollisionen-Block. Liest frisch
   * aus der Datenbank statt aus dem Cache: Kontaktdaten koennen sich geaendert
   * haben, und die Oberflaeche entscheidet hier ueber einen irreversiblen
   * Vorgang.
   *
   * Nimmt bewusst beliebige IDs an, auch Paare unter der Schwelle -- das ist
   * auch das Werkzeug, mit dem man nachsieht, warum ein Paar NICHT
   * vorgeschlagen wird.
   */
  app.get(
    '/v6/dubletten/paar/:idA/:idB',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const idA = ganzzahl(req.params.idA, 'idA')
        const idB = ganzzahl(req.params.idB, 'idB')
        if (idA === idB) {
          throw new ecError('Es müssen zwei verschiedene Personen sein.', 400)
        }

        const bewertung = await bewertePaar(idA, idB)
        if (!bewertung) {
          throw new ecError(
            'Mindestens eine der beiden Personen existiert nicht oder ist anonymisiert.',
            404
          )
        }

        const personen = await Promise.all([
          ladePersonVoll(idA),
          ladePersonVoll(idB)
        ])

        // Reihenfolge: Vorschlag zuerst, damit die Oberflaeche die empfohlene
        // Richtung hervorheben kann, ohne selbst zu sortieren.
        const kollisionen = await kollisionenVorschau(
          bewertung.vorschlagBehalten,
          bewertung.vorschlagBehalten === idA ? idB : idA
        )

        const { key } = paarKey(idA, idB)
        const ignoriertZeilen = await queryP(
          `SELECT 1 FROM keinedublikate
            WHERE (personID_1 = ? AND personID_2 = ?)
               OR (personID_1 = ? AND personID_2 = ?)`,
          [idA, idB, idB, idA]
        )

        res.json({
          paarKey: key,
          imVorschlag: bewertung.imVorschlag,
          ignoriert: ignoriertZeilen.length > 0,
          score: bewertung.score,
          stufe: bewertung.stufe,
          gruende: bewertung.gruende,
          vorschlagBehalten: bewertung.vorschlagBehalten,
          begruendungBehalten: bewertung.begruendungBehalten,
          personen,
          kollisionen,
          schemaHinweis: await schemaHinweis()
        })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------------------ Merge -- */

  /**
   * POST /v6/dubletten/merge
   *
   * Body: { personID_behalten, personID_entfernen, loginStrategie?,
   *         anmeldungStrategie? }
   */
  app.post(
    '/v6/dubletten/merge',
    mergeLimiter,
    async (req: Request, res: Response) => {
      try {
        const token = await checkAuth(req)
        const behalten = ganzzahl(
          req.body?.personID_behalten,
          'personID_behalten'
        )
        const entfernen = ganzzahl(
          req.body?.personID_entfernen,
          'personID_entfernen'
        )

        const loginStrategie = pruefeStrategie<LoginStrategie>(
          req.body?.loginStrategie,
          ['abbrechen', 'uebernehmen', 'verwerfen'],
          'loginStrategie'
        )
        const anmeldungStrategie = pruefeStrategie<AnmeldungStrategie>(
          req.body?.anmeldungStrategie,
          ['abbrechen', 'verwerfenAbgemeldet'],
          'anmeldungStrategie'
        )

        const ergebnis = await mergePersonen(behalten, entfernen, {
          loginStrategie,
          anmeldungStrategie,
          durchgefuehrtVon: token.userID,
          score: Number(req.body?.score) || 0
        })

        res.json({ status: 'OK', ...ergebnis })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /* --------------------------------------------------------- kein Duplikat -- */

  /**
   * GET /v6/dubletten/kein-duplikat
   *
   * Die Review-Ansicht: welche Paare wurden von wem wann als "kein Duplikat"
   * abgehakt. Ohne diese Liste waere das Zuruecknehmen blind.
   */
  app.get(
    '/v6/dubletten/kein-duplikat',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        if (!(await hatSchemaErweiterung())) {
          throw new ecError(schemaFehlerText(), 503)
        }
        res.json({ paare: await listeKeineDubletten() })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /**
   * POST /v6/dubletten/kein-duplikat
   *
   * Body: { personID_1, personID_2, notiz? }
   * Idempotent -- ein zweiter Klick aktualisiert nur Urheber und Zeitpunkt.
   */
  app.post(
    '/v6/dubletten/kein-duplikat',
    async (req: Request, res: Response) => {
      try {
        const token = await checkAuth(req)
        if (!(await hatSchemaErweiterung())) {
          throw new ecError(schemaFehlerText(), 503)
        }

        const idA = ganzzahl(req.body?.personID_1, 'personID_1')
        const idB = ganzzahl(req.body?.personID_2, 'personID_2')
        if (idA === idB) {
          throw new ecError('Es müssen zwei verschiedene Personen sein.', 400)
        }

        const vorhanden = await queryP<{ personID: number }>(
          'SELECT personID FROM personen WHERE personID IN (?, ?)',
          [idA, idB]
        )
        if (vorhanden.length !== 2) {
          throw new ecError(
            'Mindestens eine der beiden Personen existiert nicht.',
            404
          )
        }

        await markiereKeinDuplikat(
          idA,
          idB,
          token.userID,
          String(req.body?.notiz ?? ''),
          true
        )
        // Punktuell aus dem Cache nehmen statt neu zu rechnen: wer eine Liste
        // durcharbeitet, klickt das viele Male hintereinander.
        entfernePaar(idA, idB)
        await protokolliere(token.userID, 'keinDuplikat', idA, idB)

        res.status(201).json({ status: 'OK' })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /**
   * DELETE /v6/dubletten/kein-duplikat/:idA/:idB
   *
   * Nimmt die Markierung zurueck. Nicht optional: ein Fehlklick versteckt sonst
   * dauerhaft eine echte Dublette, und die Tabelle hat keine andere
   * Pflegeoberflaeche.
   */
  app.delete(
    '/v6/dubletten/kein-duplikat/:idA/:idB',
    async (req: Request, res: Response) => {
      try {
        const token = await checkAuth(req)
        if (!(await hatSchemaErweiterung())) {
          throw new ecError(schemaFehlerText(), 503)
        }
        const idA = ganzzahl(req.params.idA, 'idA')
        const idB = ganzzahl(req.params.idB, 'idB')

        const entfernt = await loescheKeinDuplikat(idA, idB)
        // Hier muss der Cache komplett weg: das Paar soll wieder auftauchen, und
        // ein Patch kann es nicht wiederherstellen.
        invalidiere()
        if (entfernt > 0) {
          await protokolliere(token.userID, 'keinDuplikatZurueck', idA, idB)
        }

        res.json({ status: 'OK', entfernt })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}

function pruefeStrategie<T extends string>(
  wert: unknown,
  erlaubt: readonly string[],
  name: string
): T | undefined {
  if (wert === undefined || wert === null || wert === '') return undefined
  const v = String(wert)
  if (!erlaubt.includes(v)) {
    throw new ecError(`${name} muss einer von: ${erlaubt.join(', ')}`, 400)
  }
  return v as T
}

function schemaFehlerText(): string {
  return (
    'Die Tabellen für die Dubletten-Pflege fehlen. Bitte ' +
    'sql/dubletten-schema.sql einspielen – eine Markierung ohne Urheber und ' +
    'Zeitpunkt wäre nicht nachvollziehbar.'
  )
}

async function protokolliere(
  userID: number,
  aktion: string,
  idA: number,
  idB: number
): Promise<void> {
  const { klein, gross } = paarKey(idA, idB)
  await queryP(
    `INSERT INTO dublettenLog
       (user_id, aktion, personID_behalten, personID_entfernt, score, anmerkung)
     VALUES (?, ?, ?, ?, 0, '')`,
    [userID, aktion, klein, gross]
  ).catch((err: Error) => {
    if (!/doesn't exist|Unknown table/i.test(err.message)) throw err
  })
}

/**
 * Alle Daten einer Person fuer die Gegenueberstellung.
 *
 * Anmeldungen kommen ohne `gesundheitsinformationen`, `lebensmittelAllergien`
 * und `bemerkungen`: fuer die Entscheidung "sind das dieselben Menschen" sind
 * sie nicht noetig, und sie haetten in einer Dublettenliste nichts zu suchen.
 */
async function ladePersonVoll(personID: number) {
  const [person] = await queryP(
    `SELECT personID, vorname, nachname,
            DATE_FORMAT(gebDat, '%Y-%m-%d') AS gebDat,
            geschlecht, ecKreis, ecMitglied, Notizen AS notizen,
            DATE_FORMAT(erstellt, '%Y-%m-%dT%H:%i:%sZ') AS erstellt,
            DATE_FORMAT(letzteAenderung, '%Y-%m-%dT%H:%i:%sZ') AS letzteAenderung,
            fz_status AS fzStatus, fz_deactivate AS fzDeactivate
       FROM personen WHERE personID = ?`,
    [personID]
  )

  const [eMails, telefone, adressen, anmeldungen, fz, juleica, tags, ak] =
    await Promise.all([
      queryP(
        `SELECT eMailID, eMail, isOld,
                DATE_FORMAT(lastUsed, '%Y-%m-%d') AS lastUsed
           FROM eMails WHERE personID = ? ORDER BY isOld, eMailID`,
        [personID]
      ),
      queryP(
        `SELECT telefonID, telefon, isOld,
                DATE_FORMAT(lastUsed, '%Y-%m-%d') AS lastUsed
           FROM telefone WHERE personID = ? ORDER BY isOld, telefonID`,
        [personID]
      ),
      queryP(
        `SELECT adressID, strasse, plz, ort, isOld,
                DATE_FORMAT(lastUsed, '%Y-%m-%d') AS lastUsed
           FROM adressen WHERE personID = ? ORDER BY isOld, adressID`,
        [personID]
      ),
      queryP(
        `SELECT a.anmeldeID, a.veranstaltungsID, v.bezeichnung, a.position,
                DATE_FORMAT(a.anmeldeZeitpunkt, '%Y-%m-%d') AS anmeldeZeitpunkt,
                DATE_FORMAT(a.abmeldeZeitpunkt, '%Y-%m-%d') AS abmeldeZeitpunkt,
                a.bisherBezahlt
           FROM anmeldungen a
           LEFT JOIN veranstaltungen v ON v.veranstaltungsID = a.veranstaltungsID
          WHERE a.personID = ?
          ORDER BY a.anmeldeZeitpunkt DESC`,
        [personID]
      ),
      queryP(
        `SELECT fzID, DATE_FORMAT(gesehenAm, '%Y-%m-%d') AS gesehenAm,
                DATE_FORMAT(fzVon, '%Y-%m-%d') AS fzVon
           FROM fz WHERE personID = ? ORDER BY gesehenAm DESC`,
        [personID]
      ),
      queryP('SELECT juleicanummer FROM juleica WHERE personID = ?', [
        personID
      ]),
      queryP(
        `SELECT t.tagID, t.bezeichnung FROM tagsPersonen tp
           JOIN tag t ON t.tagID = tp.tagID
          WHERE tp.personID = ?`,
        [personID]
      ),
      queryP(
        `SELECT DISTINCT ap.akID, a.bezeichnung FROM akPerson ap
           LEFT JOIN ak a ON a.akID = ap.akID
          WHERE ap.personID = ?`,
        [personID]
      )
    ])

  const [dsgvo] = await queryP<{ n: number }>(
    'SELECT COUNT(*) n FROM DSGVO_Person WHERE personID = ?',
    [personID]
  )
  const [login] = await queryP<{ n: number }>(
    'SELECT COUNT(*) n FROM users WHERE person_id = ?',
    [personID]
  )

  let hatPortalZugang = false
  try {
    const [pu] = await queryP<{ n: number }>(
      'SELECT COUNT(*) n FROM portalUser WHERE personID = ?',
      [personID]
    )
    hatPortalZugang = Number(pu?.n ?? 0) > 0
  } catch {
    /* portalUser erst mit portal-schema.sql */
  }

  const verantwortlich = await queryP<{
    ecKreisID: number
    art: string
  }>(
    `SELECT ecKreisID, 'fz' AS art FROM ecKreis
       WHERE fz_verantwortlicher_personID = ?
     UNION ALL
     SELECT ecKreisID, 'ort' AS art FROM ecKreis
       WHERE ortsverantwortlicher_personID = ?`,
    [personID, personID]
  ).catch(() => [])

  return {
    ...person,
    fzDeactivate: Number(person?.fzDeactivate ?? 0) === 1,
    eMails,
    telefone,
    adressen,
    anmeldungen,
    fz,
    juleica,
    tags,
    ak,
    dsgvoEinwilligungen: Number(dsgvo?.n ?? 0),
    hatVerwaltungsLogin: Number(login?.n ?? 0) > 0,
    hatPortalZugang,
    verantwortlichFuer: {
      fz: verantwortlich.filter((v) => v.art === 'fz').map((v) => v.ecKreisID),
      ort: verantwortlich.filter((v) => v.art === 'ort').map((v) => v.ecKreisID)
    }
  }
}
