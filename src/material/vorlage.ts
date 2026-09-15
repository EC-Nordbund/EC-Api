import { queryP, withConnection } from '../helpers/mysql'
import { PortalFehler, badRequest, notFound } from '../portal/error'
import type { PortalScope } from '../portal/scope'
import { sichtbareBereiche } from './auth'
import {
  MAX_MENGE,
  MAX_POSITIONEN,
  ganzzahl,
  isoSql,
  pruefeBereich,
  text,
  type Bereich
} from './config'

/**
 * Materiallisten-Vorlagen ("Teencamp-Grundliste").
 *
 * Gepflegt nur von Materialwarten; Nutzer laden sie im Katalog als Auswahl.
 * Der Katalog kuerzt Mengen auf das Freie und laesst archiviertes oder
 * unsichtbares Material weg -- deshalb liefert die Nutzerliste die Positionen
 * ungefiltert, und die Vorlage bleibt auch nach einer Ausmusterung brauchbar.
 *
 * Eine Vorlage im Bereich 'allgemein' darf kein 'referenten'-Material
 * enthalten: sonst saehe jemand ohne Spezial-Recht Positionen, die er nie
 * beantragen kann.
 */

export interface VorlagePosition {
  materialID: number
  name: string
  menge: number
}

export interface VorlagePositionVerwaltung extends VorlagePosition {
  bereich: Bereich
  aktiv: boolean
  freigegeben: boolean
  hatFoto: boolean
}

export interface Vorlage<P = VorlagePosition> {
  materialVorlageID: number
  name: string
  beschreibung: string
  bereich: Bereich
  sortierung: number
  positionen: P[]
}

export interface VorlageVerwaltung extends Vorlage<VorlagePositionVerwaltung> {
  erstellt: string
  geaendert: string
}

export interface VorlageEingabe {
  name: string
  beschreibung: string
  bereich: Bereich
  sortierung: number
  positionen: Array<{ materialID: number; menge: number }>
}

/* ------------------------------------------------------------- Lesen ---- */

async function ladePositionen(
  vorlageIDs: number[]
): Promise<Map<number, VorlagePositionVerwaltung[]>> {
  const je = new Map<number, VorlagePositionVerwaltung[]>()
  if (!vorlageIDs.length) return je
  const rows = await queryP<any>(
    `SELECT p.materialVorlageID, p.materialID, p.menge,
            m.name, m.bereich, m.aktiv, m.freigegeben,
            f.materialID IS NOT NULL AS hatFoto
       FROM materialVorlagePosition p
       LEFT JOIN material m ON m.materialID = p.materialID
       LEFT JOIN materialFoto f ON f.materialID = p.materialID
      WHERE p.materialVorlageID IN (${vorlageIDs.map(() => '?').join(',')})
      ORDER BY p.materialVorlageID, m.name, p.materialID`,
    vorlageIDs
  )
  for (const r of rows) {
    const liste = je.get(r.materialVorlageID) ?? []
    liste.push({
      materialID: r.materialID,
      // Material geloescht (sollte nicht vorkommen -- kein DELETE), dann
      // wenigstens nicht abstuerzen.
      name: r.name ?? `Material #${r.materialID}`,
      menge: r.menge,
      bereich: (r.bereich ?? 'allgemein') as Bereich,
      aktiv: r.aktiv === 1,
      freigegeben: r.freigegeben === 1,
      hatFoto: Number(r.hatFoto) === 1
    })
    je.set(r.materialVorlageID, liste)
  }
  return je
}

/** Fuer Nutzer: nur Vorlagen der sichtbaren Bereiche, Positionen schlank. */
export async function vorlagenFuer(scope: PortalScope): Promise<Vorlage[]> {
  const bereiche = sichtbareBereiche(scope)
  const koepfe = await queryP<any>(
    `SELECT materialVorlageID, name, beschreibung, bereich, sortierung
       FROM materialVorlage
      WHERE bereich IN (${bereiche.map(() => '?').join(',')})
      ORDER BY sortierung, name`,
    bereiche
  )
  const positionen = await ladePositionen(
    koepfe.map((k: any) => k.materialVorlageID)
  )
  return koepfe.map((k: any) => ({
    materialVorlageID: k.materialVorlageID,
    name: k.name,
    beschreibung: k.beschreibung,
    bereich: k.bereich,
    sortierung: k.sortierung,
    positionen: (positionen.get(k.materialVorlageID) ?? []).map((p) => ({
      materialID: p.materialID,
      name: p.name,
      menge: p.menge
    }))
  }))
}

/** Fuer Materialwarte: alles, Positionen mit Materialstatus fuer den Editor. */
export async function vorlagenVerwaltung(): Promise<VorlageVerwaltung[]> {
  const koepfe = await queryP<any>(
    `SELECT materialVorlageID, name, beschreibung, bereich, sortierung,
            ${isoSql('erstellt')} AS erstellt, ${isoSql('geaendert')} AS geaendert
       FROM materialVorlage
      ORDER BY sortierung, name`
  )
  const positionen = await ladePositionen(
    koepfe.map((k: any) => k.materialVorlageID)
  )
  return koepfe.map((k: any) => ({
    materialVorlageID: k.materialVorlageID,
    name: k.name,
    beschreibung: k.beschreibung,
    bereich: k.bereich,
    sortierung: k.sortierung,
    erstellt: k.erstellt,
    geaendert: k.geaendert,
    positionen: positionen.get(k.materialVorlageID) ?? []
  }))
}

