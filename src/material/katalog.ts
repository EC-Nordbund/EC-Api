import { queryP } from '../helpers/mysql'
import { PortalFehler, badRequest, notFound } from '../portal/error'
import type { PortalScope } from '../portal/scope'
import { sichtbareBereiche, siehtReferenten } from './auth'
import {
  FOTO_TYPEN,
  MAX_FOTO_BYTES,
  MAX_MENGE,
  MAX_VORSCHAU_BYTES,
  ganzzahl,
  pruefeBereich,
  requireMaterialSchema,
  text,
  type Bereich,
  type Zeitraum
} from './config'
import { verfuegbarkeit } from './verfuegbarkeit'

/**
 * Bestand: Kategorien, Material, Fotos.
 *
 * Die Liste liest nie Blobs (materialFoto ist eine eigene Tabelle); sie traegt
 * nur `hatFoto` und `fotoStand`, damit der Client Vorschauen cachen kann.
 */

export interface Kategorie {
  materialKategorieID: number
  bezeichnung: string
  sortierung: number
}

export interface MaterialKopf {
  materialID: number
  bereich: Bereich
  materialKategorieID: number | null
  kategorie: string | null
  name: string
  beschreibung: string
  bestand: number
  lagerort: string
  freigegeben: boolean
  aktiv: boolean
  hatFoto: boolean
  /** Unix-Sekunden des Fotos, fuer Cache-Busting (?v=) */
  fotoStand: number | null
  /** Nur mit Zeitraum gefuellt, sonst null. */
  reserviert: number | null
  angefragt: number | null
  frei: number | null
}

const KOPF_SPALTEN = `m.materialID, m.bereich, m.materialKategorieID, k.bezeichnung AS kategorie,
       m.name, m.beschreibung, m.bestand, m.lagerort, m.freigegeben, m.aktiv,
       f.materialID IS NOT NULL AS hatFoto, UNIX_TIMESTAMP(f.geaendert) AS fotoStand`

const KOPF_JOINS = `FROM material m
       LEFT JOIN materialKategorie k ON k.materialKategorieID = m.materialKategorieID
       LEFT JOIN materialFoto f ON f.materialID = m.materialID`

function formen(r: any): MaterialKopf {
  return {
    materialID: r.materialID,
    bereich: r.bereich,
    materialKategorieID: r.materialKategorieID ?? null,
    kategorie: r.kategorie ?? null,
    name: r.name,
    beschreibung: r.beschreibung,
    bestand: r.bestand,
    lagerort: r.lagerort,
    freigegeben: r.freigegeben === 1,
    aktiv: r.aktiv === 1,
    hatFoto: Number(r.hatFoto) === 1,
    fotoStand: r.fotoStand ? Number(r.fotoStand) : null,
    reserviert: null,
    angefragt: null,
    frei: null
  }
}

async function mitVerfuegbarkeit(
  liste: MaterialKopf[],
  zeitraum: Zeitraum | null
): Promise<MaterialKopf[]> {
  if (!zeitraum) return liste
  const je = await verfuegbarkeit(
    liste.map((m) => m.materialID),
    zeitraum
  )
  for (const m of liste) {
    const r = je.get(m.materialID) ?? { reserviert: 0, angefragt: 0 }
    m.reserviert = r.reserviert
    m.angefragt = r.angefragt
    // Bestand kann nachtraeglich unter genehmigte Mengen gesenkt worden sein.
    m.frei = Math.max(m.bestand - r.reserviert, 0)
  }
  return liste
}

/* ------------------------------------------------------------- Lesen ---- */

export async function ladeKategorien(): Promise<Kategorie[]> {
  return queryP<Kategorie>(
    `SELECT materialKategorieID, bezeichnung, sortierung
       FROM materialKategorie ORDER BY sortierung, bezeichnung`
  )
}

/** Stammdaten fuer die Katalogseite: Kategorien, EC-Kreise, Sichtbarkeit. */
export async function stammdaten(scope: PortalScope) {
  const kreise = await queryP<{ ecKreisID: number; bezeichnung: string }>(
    'SELECT ecKreisID, bezeichnung FROM ecKreis ORDER BY bezeichnung'
  )
  return {
    kategorien: await ladeKategorien(),
    kreise,
    referenten: siehtReferenten(scope),
    bereiche: sichtbareBereiche(scope)
  }
}

