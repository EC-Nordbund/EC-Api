import { PoolConnection } from 'promise-mysql'
import { queryP, withConnection } from '../helpers/mysql'
import { PortalFehler, badRequest, forbidden, notFound } from '../portal/error'
import { dateObj, type DateObj } from '../portal/date'
import { assertVeranstaltung, type PortalScope } from '../portal/scope'
import { sichtbareBereiche } from './auth'
import {
  MAX_MENGE,
  MAX_POSITIONEN,
  STATUS,
  ganzzahl,
  isoSql,
  pruefeZeitraum,
  text,
  type AntragStatus,
  type Zeitraum
} from './config'
import { konflikteFuerAntrag, type Konflikt } from './verfuegbarkeit'

/**
 * Ausleih-Antraege: anlegen, lesen, stornieren, Packliste, und die Seite des
 * Materialwarts (Liste, Entscheidung).
 *
 * Statusmodell -- Uebergaenge stehen in UEBERGAENGE, alles andere ist 409:
 *   offen      -> genehmigt | abgelehnt          (Materialwart)
 *   offen      -> storniert                      (Antragsteller)
 *   genehmigt  -> genehmigt (Mengen/Antwort) | abgelehnt | abgeschlossen
 *   abgelehnt  -> genehmigt | offen              (Korrektur)
 *   abgeschlossen, storniert: Ende.
 * Reservierungswirksam ist nur `genehmigt` (mit mengeGenehmigt > 0); `offen`
 * zaehlt als angefragt.
 */

export const UEBERGAENGE: Record<AntragStatus, AntragStatus[]> = {
  offen: ['genehmigt', 'abgelehnt', 'storniert'],
  genehmigt: ['genehmigt', 'abgelehnt', 'abgeschlossen'],
  abgelehnt: ['genehmigt', 'offen'],
  abgeschlossen: [],
  storniert: []
}

export interface Position {
  materialAntragPositionID: number
  materialID: number
  name: string
  lagerort: string
  bereich: string
  kategorie: string | null
  hatFoto: boolean
  menge: number
  mengeGenehmigt: number | null
  eingeladen: boolean
  zurueck: boolean
}

export interface AntragKopf {
  materialAntragID: number
  portalUserID: number
  status: AntragStatus
  von: string
  bis: string
  vonObj: DateObj | null
  bisObj: DateObj | null
  veranstaltungsID: number | null
  ecKreisID: number | null
  kreis: string | null
  anlass: string
  kommentar: string
  antwort: string
  erstellt: string
  geaendert: string
  entschiedenAm: string | null
  abgeschlossenAm: string | null
  antragsteller: { vorname: string; nachname: string; email: string }
  positionen: Position[]
}

export type AntragDetail = AntragKopf

const ANTRAG_SPALTEN = `a.materialAntragID, a.portalUserID, a.status,
       DATE_FORMAT(a.von, '%Y-%m-%d') AS von, DATE_FORMAT(a.bis, '%Y-%m-%d') AS bis,
       a.veranstaltungsID, a.ecKreisID, ek.bezeichnung AS kreis,
       a.anlass, a.kommentar, a.antwort,
       ${isoSql('a.erstellt')} AS erstellt, ${isoSql('a.geaendert')} AS geaendert,
       ${isoSql('a.entschieden_am')} AS entschiedenAm,
       ${isoSql('a.abgeschlossen_am')} AS abgeschlossenAm,
       pe.vorname, pe.nachname, pu.email`

const ANTRAG_JOINS = `FROM materialAntrag a
       JOIN portalUser pu ON pu.portalUserID = a.portalUserID
       JOIN personen pe ON pe.personID = pu.personID
       LEFT JOIN ecKreis ek ON ek.ecKreisID = a.ecKreisID`

