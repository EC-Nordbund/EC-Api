import { Express, Request, Response } from 'express'
import { basename } from 'path'
import { checkAuth } from '../auth'
import { ecError, errorHandler } from '../helpers/error'
import {
  FAMILIEN,
  GRUPPEN,
  KATALOG,
  MIME,
  KatalogEintrag,
  platzhalterPfade,
  ladeBeispiel
} from '../vorlagen/katalog'
import {
  MAX_BYTES,
  Datei,
  Kopf,
  eintragOder404,
  fallbackVorhanden,
  familienmitgliederInDb,
  ladeVersion,
  ladeVorlage,
  listeKoepfe,
  listeVersionen,
  loesche,
  requireSchema,
  sha256,
  speichere,
  stelleWiederHer,
  uebernehme
} from '../vorlagen/store'
import { pruefeDatei } from '../vorlagen/pruefung'
import { erzeugeProbe } from '../vorlagen/probe'

/**
 * Pflege der Dateivorlagen aus EC-Verwaltung (Sonstiges -> Dateivorlagen).
 *
 * Unter /v6 mit dem Verwaltungs-Token und der dortigen Fehlerkonvention
 * (text/plain). Der groessere json()-Parser fuer diesen Pfad steht in
 * index.ts vor dem allgemeinen /v6-Parser.
 *
 * Schluessel enthalten Punkte (`brief.bestaetigung.1`); Express' Standard-
 * Parameter nimmt alles ausser `/`, das passt.
 */

type Status = 'db' | 'auslieferung' | 'container' | 'fehlt'

interface Zeile {
  schluessel: string
  gruppe: string
  name: string
  beschreibung: string
  verwendung: string
  art: KatalogEintrag['art']
  platzhalter: string[]
  status: Status
  dateiname: string | null
  mimetype: string | null
  groesse: number | null
  sha256: string | null
  geaendertAm: string | null
  benutzer: string
  kannLoeschen: boolean
  kannZuruecksetzen: boolean
  kannProbe: boolean
  kannUebernehmen: boolean
  familie: string | null
}

async function zeile(
  eintrag: KatalogEintrag,
  koepfe: Map<string, Kopf>
): Promise<Zeile> {
  const kopf = koepfe.get(eintrag.schluessel)
  const datei = fallbackVorhanden(eintrag)
  const status: Status = kopf
    ? 'db'
    : datei && eintrag.fallback
      ? eintrag.fallback.klasse
      : 'fehlt'
  const beispiel = await ladeBeispiel(eintrag)
  return {
    schluessel: eintrag.schluessel,
    gruppe: eintrag.gruppe,
    name: eintrag.name,
    beschreibung: eintrag.beschreibung,
    verwendung: eintrag.verwendung,
    art: eintrag.art,
    platzhalter: beispiel ? platzhalterPfade(beispiel) : [],
    status,
    dateiname:
      kopf?.dateiname ?? (datei ? basename(eintrag.fallback!.pfad) : null),
    mimetype: kopf?.mimetype ?? (datei ? MIME[eintrag.art] : null),
    groesse: kopf?.groesse ?? null,
    sha256: kopf?.sha256 ?? null,
    geaendertAm: kopf?.geaendertAm ?? null,
    benutzer: kopf?.benutzer ?? '',
    kannLoeschen: !!kopf && !!eintrag.familie,
    kannZuruecksetzen:
      !!kopf &&
      !eintrag.familie &&
      datei &&
      eintrag.fallback?.klasse === 'auslieferung',
    kannProbe: eintrag.art !== 'pdf' && status !== 'fehlt',
    kannUebernehmen: !kopf && datei,
    familie: eintrag.familie ?? null
  }
}

/** Alle Eintraege inklusive Familienmitglieder (DB, Dateisystem, erwartet). */
async function alleEintraege(): Promise<{
  eintraege: KatalogEintrag[]
  warnungen: string[]
}> {
  const eintraege = [...KATALOG]
  const warnungen: string[] = []
  for (const f of FAMILIEN) {
    const inDb = await familienmitgliederInDb(f.muster)
    const parameter = new Set<string>()
    for (const s of inDb) parameter.add(f.muster.exec(s)![1])
    for (const p of f.imDateisystem()) parameter.add(p)
    const erwartet = await f.erwartet()
    for (const p of erwartet) parameter.add(p)
    for (const p of [...parameter].sort()) {
      const e = f.eintrag(p)
      eintraege.push(e)
      if (
        erwartet.includes(p) &&
        !inDb.includes(e.schluessel) &&
        !fallbackVorhanden(e)
      ) {
        warnungen.push(
          `${e.name} fehlt -- es gibt Veranstaltungen, die ${p} beginnen. Ohne ihn geht kein Bestätigungsbrief für dieses Jahr raus.`
        )
      }
    }
  }
  return { eintraege, warnungen }
}