/** Sichtbarer Katalog: aktiv, freigegeben, Bereich passt zum Scope. */
export async function katalog(
  scope: PortalScope,
  zeitraum: Zeitraum | null
): Promise<MaterialKopf[]> {
  const bereiche = sichtbareBereiche(scope)
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} ${KOPF_JOINS}
      WHERE m.aktiv = 1 AND m.freigegeben = 1
        AND m.bereich IN (${bereiche.map(() => '?').join(',')})
      ORDER BY k.sortierung, k.bezeichnung, m.name`,
    bereiche
  )
  return mitVerfuegbarkeit(rows.map(formen), zeitraum)
}

/** Alles, auch nicht Freigegebenes und Archiviertes -- fuer Materialwarte. */
export async function katalogAlle(
  zeitraum: Zeitraum | null
): Promise<MaterialKopf[]> {
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} ${KOPF_JOINS}
      ORDER BY m.aktiv DESC, k.sortierung, k.bezeichnung, m.name`
  )
  return mitVerfuegbarkeit(rows.map(formen), zeitraum)
}

export async function ladeMaterial(materialID: number): Promise<MaterialKopf> {
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} ${KOPF_JOINS} WHERE m.materialID = ?`,
    [materialID]
  )
  if (rows.length !== 1) throw notFound('Material nicht gefunden.')
  return formen(rows[0])
}

/** Darf dieser Scope das Material sehen? (Materialwart: immer.) */
export function istSichtbar(scope: PortalScope, m: MaterialKopf): boolean {
  if (scope.materialVerwalter) return true
  return (
    m.aktiv && m.freigegeben && sichtbareBereiche(scope).includes(m.bereich)
  )
}

/**
 * Alle Vorschauen der sichtbaren Materialien als Data-URLs in einem Rutsch.
 * Ein <img src="/portal/..."> koennte keinen Auth-Header mitschicken, und
 * fuenfzig Einzelabrufe liefen ins Rate-Limit.
 */
export async function vorschauen(
  scope: PortalScope
): Promise<Record<number, string>> {
  const bereiche = sichtbareBereiche(scope)
  const filter = scope.materialVerwalter
    ? ''
    : `WHERE m.aktiv = 1 AND m.freigegeben = 1
         AND m.bereich IN (${bereiche.map(() => '?').join(',')})`
  const rows = await queryP<{ materialID: number; vorschau: Buffer }>(
    `SELECT f.materialID, f.vorschau
       FROM materialFoto f JOIN material m ON m.materialID = f.materialID
       ${filter}`,
    scope.materialVerwalter ? [] : bereiche
  )
  const je: Record<number, string> = {}
  for (const r of rows) {
    // Die Vorschau ist immer JPEG (so erzeugt sie der Client).
    je[r.materialID] = `data:image/jpeg;base64,${r.vorschau.toString('base64')}`
  }
  return je
}

export async function ladeFoto(
  materialID: number
): Promise<{ mimetype: string; inhalt: Buffer }> {
  const rows = await queryP<{ mimetype: string; inhalt: Buffer }>(
    'SELECT mimetype, inhalt FROM materialFoto WHERE materialID = ?',
    [materialID]
  )
  if (rows.length !== 1) throw notFound('Kein Foto vorhanden.')
  return rows[0]
}

/* ---------------------------------------------------------- Schreiben --- */

export interface MaterialEingabe {
  name?: unknown
  bereich?: unknown
  materialKategorieID?: unknown
  beschreibung?: unknown
  bestand?: unknown
  lagerort?: unknown
  freigegeben?: unknown
  aktiv?: unknown
}

async function pruefeKategorieID(wert: unknown): Promise<number | null> {
  if (wert === null || wert === undefined || wert === '') return null
  const id = ganzzahl(wert, 'Kategorie', 1, 2147483647)
  const da = await queryP(
    'SELECT 1 FROM materialKategorie WHERE materialKategorieID = ?',
    [id]
  )
  if (!da.length) throw badRequest('KATEGORIE', 'Die Kategorie gibt es nicht.')
  return id
}

export async function materialAnlegen(
  eingabe: MaterialEingabe,
  portalUserID: number
): Promise<number> {
  await requireMaterialSchema()
  const r: any = await queryP(
    `INSERT INTO material
       (bereich, materialKategorieID, name, beschreibung, bestand, lagerort,
        freigegeben, aktiv, erstellt_von, geaendert_von)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      pruefeBereich(eingabe.bereich ?? 'allgemein'),
      await pruefeKategorieID(eingabe.materialKategorieID),
      text(eingabe.name, 'Name', 200, true),
      text(eingabe.beschreibung, 'Beschreibung', 2000),
      ganzzahl(eingabe.bestand ?? 1, 'Bestand', 0, MAX_MENGE),
      text(eingabe.lagerort, 'Lagerort', 200),
      eingabe.freigegeben ? 1 : 0,
      eingabe.aktiv === false ? 0 : 1,
      portalUserID,
      portalUserID
    ]
  )
  return r.insertId
}