function formeKopf(r: any, positionen: Position[]): AntragKopf {
  return {
    materialAntragID: r.materialAntragID,
    portalUserID: r.portalUserID,
    status: r.status,
    von: r.von,
    bis: r.bis,
    vonObj: dateObj(r.von),
    bisObj: dateObj(r.bis),
    veranstaltungsID: r.veranstaltungsID ?? null,
    ecKreisID: r.ecKreisID ?? null,
    kreis: r.kreis ?? null,
    anlass: r.anlass,
    kommentar: r.kommentar,
    antwort: r.antwort,
    erstellt: r.erstellt,
    geaendert: r.geaendert,
    entschiedenAm: r.entschiedenAm ?? null,
    abgeschlossenAm: r.abgeschlossenAm ?? null,
    antragsteller: { vorname: r.vorname, nachname: r.nachname, email: r.email },
    positionen
  }
}

async function ladePositionen(
  antragIDs: number[]
): Promise<Map<number, Position[]>> {
  const je = new Map<number, Position[]>()
  if (!antragIDs.length) return je
  const rows = await queryP<any>(
    `SELECT p.materialAntragPositionID, p.materialAntragID, p.materialID,
            m.name, m.lagerort, m.bereich, k.bezeichnung AS kategorie,
            f.materialID IS NOT NULL AS hatFoto,
            p.menge, p.mengeGenehmigt, p.eingeladen, p.zurueck
       FROM materialAntragPosition p
       JOIN material m ON m.materialID = p.materialID
       LEFT JOIN materialKategorie k ON k.materialKategorieID = m.materialKategorieID
       LEFT JOIN materialFoto f ON f.materialID = m.materialID
      WHERE p.materialAntragID IN (${antragIDs.map(() => '?').join(',')})
      ORDER BY p.materialAntragID, k.sortierung, k.bezeichnung, m.name`,
    antragIDs
  )
  for (const r of rows) {
    const liste = je.get(r.materialAntragID) ?? []
    liste.push({
      materialAntragPositionID: r.materialAntragPositionID,
      materialID: r.materialID,
      name: r.name,
      lagerort: r.lagerort,
      bereich: r.bereich,
      kategorie: r.kategorie ?? null,
      hatFoto: Number(r.hatFoto) === 1,
      menge: r.menge,
      mengeGenehmigt: r.mengeGenehmigt ?? null,
      eingeladen: r.eingeladen === 1,
      zurueck: r.zurueck === 1
    })
    je.set(r.materialAntragID, liste)
  }
  return je
}

/* ------------------------------------------------------------- Lesen ---- */

export async function ladeAntrag(
  materialAntragID: number
): Promise<AntragDetail> {
  const rows = await queryP<any>(
    `SELECT ${ANTRAG_SPALTEN} ${ANTRAG_JOINS} WHERE a.materialAntragID = ?`,
    [materialAntragID]
  )
  if (rows.length !== 1) throw notFound('Antrag nicht gefunden.')
  const pos = await ladePositionen([materialAntragID])
  return formeKopf(rows[0], pos.get(materialAntragID) ?? [])
}

/**
 * Antrag fuer diesen Scope: eigener oder Materialwart, sonst 404 -- eine ID
 * laesst sich raten, und "gibt es, gehoert dir nicht" ist schon eine Antwort.
 * Materialwarte bekommen zusaetzlich die Ueberschneidungen je Position.
 */
export async function antragFuer(
  scope: PortalScope,
  materialAntragID: number
): Promise<
  AntragDetail & { konflikte?: Record<number, Konflikt[]>; eigener: boolean }
> {
  const a = await ladeAntrag(materialAntragID)
  const eigener = a.portalUserID === scope.portalUserID
  if (!eigener && !scope.materialVerwalter)
    throw notFound('Antrag nicht gefunden.')
  if (!scope.materialVerwalter) return { ...a, eigener }
  const k = await konflikteFuerAntrag(materialAntragID)
  const konflikte: Record<number, Konflikt[]> = {}
  for (const [materialID, liste] of k) konflikte[materialID] = liste
  return { ...a, eigener, konflikte }
}