function ganzzahl(wert: string): number {
  const n = parseInt(wert, 10)
  if (!n || n < 1) throw new ecError('Ungültige ID', 400)
  return n
}

/** base64 aus dem Rumpf zu einer Datei; Dateiname auf den reinen Namen gekuerzt. */
function dateiAusRumpf(eintrag: KatalogEintrag, body: any): Datei {
  const roh = typeof body?.inhalt === 'string' ? body.inhalt : ''
  if (!roh) throw new ecError('Es wurde keine Datei übergeben.', 400)
  const inhalt = Buffer.from(roh, 'base64')
  if (!inhalt.length) throw new ecError('Die Datei ist leer.', 400)
  const name =
    String(body?.dateiname ?? '')
      .split(/[\\/]/)
      .pop()
      ?.trim()
      .slice(0, 255) || `${eintrag.schluessel}.${eintrag.art}`
  return {
    dateiname: name,
    // Der vom Browser gemeldete Typ wird geprueft (pruefung.ts), gespeichert
    // wird der Typ der Art -- ein leerer oder generischer Typ hilft niemandem.
    mimetype: String(body?.mimetype ?? ''),
    groesse: inhalt.length,
    sha256: sha256(inhalt),
    inhalt
  }
}

function textAlsDatei(eintrag: KatalogEintrag, body: any): Datei {
  if (eintrag.art !== 'md') {
    throw new ecError('Nur Textvorlagen lassen sich als Text speichern.', 400)
  }
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!text.trim()) throw new ecError('Der Text darf nicht leer sein.', 400)
  const inhalt = Buffer.from(text, 'utf8')
  return {
    dateiname: eintrag.fallback
      ? basename(eintrag.fallback.pfad)
      : `${eintrag.schluessel}.md`,
    mimetype: MIME.md,
    groesse: inhalt.length,
    sha256: sha256(inhalt),
    inhalt
  }
}

function sende(
  res: Response,
  d: { inhalt: Buffer; mimetype: string; dateiname: string }
) {
  res
    .type(d.mimetype)
    .set(
      'Content-Disposition',
      `attachment; filename="datei"; filename*=UTF-8''${encodeURIComponent(d.dateiname)}`
    )
    .send(d.inhalt)
}

/**
 * Pruefen und speichern. Warnungen ohne `trotzdem` -> 409 mit der Meldung,
 * die Verwaltung fragt dann nach und schickt erneut.
 */
async function pruefeUndSpeichere(
  eintrag: KatalogEintrag,
  datei: Datei,
  body: any,
  userID: number
) {
  const warnungen = await pruefeDatei(eintrag, datei)
  if (warnungen.length && body?.trotzdem !== true) {
    throw new ecError(warnungen.join('\n'), 409)
  }
  const ergebnis = await speichere(
    eintrag.schluessel,
    { ...datei, mimetype: MIME[eintrag.art] },
    userID,
    String(body?.anmerkung ?? '')
  )
  return { status: 'OK', ergebnis, warnungen }
}