/** Partielles Update: nur uebergebene Felder, wie downloads.ts aendern(). */
export async function materialAendern(
  materialID: number,
  eingabe: MaterialEingabe,
  portalUserID: number
): Promise<void> {
  await ladeMaterial(materialID)

  const felder: string[] = []
  const werte: unknown[] = []
  const setze = (spalte: string, wert: unknown) => {
    felder.push(`${spalte} = ?`)
    werte.push(wert)
  }

  if (eingabe.name !== undefined)
    setze('name', text(eingabe.name, 'Name', 200, true))
  if (eingabe.bereich !== undefined)
    setze('bereich', pruefeBereich(eingabe.bereich))
  if (eingabe.materialKategorieID !== undefined) {
    setze(
      'materialKategorieID',
      await pruefeKategorieID(eingabe.materialKategorieID)
    )
  }
  if (eingabe.beschreibung !== undefined) {
    setze('beschreibung', text(eingabe.beschreibung, 'Beschreibung', 2000))
  }
  if (eingabe.bestand !== undefined) {
    setze('bestand', ganzzahl(eingabe.bestand, 'Bestand', 0, MAX_MENGE))
  }
  if (eingabe.lagerort !== undefined)
    setze('lagerort', text(eingabe.lagerort, 'Lagerort', 200))
  if (eingabe.freigegeben !== undefined)
    setze('freigegeben', eingabe.freigegeben ? 1 : 0)
  if (eingabe.aktiv !== undefined) setze('aktiv', eingabe.aktiv ? 1 : 0)

  if (!felder.length) return
  setze('geaendert_von', portalUserID)
  werte.push(materialID)
  await queryP(
    `UPDATE material SET ${felder.join(', ')} WHERE materialID = ?`,
    werte
  )
}

/** Archivieren statt loeschen: Antragspositionen verweisen auf die Zeile. */
export async function materialArchivieren(
  materialID: number,
  portalUserID: number
): Promise<void> {
  await ladeMaterial(materialID)
  await queryP(
    'UPDATE material SET aktiv = 0, geaendert_von = ? WHERE materialID = ?',
    [portalUserID, materialID]
  )
}

/* --------------------------------------------------------------- Foto --- */

export interface FotoEingabe {
  mimetype?: unknown
  /** base64 ohne data:-Praefix, max. 1200 px */
  inhalt?: unknown
  /** base64 ohne data:-Praefix, ~240 px JPEG */
  vorschau?: unknown
}

function base64(wert: unknown, feld: string, max: number): Buffer {
  const roh = typeof wert === 'string' ? wert.replace(/^data:[^,]*,/, '') : ''
  if (!roh) throw badRequest('KEINE_DATEI', `${feld} fehlt.`)
  const buf = Buffer.from(roh, 'base64')
  if (!buf.length) throw badRequest('LEER', `${feld} ist leer.`)
  if (buf.length > max) {
    throw badRequest(
      'ZU_GROSS',
      `${feld} ist ${(buf.length / 1024).toFixed(0)} kB groß, erlaubt sind ${Math.round(max / 1024)} kB.`
    )
  }
  return buf
}