export async function eigeneAntraege(
  portalUserID: number
): Promise<AntragKopf[]> {
  const rows = await queryP<any>(
    `SELECT ${ANTRAG_SPALTEN} ${ANTRAG_JOINS}
      WHERE a.portalUserID = ?
      ORDER BY a.erstellt DESC`,
    [portalUserID]
  )
  const pos = await ladePositionen(rows.map((r: any) => r.materialAntragID))
  return rows.map((r: any) => formeKopf(r, pos.get(r.materialAntragID) ?? []))
}

export type ListenFilter =
  | 'aktiv'
  | 'offen'
  | 'genehmigt'
  | 'abgelehnt'
  | 'abgeschlossen'
  | 'storniert'
  | 'alle'

export function pruefeFilter(v: unknown): ListenFilter {
  const s = typeof v === 'string' ? v : 'aktiv'
  if (s === 'aktiv' || s === 'alle' || (STATUS as string[]).includes(s)) {
    return s as ListenFilter
  }
  throw badRequest('INVALID_INPUT', 'Unbekannter Statusfilter.')
}

/**
 * Liste fuer den Materialwart. `ueberfaellig`: genehmigt, Zeitraum vorbei,
 * nicht alles zurueck -- in SQL gerechnet (UTC-Falle).
 */
export async function antraegeVerwaltung(
  filter: ListenFilter,
  zeitraum: Zeitraum | null
): Promise<
  Array<AntragKopf & { ueberfaellig: boolean; positionenAnzahl: number }>
> {
  const bedingungen: string[] = []
  const params: unknown[] = []
  if (filter === 'aktiv') bedingungen.push("a.status IN ('offen','genehmigt')")
  else if (filter !== 'alle') {
    bedingungen.push('a.status = ?')
    params.push(filter)
  }
  if (zeitraum) {
    bedingungen.push('a.von <= ? AND a.bis >= ?')
    params.push(zeitraum.bis, zeitraum.von)
  }
  const rows = await queryP<any>(
    `SELECT ${ANTRAG_SPALTEN},
            (a.status = 'genehmigt' AND a.bis < CURDATE() AND EXISTS (
               SELECT 1 FROM materialAntragPosition x
                WHERE x.materialAntragID = a.materialAntragID
                  AND COALESCE(x.mengeGenehmigt, 0) > 0 AND x.zurueck = 0)) AS ueberfaellig
       ${ANTRAG_JOINS}
      ${bedingungen.length ? 'WHERE ' + bedingungen.join(' AND ') : ''}
      ORDER BY FIELD(a.status, 'offen', 'genehmigt', 'abgelehnt', 'abgeschlossen', 'storniert'), a.von`,
    params
  )
  const pos = await ladePositionen(rows.map((r: any) => r.materialAntragID))
  return rows.map((r: any) => {
    const positionen = pos.get(r.materialAntragID) ?? []
    return {
      ...formeKopf(r, positionen),
      ueberfaellig: Number(r.ueberfaellig) === 1,
      positionenAnzahl: positionen.length
    }
  })
}

/* ----------------------------------------------------------- Anlegen ---- */

export interface AntragEingabe {
  zeitraum: Zeitraum
  veranstaltungsID: number | null
  ecKreisID: number | null
  anlass: string
  kommentar: string
  positionen: Array<{ materialID: number; menge: number }>
}