export default (app: Express): void => {
  app.get('/v6/dateivorlage', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      await requireSchema()
      const koepfe = await listeKoepfe()
      const { eintraege, warnungen } = await alleEintraege()
      const vorlagen: Zeile[] = []
      for (const e of eintraege) vorlagen.push(await zeile(e, koepfe))

      const familien: {
        schluessel: string
        name: string
        art: KatalogEintrag['art']
        vorschlaege: number[]
      }[] = []
      for (const f of FAMILIEN) {
        familien.push({
          schluessel: f.schluessel,
          name: f.name,
          art: f.art,
          vorschlaege: (await f.vorschlaege()).map(Number)
        })
      }
      res.json({
        gruppen: GRUPPEN,
        vorlagen,
        familien,
        warnungen,
        maxBytes: MAX_BYTES
      })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.post(
    '/v6/dateivorlage/uebernehmen-alle',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await requireSchema()
        const koepfe = await listeKoepfe()
        const { eintraege } = await alleEintraege()
        const uebernommen: string[] = []
        const fehler: { schluessel: string; grund: string }[] = []
        for (const e of eintraege) {
          if (koepfe.has(e.schluessel) || !fallbackVorhanden(e)) continue
          try {
            const r = await uebernehme(e.schluessel, payload.userID)
            if (r === 'gespeichert') uebernommen.push(e.schluessel)
          } catch (err: any) {
            fehler.push({
              schluessel: e.schluessel,
              grund: String(err?.message ?? err).slice(0, 200)
            })
          }
        }
        res.json({ uebernommen, fehler })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get(
    '/v6/dateivorlage/:schluessel/datei',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const v = await ladeVorlage(req.params.schluessel)
        sende(res, v)
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.put(
    '/v6/dateivorlage/:schluessel',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await requireSchema()
        const eintrag = eintragOder404(req.params.schluessel)
        const datei = dateiAusRumpf(eintrag, req.body)
        res.json(
          await pruefeUndSpeichere(eintrag, datei, req.body, payload.userID)
        )
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.put(
    '/v6/dateivorlage/:schluessel/text',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await requireSchema()
        const eintrag = eintragOder404(req.params.schluessel)
        const datei = textAlsDatei(eintrag, req.body)
        res.json(
          await pruefeUndSpeichere(eintrag, datei, req.body, payload.userID)
        )
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get(
    '/v6/dateivorlage/:schluessel/versionen',
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
    '/v6/dateivorlage/:schluessel/version/:versionID/datei',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        eintragOder404(req.params.schluessel)
        const d = await ladeVersion(
          req.params.schluessel,
          ganzzahl(req.params.versionID)
        )
        sende(res, d)
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.post(
    '/v6/dateivorlage/:schluessel/wiederherstellen',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        eintragOder404(req.params.schluessel)
        const ergebnis = await stelleWiederHer(
          req.params.schluessel,
          ganzzahl(String(req.body?.versionID ?? '')),
          payload.userID
        )
        res.json({ status: 'OK', ergebnis })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.post(
    '/v6/dateivorlage/:schluessel/uebernehmen',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await requireSchema()
        const ergebnis = await uebernehme(req.params.schluessel, payload.userID)
        if (ergebnis === 'keine-datei') {
          throw new ecError(
            'Im Dateisystem der API liegt keine Datei für diese Vorlage.',
            404
          )
        }
        res.json({ status: 'OK', ergebnis })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /**
   * Familienmitglied loeschen oder einen Katalogeintrag auf den
   * Auslieferungsstand zuruecksetzen. Fuer Container-Dateien (Briefe,
   * Sicherungsscheine ohne Familie) gibt es kein Loeschen: der Fallback
   * waere nach dem naechsten Deploy weg, und niemand merkte es.
   */
  app.delete(
    '/v6/dateivorlage/:schluessel',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const eintrag = eintragOder404(req.params.schluessel)
        const darf =
          !!eintrag.familie ||
          (eintrag.fallback?.klasse === 'auslieferung' &&
            fallbackVorhanden(eintrag))
        if (!darf) {
          throw new ecError(
            'Diese Vorlage lässt sich nur ersetzen, nicht löschen -- ohne sie ginge der Versand nicht mehr.',
            409
          )
        }
        await loesche(eintrag.schluessel)
        res.json({ status: 'OK' })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  /**
   * Probe: gespeicherte Fassung (leerer Rumpf) oder eine noch nicht
   * gespeicherte Datei (`inhalt` base64 bzw. `text`) mit Beispieldaten fuellen.
   */
  app.post(
    '/v6/dateivorlage/:schluessel/probe',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        const eintrag = eintragOder404(req.params.schluessel)
        let inhalt: Buffer
        if (typeof req.body?.inhalt === 'string' && req.body.inhalt) {
          const d = dateiAusRumpf(eintrag, req.body)
          await pruefeDatei(eintrag, {
            ...d,
            mimetype: d.mimetype || MIME[eintrag.art]
          })
          inhalt = d.inhalt
        } else if (typeof req.body?.text === 'string') {
          inhalt = textAlsDatei(eintrag, req.body).inhalt
        } else {
          inhalt = (await ladeVorlage(eintrag.schluessel)).inhalt
        }
        sende(res, await erzeugeProbe(eintrag, inhalt))
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}
