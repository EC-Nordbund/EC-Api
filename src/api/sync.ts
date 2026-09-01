import { Express } from 'express'
import { json } from 'body-parser'
import { createHash, timingSafeEqual } from 'crypto'
import { withConnection } from '../helpers/mysql'

/**
 * CMS→DB-Sync für Veranstaltungen.
 *
 * POST /sync/veranstaltungen (bewusst AUSSERHALB von /v6 — dort gilt ein
 * globales Rate-Limit von 2 req/s, der Sync ist ein einzelner Batch-Call).
 * Aufrufer ist die GitHub Action des Content-Repos; Auth über das Secret
 * SYNC_TOKEN als Authorization-Header (eine env-Variable, ein Name — nicht
 * die WP_TOKEN/WPToken-Asymmetrie wiederholen).
 *
 * Pro Eintrag läuft eine eigene Transaktion: vOrte-get-or-create + Upsert in
 * veranstaltungen. Es werden NUR Spalten geschrieben, die in Dev- UND
 * Prod-Schema existieren (Schema-Drift: preisAnzahlung*, xlsx*, infoBrief*,
 * bestaetigungsBrief* gibt es nur in Prod — nie anfassen, Defaults bleiben).
 * Kein Delete-Pfad: Absagen/Löschungen bleiben Verwaltungssache.
 */

interface SyncVeranstaltung {
  slug: string
  veranstaltungsID?: number
  bezeichnung: string
  name: string
  kurzBezeichnung: string
  begin: string
  ende?: string | null
  veranstaltungsort: string
  vOrt?: { strasse?: string; plz?: string; ort?: string }
  ort: string
  preisFruehbucher: number
  preisNormal: number
  preisLastMinute: number
  fruehbucherBis?: string | null
  lastMinuteAb?: string | null
  anzahlung: number
  kannVorortBezahltWerden: number
  hatGWarteliste: number
  anzahlPlaetze: number
  anzahlPlaetzeWeiblich: number
  anzahlPlaetzeMaennlich: number
  minTNAlter: number
  maxTNAlter: number
  briefID: number
  informAnmeldecenter?: string | null
}