export async function pruefeAntragEingabe(
  body: any,
  scope: PortalScope
): Promise<AntragEingabe> {
  const zeitraum = pruefeZeitraum(body?.von, body?.bis)

  const [{ ok }] = await queryP<{ ok: number }>('SELECT ? >= CURDATE() AS ok', [
    zeitraum.von
  ])
  if (Number(ok) !== 1) {
    throw badRequest(
      'ZEITRAUM',
      'Der Zeitraum darf nicht in der Vergangenheit beginnen.'
    )
  }

  // Anlass: Veranstaltung aus dem Scope ODER Freitext (+ optional EC-Kreis).
  let veranstaltungsID: number | null = null
  let anlass = ''
  if (
    body?.veranstaltungsID !== undefined &&
    body?.veranstaltungsID !== null &&
    body?.veranstaltungsID !== ''
  ) {
    veranstaltungsID = ganzzahl(
      body.veranstaltungsID,
      'Veranstaltung',
      1,
      2147483647
    )
    // Jeder Umfang reicht: auch die Kuechenleitung darf fuer ihre Freizeit
    // Material beantragen (aus dem allgemeinen Bereich).
    assertVeranstaltung(scope, veranstaltungsID, 'kueche')
    const v = scope.veranstaltungen.find(
      (x) => x.veranstaltungsID === veranstaltungsID
    )
    if (v) {
      anlass = v.bezeichnung
    } else {
      // Superuser: Veranstaltung nicht im Scope-Fenster -> aus der DB.
      const rows = await queryP<{ bezeichnung: string }>(
        'SELECT bezeichnung FROM veranstaltungen WHERE veranstaltungsID = ?',
        [veranstaltungsID]
      )
      if (!rows.length)
        throw badRequest('ANLASS', 'Die Veranstaltung gibt es nicht.')
      anlass = rows[0].bezeichnung
    }
  } else {
    anlass = text(body?.anlass, 'Anlass', 200, true)
  }

  let ecKreisID: number | null = null
  if (
    body?.ecKreisID !== undefined &&
    body?.ecKreisID !== null &&
    body?.ecKreisID !== ''
  ) {
    ecKreisID = ganzzahl(body.ecKreisID, 'EC-Kreis', 1, 2147483647)
    const da = await queryP('SELECT 1 FROM ecKreis WHERE ecKreisID = ?', [
      ecKreisID
    ])
    if (!da.length) throw badRequest('ANLASS', 'Den EC-Kreis gibt es nicht.')
  }

  const roh = Array.isArray(body?.positionen) ? body.positionen : []
  if (!roh.length)
    throw badRequest('POSITIONEN', 'Bitte mindestens ein Material auswählen.')
  if (roh.length > MAX_POSITIONEN) {
    throw badRequest(
      'POSITIONEN',
      `Höchstens ${MAX_POSITIONEN} Positionen je Antrag.`
    )
  }
  const gesehen = new Set<number>()
  const positionen = roh.map((p: any) => {
    const materialID = ganzzahl(p?.materialID, 'Material', 1, 2147483647)
    if (gesehen.has(materialID)) {
      throw badRequest('POSITIONEN', 'Ein Material ist doppelt aufgeführt.')
    }
    gesehen.add(materialID)
    return { materialID, menge: ganzzahl(p?.menge, 'Menge', 1, MAX_MENGE) }
  })

  return {
    zeitraum,
    veranstaltungsID,
    ecKreisID,
    anlass,
    kommentar: text(body?.kommentar, 'Kommentar', 2000),
    positionen
  }
}

/**
 * Anlegen in einer Transaktion. Die Sichtbarkeit jedes Materials wird hier
 * geprueft, nicht nur in der Liste -- eine ID laesst sich raten.
 */