/** Magic Bytes: der Typ soll zum Inhalt passen, nicht nur zur Angabe. */
function passtTyp(mimetype: string, buf: Buffer): boolean {
  if (mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8
  if (mimetype === 'image/png') {
    return (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    )
  }
  if (mimetype === 'image/webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  return false
}

export async function fotoSetzen(
  materialID: number,
  eingabe: FotoEingabe
): Promise<void> {
  await ladeMaterial(materialID)
  const mimetype = text(eingabe.mimetype, 'Dateityp', 60, true).toLowerCase()
  if (!FOTO_TYPEN.includes(mimetype)) {
    throw badRequest(
      'TYP',
      `Bilder vom Typ "${mimetype}" sind hier nicht vorgesehen. Erlaubt: JPEG, PNG, WebP.`
    )
  }
  const inhalt = base64(eingabe.inhalt, 'Foto', MAX_FOTO_BYTES)
  const vorschau = base64(eingabe.vorschau, 'Vorschau', MAX_VORSCHAU_BYTES)
  if (!passtTyp(mimetype, inhalt)) {
    throw badRequest('TYP', 'Der Inhalt passt nicht zum angegebenen Bildtyp.')
  }
  if (!passtTyp('image/jpeg', vorschau)) {
    throw badRequest('TYP', 'Die Vorschau muss ein JPEG sein.')
  }
  await queryP(
    `INSERT INTO materialFoto (materialID, mimetype, groesse, inhalt, vorschau)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE mimetype = VALUES(mimetype), groesse = VALUES(groesse),
       inhalt = VALUES(inhalt), vorschau = VALUES(vorschau), geaendert = NOW()`,
    [materialID, mimetype, inhalt.length, inhalt, vorschau]
  )
}

export async function fotoEntfernen(materialID: number): Promise<void> {
  await ladeMaterial(materialID)
  await queryP('DELETE FROM materialFoto WHERE materialID = ?', [materialID])
}

/* --------------------------------------------------------- Kategorien --- */

export async function kategorieAnlegen(eingabe: {
  bezeichnung?: unknown
  sortierung?: unknown
}): Promise<number> {
  const bezeichnung = text(eingabe.bezeichnung, 'Bezeichnung', 80, true)
  const da = await queryP(
    'SELECT 1 FROM materialKategorie WHERE bezeichnung = ?',
    [bezeichnung]
  )
  if (da.length) {
    throw new PortalFehler('DOPPELT', 'Diese Kategorie gibt es schon.', 409)
  }
  const r: any = await queryP(
    'INSERT INTO materialKategorie (bezeichnung, sortierung) VALUES (?,?)',
    [bezeichnung, Number(eingabe.sortierung) || 0]
  )
  return r.insertId
}

export async function kategorieAendern(
  materialKategorieID: number,
  eingabe: { bezeichnung?: unknown; sortierung?: unknown }
): Promise<void> {
  const da = await queryP(
    'SELECT 1 FROM materialKategorie WHERE materialKategorieID = ?',
    [materialKategorieID]
  )
  if (!da.length) throw notFound('Kategorie nicht gefunden.')

  const felder: string[] = []
  const werte: unknown[] = []
  if (eingabe.bezeichnung !== undefined) {
    const bezeichnung = text(eingabe.bezeichnung, 'Bezeichnung', 80, true)
    const doppelt = await queryP(
      'SELECT 1 FROM materialKategorie WHERE bezeichnung = ? AND materialKategorieID <> ?',
      [bezeichnung, materialKategorieID]
    )
    if (doppelt.length) {
      throw new PortalFehler('DOPPELT', 'Diese Kategorie gibt es schon.', 409)
    }
    felder.push('bezeichnung = ?')
    werte.push(bezeichnung)
  }
  if (eingabe.sortierung !== undefined) {
    felder.push('sortierung = ?')
    werte.push(Number(eingabe.sortierung) || 0)
  }
  if (!felder.length) return
  werte.push(materialKategorieID)
  await queryP(
    `UPDATE materialKategorie SET ${felder.join(', ')} WHERE materialKategorieID = ?`,
    werte
  )
}

/** Nur ohne Verwendung: sonst staende Material ploetzlich ohne Kategorie da. */
export async function kategorieLoeschen(
  materialKategorieID: number
): Promise<void> {
  const da = await queryP(
    'SELECT 1 FROM materialKategorie WHERE materialKategorieID = ?',
    [materialKategorieID]
  )
  if (!da.length) throw notFound('Kategorie nicht gefunden.')
  const [{ n }] = await queryP<{ n: number }>(
    'SELECT COUNT(*) AS n FROM material WHERE materialKategorieID = ?',
    [materialKategorieID]
  )
  if (Number(n) > 0) {
    throw new PortalFehler(
      'IN_VERWENDUNG',
      `Die Kategorie wird von ${n} Material(ien) verwendet. Bitte erst umhängen.`,
      409
    )
  }
  await queryP('DELETE FROM materialKategorie WHERE materialKategorieID = ?', [
    materialKategorieID
  ])
}

/* ---------------------------------------------------------------- Me ---- */

/**
 * Block fuer /portal/me. Bei fehlendem Schema null -- /me darf nie am
 * Material-Modul scheitern.
 */
export async function materialMe(
  scope: PortalScope
): Promise<{ referenten: boolean; offen: number | null } | null> {
  try {
    await requireMaterialSchema()
  } catch {
    return null
  }
  let offen: number | null = null
  if (scope.materialVerwalter) {
    const [{ n }] = await queryP<{ n: number }>(
      "SELECT COUNT(*) AS n FROM materialAntrag WHERE status = 'offen'"
    )
    offen = Number(n)
  }
  return { referenten: siehtReferenten(scope), offen }
}