type SyncResult = {
  slug: string
  status: 'created' | 'updated' | 'adopted' | 'validated' | 'error'
  veranstaltungsID?: number
  warning?: string
  error?: string
  context?: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function checkSyncToken(header: string | undefined): boolean {
  const secret = process.env.SYNC_TOKEN
  if (!secret) return false
  // SHA-256 beider Werte: gleiche Länge für timingSafeEqual, kein Timing-Leck
  const a = createHash('sha256')
    .update(header ?? '')
    .digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

function validate(v: SyncVeranstaltung): string[] {
  const errs: string[] = []
  const isInt = (x: unknown) => Number.isInteger(x)
  const nonNegInt = (x: unknown) => Number.isInteger(x) && (x as number) >= 0

  if (typeof v.slug !== 'string' || !v.slug) errs.push('slug fehlt')
  if (
    typeof v.bezeichnung !== 'string' ||
    !v.bezeichnung.trim() ||
    v.bezeichnung.length > 50
  )
    errs.push('bezeichnung fehlt oder > 50 Zeichen')
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 250)
    errs.push('name fehlt oder > 250 Zeichen')
  if (
    typeof v.kurzBezeichnung !== 'string' ||
    !/^[A-Za-z0-9]{1,4}$/.test(v.kurzBezeichnung)
  )
    errs.push('kurzBezeichnung muss 1-4 Zeichen [A-Za-z0-9] sein')
  if (typeof v.begin !== 'string' || !DATE_RE.test(v.begin))
    errs.push('begin muss YYYY-MM-DD sein')
  if (v.ende != null && (typeof v.ende !== 'string' || !DATE_RE.test(v.ende)))
    errs.push('ende muss YYYY-MM-DD oder null sein')
  if (
    typeof v.veranstaltungsort !== 'string' ||
    !v.veranstaltungsort.trim()
  )
    errs.push('veranstaltungsort fehlt')
  if (typeof v.ort !== 'string' || !v.ort.trim() || v.ort.length > 250)
    errs.push('ort fehlt oder > 250 Zeichen')
  for (const key of [
    'preisFruehbucher',
    'preisNormal',
    'preisLastMinute',
    'anzahlung',
    'anzahlPlaetze',
    'anzahlPlaetzeWeiblich',
    'anzahlPlaetzeMaennlich',
    'minTNAlter',
    'maxTNAlter'
  ] as const) {
    if (!nonNegInt(v[key])) errs.push(`${key} muss Integer >= 0 sein`)
  }
  for (const key of ['fruehbucherBis', 'lastMinuteAb'] as const) {
    const val = v[key]
    if (val != null && (typeof val !== 'string' || !DATE_RE.test(val)))
      errs.push(`${key} muss YYYY-MM-DD oder null sein`)
  }
  for (const key of ['kannVorortBezahltWerden', 'hatGWarteliste'] as const) {
    if (v[key] !== 0 && v[key] !== 1) errs.push(`${key} muss 0 oder 1 sein`)
  }
  if (!isInt(v.briefID) || v.briefID < 1 || v.briefID > 5)
    errs.push('briefID muss 1-5 sein')
  if (
    v.veranstaltungsID != null &&
    (!isInt(v.veranstaltungsID) || v.veranstaltungsID <= 0)
  )
    errs.push('veranstaltungsID muss ein positiver Integer sein')
  if (
    v.informAnmeldecenter != null &&
    (typeof v.informAnmeldecenter !== 'string' ||
      v.informAnmeldecenter.length > 150)
  )
    errs.push('informAnmeldecenter muss String <= 150 oder null sein')
  return errs
}

// Spaltenliste = Schnittmenge Dev/Prod (Umlaut-Spalten in Backticks!)
const SET_SQL = `
  bezeichnung = ?, kurzBezeichnung = ?, \`begin\` = ?, ende = ?,
  veranstaltungsort = ?, minTNAlter = ?, maxTNAlter = ?,
  preisFruehbucher = ?, preisNormal = ?, preisLastMinute = ?,
  fruehbucherBis = ?, lastMinuteAb = ?, kannVorortBezahltWerden = ?,
  hatGWarteliste = ?, \`anzahlPlätze\` = ?, \`anzahlPlätzeWeiblich\` = ?,
  \`anzahlPlätzeMännlich\` = ?, informAnmeldecenter = ?, briefID = ?,
  anzahlung = ?, name = ?, ort = ?`

function setValues(v: SyncVeranstaltung, vOrtID: number): unknown[] {
  return [
    v.bezeichnung.trim(),
    v.kurzBezeichnung,
    v.begin,
    v.ende ?? null,
    vOrtID,
    v.minTNAlter,
    v.maxTNAlter,
    v.preisFruehbucher,
    v.preisNormal,
    v.preisLastMinute,
    v.fruehbucherBis ?? null,
    v.lastMinuteAb ?? null,
    v.kannVorortBezahltWerden,
    v.hatGWarteliste,
    v.anzahlPlaetze,
    v.anzahlPlaetzeWeiblich,
    v.anzahlPlaetzeMaennlich,
    v.informAnmeldecenter ?? null,
    v.briefID,
    v.anzahlung,
    v.name.trim(),
    v.ort.trim()
  ]
}

async function syncOne(v: SyncVeranstaltung): Promise<SyncResult> {
  return withConnection<SyncResult>(async (conn) => {
    // 1) vOrte get-or-create über UNIQUE bezeichnung.
    //    Bestehende vOrte werden bewusst NICHT aktualisiert — Detailpflege
    //    (Kontakt, Verpflegung, …) bleibt in der Verwaltung.
    const ortBezeichnung = v.veranstaltungsort.trim().slice(0, 50)
    const found = await conn.query(
      'SELECT vOrtID FROM vOrte WHERE bezeichnung = ?',
      [ortBezeichnung]
    )
    let vOrtID: number
    if (found.length > 0) {
      vOrtID = found[0].vOrtID
    } else {
      const ins = await conn.query(
        `INSERT INTO vOrte
           (bezeichnung, strasse, plz, ort, land, kontakt_fuer_tn_liste,
            selbstversorger, vollverpflegung, notizen)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [
          ortBezeichnung,
          v.vOrt?.strasse?.trim() ?? '',
          v.vOrt?.plz?.trim() ?? '',
          v.vOrt?.ort?.trim() ?? '',
          'Deutschland',
          '',
          `Automatisch angelegt durch CMS-Sync ${new Date().toISOString().slice(0, 10)}`
        ]
      )
      vOrtID = ins.insertId
    }

    // 2) Update-Pfad: ID ist gesetzt
    if (v.veranstaltungsID != null) {
      const exists = await conn.query(
        'SELECT veranstaltungsID FROM veranstaltungen WHERE veranstaltungsID = ?',
        [v.veranstaltungsID]
      )
      if (exists.length === 0) {
        // Kein stilles Neuanlegen: deutet auf Tippfehler oder
        // Prod/Dev-Verwechslung hin
        return { slug: v.slug, status: 'error', error: 'ID_NOT_FOUND' }
      }
      try {
        await conn.query(
          `UPDATE veranstaltungen SET ${SET_SQL} WHERE veranstaltungsID = ?`,
          [...setValues(v, vOrtID), v.veranstaltungsID]
        )
      } catch (err: any) {
        if (err?.code === 'ER_DUP_ENTRY') {
          // Das neue (bezeichnung, begin)-Paar gehört einer ANDEREN Zeile
          return {
            slug: v.slug,
            status: 'error',
            error: 'UNIQUE_CONFLICT_ON_UPDATE'
          }
        }
        throw err
      }
      return {
        slug: v.slug,
        status: 'updated',
        veranstaltungsID: v.veranstaltungsID
      }
    }

    // 3) Create-Pfad
    try {
      const ins = await conn.query(
        `INSERT INTO veranstaltungen SET ${SET_SQL}`,
        setValues(v, vOrtID)
      )
      return {
        slug: v.slug,
        status: 'created',
        veranstaltungsID: ins.insertId
      }
    } catch (err: any) {
      if (err?.code !== 'ER_DUP_ENTRY') throw err
      // UNIQUE(bezeichnung, begin) existiert schon: Zeile adoptieren —
      // Idempotenz-Netz für den Fall, dass ein früherer Lauf angelegt hat,
      // der ID-Rückschreib-Commit aber scheiterte.
      const existing = await conn.query(
        'SELECT veranstaltungsID, kurzBezeichnung FROM veranstaltungen WHERE bezeichnung = ? AND `begin` = ?',
        [v.bezeichnung.trim(), v.begin]
      )
      if (existing.length === 0) throw err
      const id: number = existing[0].veranstaltungsID
      await conn.query(
        `UPDATE veranstaltungen SET ${SET_SQL} WHERE veranstaltungsID = ?`,
        [...setValues(v, vOrtID), id]
      )
      const warn =
        existing[0].kurzBezeichnung !== v.kurzBezeichnung
          ? `kurzBezeichnung weicht ab (DB: ${existing[0].kurzBezeichnung})`
          : undefined
      return {
        slug: v.slug,
        status: 'adopted',
        veranstaltungsID: id,
        ...(warn ? { warning: warn } : {})
      }
    }
  })
}

export default (app: Express): void => {
  app.post('/sync/veranstaltungen', json({ limit: '2mb' }), async (req, res) => {
    if (!process.env.SYNC_TOKEN) {
      res.status(503).json({ status: 'DISABLED' })
      return
    }
    if (!checkSyncToken(req.headers.authorization)) {
      res.status(401).json({ status: 'UNAUTHORIZED' })
      return
    }

    const body = req.body
    if (!body || !Array.isArray(body.veranstaltungen)) {
      res.status(400).json({
        status: 'ERROR',
        context: 'Body braucht { veranstaltungen: [...] }'
      })
      return
    }

    const dryRun = body.dryRun === true
    const results: SyncResult[] = []

    for (const v of body.veranstaltungen as SyncVeranstaltung[]) {
      const slug = typeof v?.slug === 'string' ? v.slug : '(ohne slug)'
      const errs = validate(v)
      if (errs.length > 0) {
        results.push({
          slug,
          status: 'error',
          error: 'VALIDATION',
          context: errs
        })
        continue
      }
      if (dryRun) {
        results.push({ slug, status: 'validated' })
        continue
      }
      try {
        results.push(await syncOne(v))
      } catch (err) {
        console.error(`sync/veranstaltungen [${slug}]:`, err)
        results.push({ slug, status: 'error', error: 'DB_ERROR' })
      }
    }

    res.status(200).json({ results })
  })
}