export async function antragAnlegen(
  eingabe: AntragEingabe,
  scope: PortalScope
): Promise<number> {
  const bereiche = sichtbareBereiche(scope)
  const ids = eingabe.positionen.map((p) => p.materialID)
  const material = await queryP<{
    materialID: number
    bereich: string
    aktiv: number
    freigegeben: number
  }>(
    `SELECT materialID, bereich, aktiv, freigegeben FROM material
      WHERE materialID IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const id of ids) {
    const m = material.find((x) => x.materialID === id)
    if (
      !m ||
      m.aktiv !== 1 ||
      m.freigegeben !== 1 ||
      !bereiche.includes(m.bereich as any)
    ) {
      throw badRequest(
        'MATERIAL_UNSICHTBAR',
        'Ein ausgewähltes Material steht nicht zur Verfügung.'
      )
    }
  }

  return withConnection(async (conn) => {
    const r: any = await conn.query(
      `INSERT INTO materialAntrag
         (portalUserID, status, von, bis, veranstaltungsID, ecKreisID, anlass, kommentar)
       VALUES (?, 'offen', ?, ?, ?, ?, ?, ?)`,
      [
        scope.portalUserID,
        eingabe.zeitraum.von,
        eingabe.zeitraum.bis,
        eingabe.veranstaltungsID,
        eingabe.ecKreisID,
        eingabe.anlass,
        eingabe.kommentar
      ]
    )
    const materialAntragID = r.insertId
    for (const p of eingabe.positionen) {
      await conn.query(
        'INSERT INTO materialAntragPosition (materialAntragID, materialID, menge) VALUES (?,?,?)',
        [materialAntragID, p.materialID, p.menge]
      )
    }
    return materialAntragID
  })
}

/* ------------------------------------------------------------ Storno ---- */

export async function storno(
  scope: PortalScope,
  materialAntragID: number
): Promise<AntragDetail> {
  await withConnection(async (conn) => {
    const rows = await conn.query(
      'SELECT portalUserID, status FROM materialAntrag WHERE materialAntragID = ? FOR UPDATE',
      [materialAntragID]
    )
    if (rows.length !== 1 || rows[0].portalUserID !== scope.portalUserID) {
      throw notFound('Antrag nicht gefunden.')
    }
    if (rows[0].status !== 'offen') {
      throw new PortalFehler(
        'STATUS',
        'Nur ein offener Antrag lässt sich zurückziehen. Wende dich sonst an die Materialverwaltung.',
        409
      )
    }
    await conn.query(
      "UPDATE materialAntrag SET status = 'storniert', erinnert_am = NULL WHERE materialAntragID = ?",
      [materialAntragID]
    )
  })
  return ladeAntrag(materialAntragID)
}

/* ---------------------------------------------------------- Packliste --- */

/**
 * Haken der Packliste. Liefert `allesZurueck = true` genau dann, wenn dieser
 * Klick den Zustand "alle Positionen zurueck" erst hergestellt hat -- die
 * Mail an die Materialwarte geht einmal, nicht bei jedem Klick.
 */
export async function packliste(
  scope: PortalScope,
  materialAntragID: number,
  materialAntragPositionID: number,
  patch: { eingeladen?: unknown; zurueck?: unknown }
): Promise<{ allesZurueck: boolean }> {
  const felder: string[] = []
  const werte: unknown[] = []
  if (patch.eingeladen !== undefined) {
    felder.push('eingeladen = ?')
    werte.push(patch.eingeladen ? 1 : 0)
  }
  if (patch.zurueck !== undefined) {
    felder.push('zurueck = ?')
    werte.push(patch.zurueck ? 1 : 0)
  }
  if (!felder.length) {
    throw badRequest('INVALID_INPUT', 'Nichts zu ändern (eingeladen/zurueck).')
  }

  return withConnection(async (conn) => {
    const a = await conn.query(
      'SELECT portalUserID, status FROM materialAntrag WHERE materialAntragID = ? FOR UPDATE',
      [materialAntragID]
    )
    if (
      a.length !== 1 ||
      (a[0].portalUserID !== scope.portalUserID && !scope.materialVerwalter)
    ) {
      throw notFound('Antrag nicht gefunden.')
    }
    if (a[0].status !== 'genehmigt') {
      throw new PortalFehler(
        'STATUS',
        'Die Packliste gibt es nur bei genehmigten Anträgen.',
        409
      )
    }
    const p = await conn.query(
      `SELECT materialAntragPositionID, COALESCE(mengeGenehmigt, 0) AS mg
         FROM materialAntragPosition
        WHERE materialAntragPositionID = ? AND materialAntragID = ?`,
      [materialAntragPositionID, materialAntragID]
    )
    if (p.length !== 1) throw notFound('Position nicht gefunden.')
    if (Number(p[0].mg) === 0) {
      throw new PortalFehler('STATUS', 'Diese Position wurde gestrichen.', 409)
    }
    const vorher = await alleZurueck(conn, materialAntragID)
    await conn.query(
      `UPDATE materialAntragPosition SET ${felder.join(', ')} WHERE materialAntragPositionID = ?`,
      [...werte, materialAntragPositionID]
    )
    const nachher = await alleZurueck(conn, materialAntragID)
    return { allesZurueck: nachher && !vorher }
  })
}

async function alleZurueck(
  conn: PoolConnection,
  materialAntragID: number
): Promise<boolean> {
  const [{ offen, gesamt }] = await conn.query(
    `SELECT SUM(zurueck = 0) AS offen, COUNT(*) AS gesamt
       FROM materialAntragPosition
      WHERE materialAntragID = ? AND COALESCE(mengeGenehmigt, 0) > 0`,
    [materialAntragID]
  )
  return Number(gesamt) > 0 && Number(offen) === 0
}

/* ---------------------------------------------------- Entscheidung ------ */

export interface Bearbeitung {
  status?: unknown
  antwort?: unknown
  positionen?: unknown
}

export interface BearbeitungErgebnis {
  vorher: AntragDetail
  nachher: AntragDetail
  /** Welche Mail an den Antragsteller geht (null: keine Aenderung). */
  ereignis:
    | 'genehmigt'
    | 'abgelehnt'
    | 'geaendert'
    | 'zurueckgezogen'
    | 'offen'
    | 'abgeschlossen'
    | null
}

/**
 * Der Materialwart entscheidet. Ein PATCH kann Status, Antwort und
 * genehmigte Mengen zugleich setzen. Uebergang wird unter FOR UPDATE
 * geprueft, damit zwei Materialwarte nicht gegeneinander arbeiten.
 */
export async function antragBearbeiten(
  scope: PortalScope,
  materialAntragID: number,
  eingabe: Bearbeitung
): Promise<BearbeitungErgebnis> {
  const vorher = await ladeAntrag(materialAntragID)

  let neuerStatus: AntragStatus | null = null
  if (eingabe.status !== undefined) {
    if (!(STATUS as string[]).includes(String(eingabe.status))) {
      throw badRequest('INVALID_INPUT', 'Unbekannter Status.')
    }
    neuerStatus = eingabe.status as AntragStatus
    if (neuerStatus === 'storniert') {
      throw forbidden(
        'Zurückziehen kann nur die Antragstellerin bzw. der Antragsteller.'
      )
    }
  }
  const antwort =
    eingabe.antwort !== undefined
      ? text(eingabe.antwort, 'Antwort', 2000)
      : null

  // Mengen: nur zu Positionen dieses Antrags, 0..menge.
  const mengen = new Map<number, number>()
  if (eingabe.positionen !== undefined) {
    if (!Array.isArray(eingabe.positionen)) {
      throw badRequest('INVALID_INPUT', 'positionen muss eine Liste sein.')
    }
    for (const p of eingabe.positionen as any[]) {
      const id = ganzzahl(
        p?.materialAntragPositionID,
        'Position',
        1,
        2147483647
      )
      const pos = vorher.positionen.find(
        (x) => x.materialAntragPositionID === id
      )
      if (!pos)
        throw badRequest(
          'INVALID_INPUT',
          'Position gehört nicht zu diesem Antrag.'
        )
      mengen.set(
        id,
        ganzzahl(p?.mengeGenehmigt, 'Genehmigte Menge', 0, pos.menge)
      )
    }
  }

  await withConnection(async (conn) => {
    const rows = await conn.query(
      'SELECT status FROM materialAntrag WHERE materialAntragID = ? FOR UPDATE',
      [materialAntragID]
    )
    if (rows.length !== 1) throw notFound('Antrag nicht gefunden.')
    const aktuell: AntragStatus = rows[0].status
    const ziel = neuerStatus ?? aktuell

    if (neuerStatus && !UEBERGAENGE[aktuell].includes(neuerStatus)) {
      throw new PortalFehler(
        'UEBERGANG',
        `Ein Antrag im Status "${aktuell}" kann nicht auf "${neuerStatus}" gesetzt werden.`,
        409
      )
    }
    if (
      !neuerStatus &&
      (mengen.size > 0 || antwort !== null) &&
      !['offen', 'genehmigt', 'abgelehnt'].includes(aktuell)
    ) {
      throw new PortalFehler(
        'UEBERGANG',
        'Ein abgeschlossener oder stornierter Antrag lässt sich nicht mehr ändern.',
        409
      )
    }

    // Genehmigte Mengen: bei Genehmigung bekommt jede Position einen Wert
    // (fehlende = beantragte Menge); ohne Statuswechsel nur die uebergebenen.
    if (ziel === 'genehmigt') {
      for (const pos of vorher.positionen) {
        const m = mengen.get(pos.materialAntragPositionID)
        const wert = m !== undefined ? m : (pos.mengeGenehmigt ?? pos.menge)
        await conn.query(
          'UPDATE materialAntragPosition SET mengeGenehmigt = ? WHERE materialAntragPositionID = ?',
          [wert, pos.materialAntragPositionID]
        )
      }
    } else {
      for (const [id, wert] of mengen) {
        await conn.query(
          'UPDATE materialAntragPosition SET mengeGenehmigt = ? WHERE materialAntragPositionID = ?',
          [wert, id]
        )
      }
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (antwort !== null) {
      sets.push('antwort = ?')
      params.push(antwort)
    }
    if (neuerStatus && neuerStatus !== aktuell) {
      sets.push('status = ?', 'erinnert_am = NULL')
      params.push(neuerStatus)
      if (
        neuerStatus === 'genehmigt' ||
        neuerStatus === 'abgelehnt' ||
        neuerStatus === 'offen'
      ) {
        sets.push('entschieden_am = NOW()', 'entschieden_von = ?')
        params.push(scope.portalUserID)
      }
      if (neuerStatus === 'abgeschlossen') {
        sets.push('abgeschlossen_am = NOW()', 'abgeschlossen_von = ?')
        params.push(scope.portalUserID)
      }
    } else if (neuerStatus === 'genehmigt') {
      // genehmigt -> genehmigt: Aenderung, Entscheider aktualisieren
      sets.push('entschieden_am = NOW()', 'entschieden_von = ?')
      params.push(scope.portalUserID)
    }
    if (sets.length) {
      await conn.query(
        `UPDATE materialAntrag SET ${sets.join(', ')} WHERE materialAntragID = ?`,
        [...params, materialAntragID]
      )
    }
  })

  const nachher = await ladeAntrag(materialAntragID)

  let ereignis: BearbeitungErgebnis['ereignis'] = null
  if (nachher.status !== vorher.status) {
    if (nachher.status === 'genehmigt') ereignis = 'genehmigt'
    else if (nachher.status === 'abgelehnt') {
      ereignis = vorher.status === 'genehmigt' ? 'zurueckgezogen' : 'abgelehnt'
    } else if (nachher.status === 'offen') ereignis = 'offen'
    else if (nachher.status === 'abgeschlossen') ereignis = 'abgeschlossen'
  } else if (nachher.status === 'genehmigt') {
    const geaendert =
      nachher.antwort !== vorher.antwort ||
      nachher.positionen.some(
        (p) =>
          p.mengeGenehmigt !==
          vorher.positionen.find(
            (x) => x.materialAntragPositionID === p.materialAntragPositionID
          )?.mengeGenehmigt
      )
    if (geaendert) ereignis = 'geaendert'
  }

  return { vorher, nachher, ereignis }
}