/* --------------------------------------------------------- Validierung -- */

export async function pruefeVorlageEingabe(body: any): Promise<VorlageEingabe> {
  const name = text(body?.name, 'Name', 120, true)
  const beschreibung = text(body?.beschreibung, 'Beschreibung', 1000)
  const bereich =
    body?.bereich === undefined ? 'allgemein' : pruefeBereich(body.bereich)
  const sortierung =
    body?.sortierung === undefined || body?.sortierung === null
      ? 0
      : ganzzahl(body.sortierung, 'Sortierung', -100000, 100000)

  const roh = Array.isArray(body?.positionen) ? body.positionen : []
  if (!roh.length) {
    throw badRequest('POSITIONEN', 'Bitte mindestens ein Material aufnehmen.')
  }
  if (roh.length > MAX_POSITIONEN) {
    throw badRequest(
      'POSITIONEN',
      `Höchstens ${MAX_POSITIONEN} Positionen je Vorlage.`
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

  // Material muss existieren und darf nicht archiviert sein; nicht
  // freigegebenes ist erlaubt (der Materialwart bereitet vor). Bereichsregel
  // siehe Kopfkommentar.
  const ids = positionen.map((p) => p.materialID)
  const material = await queryP<{
    materialID: number
    bereich: Bereich
    aktiv: number
    name: string
  }>(
    `SELECT materialID, bereich, aktiv, name FROM material
      WHERE materialID IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const id of ids) {
    const m = material.find((x) => x.materialID === id)
    if (!m || m.aktiv !== 1) {
      throw badRequest(
        'MATERIAL_UNBEKANNT',
        'Ein Material gibt es nicht oder es ist archiviert.'
      )
    }
    if (bereich === 'allgemein' && m.bereich === 'referenten') {
      throw badRequest(
        'BEREICH_KONFLIKT',
        `„${m.name}“ gehört zum Bereich Speziell und passt nicht in eine allgemeine Vorlage.`
      )
    }
  }

  return { name, beschreibung, bereich, sortierung, positionen }
}

/* ----------------------------------------------------------- Schreiben -- */

async function pruefeName(name: string, ausser: number | null): Promise<void> {
  const doppelt = await queryP(
    'SELECT 1 FROM materialVorlage WHERE name = ? AND materialVorlageID <> ?',
    [name, ausser ?? 0]
  )
  if (doppelt.length) {
    throw new PortalFehler(
      'DOPPELT',
      'Eine Vorlage mit diesem Namen gibt es schon.',
      409
    )
  }
}

export async function vorlageAnlegen(
  eingabe: VorlageEingabe,
  portalUserID: number
): Promise<number> {
  await pruefeName(eingabe.name, null)
  return withConnection(async (conn) => {
    const r: any = await conn.query(
      `INSERT INTO materialVorlage
         (name, beschreibung, bereich, sortierung, erstellt_von, geaendert_von)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        eingabe.name,
        eingabe.beschreibung,
        eingabe.bereich,
        eingabe.sortierung,
        portalUserID,
        portalUserID
      ]
    )
    const materialVorlageID = r.insertId
    for (const p of eingabe.positionen) {
      await conn.query(
        'INSERT INTO materialVorlagePosition (materialVorlageID, materialID, menge) VALUES (?,?,?)',
        [materialVorlageID, p.materialID, p.menge]
      )
    }
    return materialVorlageID
  })
}

/** Ersetzt Kopf und Positionen komplett -- ein PUT, keine Teilaenderung. */
export async function vorlageErsetzen(
  materialVorlageID: number,
  eingabe: VorlageEingabe,
  portalUserID: number
): Promise<void> {
  const da = await queryP(
    'SELECT 1 FROM materialVorlage WHERE materialVorlageID = ?',
    [materialVorlageID]
  )
  if (!da.length) throw notFound('Vorlage nicht gefunden.')
  await pruefeName(eingabe.name, materialVorlageID)
  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE materialVorlage
          SET name = ?, beschreibung = ?, bereich = ?, sortierung = ?, geaendert_von = ?
        WHERE materialVorlageID = ?`,
      [
        eingabe.name,
        eingabe.beschreibung,
        eingabe.bereich,
        eingabe.sortierung,
        portalUserID,
        materialVorlageID
      ]
    )
    await conn.query(
      'DELETE FROM materialVorlagePosition WHERE materialVorlageID = ?',
      [materialVorlageID]
    )
    for (const p of eingabe.positionen) {
      await conn.query(
        'INSERT INTO materialVorlagePosition (materialVorlageID, materialID, menge) VALUES (?,?,?)',
        [materialVorlageID, p.materialID, p.menge]
      )
    }
  })
}

export async function vorlageLoeschen(
  materialVorlageID: number
): Promise<void> {
  const da = await queryP(
    'SELECT 1 FROM materialVorlage WHERE materialVorlageID = ?',
    [materialVorlageID]
  )
  if (!da.length) throw notFound('Vorlage nicht gefunden.')
  await withConnection(async (conn) => {
    await conn.query(
      'DELETE FROM materialVorlagePosition WHERE materialVorlageID = ?',
      [materialVorlageID]
    )
    await conn.query(
      'DELETE FROM materialVorlage WHERE materialVorlageID = ?',
      [materialVorlageID]
    )
  })
}
