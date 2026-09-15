import { queryP } from '../helpers/mysql'
import { PortalFehler, badRequest } from '../portal/error'
import { parseDatum, isoDatum } from '../portal/date'

/**
 * Konstanten und Schema-Guard der Materialverwaltung.
 *
 * Alles, was die Reichweite des Moduls begrenzt (Groessen, Mengen, Zeitraeume),
 * steht hier an einer Stelle statt verstreut in Routen und SQL.
 */

export type Bereich = 'allgemein' | 'referenten'
export const BEREICHE: Bereich[] = ['allgemein', 'referenten']

export type AntragStatus =
  'offen' | 'genehmigt' | 'abgelehnt' | 'abgeschlossen' | 'storniert'
export const STATUS: AntragStatus[] = [
  'offen',
  'genehmigt',
  'abgelehnt',
  'abgeschlossen',
  'storniert'
]

/**
 * Foto-Grenzen. Der Browser verkleinert vor dem Upload (max. 1200 px bzw.
 * 240 px, JPEG) -- die API hat kein sharp und speichert, was kommt. Die
 * Grenze ist trotzdem hart: base64 im JSON (+33 %) und hex-kodiert zur DB
 * (x2) ergeben bei 2 MB rund 5 MB je Paket, deutlich unter dem
 * MariaDB-Standard von 16 MB fuer max_allowed_packet.
 */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024
export const MAX_VORSCHAU_BYTES = 150 * 1024

/** Positivliste; SVG bleibt draussen (skriptfaehig, wird unter unserer Domain ausgeliefert). */
export const FOTO_TYPEN = ['image/jpeg', 'image/png', 'image/webp']

export const MAX_POSITIONEN = 50
export const MAX_MENGE = 9999
export const MAX_ZEITRAUM_TAGE = 366
export const BELEGUNG_STANDARD_TAGE = 90

/** Rueckgabe-Erinnerung: so viele Tage nach `bis`. */
export const ERINNERUNG_RUECKGABE_TAGE = 7
/** Offener Antrag: Erinnerung an die Materialwarte nach so vielen Tagen ... */
export const ERINNERUNG_OFFEN_TAGE = 7
/** ... oder wenn der Ausleihbeginn naeher ist als so viele Tage. */
export const ERINNERUNG_OFFEN_VORLAUF_TAGE = 14

/* ------------------------------------------------------------ Schema ---- */

const TABELLEN = [
  'materialKategorie',
  'material',
  'materialFoto',
  'materialAntrag',
  'materialAntragPosition'
]

let schemaDa = false
let zuletztGeprueft = 0
const PRUEF_ABSTAND_MS = 30 * 1000

/**
 * 503 statt SQL-Fehler in jeder Route, solange sql/material-schema.sql nicht
 * eingespielt ist. Ein Erfolg wird dauerhaft gemerkt, ein Fehlschlag nur
 * 30 Sekunden -- so muss die API nach dem Einspielen nicht neu starten.
 */
export async function requireMaterialSchema(): Promise<void> {
  if (schemaDa) return
  const jetzt = Date.now()
  if (jetzt - zuletztGeprueft > PRUEF_ABSTAND_MS) {
    zuletztGeprueft = jetzt
    try {
      const rows = await queryP<Record<string, string>>(
        "SHOW TABLES LIKE 'material%'"
      )
      const namen = new Set(rows.map((r) => String(Object.values(r)[0])))
      schemaDa = TABELLEN.every((t) => namen.has(t))
    } catch {
      schemaDa = false
    }
    if (!schemaDa) {
      console.error(
        '[material] DB-Schema fehlt -- sql/material-schema.sql einspielen'
      )
    }
  }
  if (!schemaDa) {
    throw new PortalFehler(
      'KEIN_SCHEMA',
      'Die Materialverwaltung ist noch nicht eingerichtet.',
      503
    )
  }
}

/** Fuer den Erinnerungsjob: still nichts tun, wenn das Schema fehlt. */
export async function schemaVorhanden(): Promise<boolean> {
  try {
    await requireMaterialSchema()
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------- Validierung --- */

export function text(
  wert: unknown,
  feld: string,
  maxLaenge: number,
  pflicht = false
): string {
  const s = typeof wert === 'string' ? wert.trim() : ''
  if (pflicht && !s) throw badRequest('PFLICHTFELD', `${feld} fehlt.`)
  if (s.length > maxLaenge) {
    throw badRequest(
      'ZU_LANG',
      `${feld} ist zu lang (höchstens ${maxLaenge} Zeichen).`
    )
  }
  return s
}

export function ganzzahl(
  wert: unknown,
  feld: string,
  min: number,
  max: number
): number {
  const n =
    typeof wert === 'number'
      ? wert
      : typeof wert === 'string' && /^-?\d+$/.test(wert.trim())
        ? Number(wert)
        : NaN
  if (!Number.isInteger(n)) {
    throw badRequest('INVALID_INPUT', `${feld} muss eine ganze Zahl sein.`)
  }
  if (n < min || n > max) {
    throw badRequest(
      'INVALID_INPUT',
      `${feld} muss zwischen ${min} und ${max} liegen.`
    )
  }
  return n
}

export function pruefeBereich(wert: unknown): Bereich {
  if (wert === 'allgemein' || wert === 'referenten') return wert
  throw badRequest(
    'BEREICH',
    'Bereich muss "allgemein" oder "referenten" sein.'
  )
}

export interface Zeitraum {
  /** YYYY-MM-DD */
  von: string
  /** YYYY-MM-DD, inklusiv */
  bis: string
}

/**
 * Zeitraum aus zwei `YYYY-MM-DD`-Strings. Streng geparst (parseDatum), als
 * ISO-Strings zurueck -- die landen direkt als SQL-Parameter. Kalender-
 * Arithmetik ohne Uhrzeit ist in JS unproblematisch; nur Zeitstempel-
 * Vergleiche gehoeren in SQL.
 */
export function pruefeZeitraum(vonRoh: unknown, bisRoh: unknown): Zeitraum {
  const von = parseDatum(vonRoh)
  const bis = parseDatum(bisRoh)
  if (!von || !bis) {
    throw badRequest(
      'ZEITRAUM',
      'Bitte "von" und "bis" als JJJJ-MM-TT angeben.'
    )
  }
  if (bis < von) {
    throw badRequest('ZEITRAUM', 'Das Ende liegt vor dem Anfang.')
  }
  const tage = Math.round(
    (Date.UTC(bis.getFullYear(), bis.getMonth(), bis.getDate()) -
      Date.UTC(von.getFullYear(), von.getMonth(), von.getDate())) /
      86400000
  )
  if (tage > MAX_ZEITRAUM_TAGE) {
    throw badRequest(
      'ZEITRAUM',
      `Ein Zeitraum darf höchstens ${MAX_ZEITRAUM_TAGE} Tage umfassen.`
    )
  }
  return { von: isoDatum(von)!, bis: isoDatum(bis)! }
}

/** Optionaler Zeitraum aus der Query: beide oder keins. */
export function zeitraumAusQuery(von: unknown, bis: unknown): Zeitraum | null {
  if (von === undefined && bis === undefined) return null
  if (von === '' && bis === '') return null
  return pruefeZeitraum(von, bis)
}

/**
 * Zeitstempel als ISO-UTC direkt aus SQL (wie schutzkonzept/config.ts): die
 * DB laeuft in UTC, Node in Ortszeit -- ein Date aus dem Treiber laege im
 * Sommer zwei Stunden daneben. Formatiert in SQL gibt es diese Falle nicht.
 */
export const isoSql = (spalte: string): string =>
  `DATE_FORMAT(${spalte}, '%Y-%m-%dT%H:%i:%sZ')`

/** `YYYY-MM-DD` heute plus n Tage (Kalender, ohne Uhrzeit). */
export function heutePlus(tage: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + tage)
  return isoDatum(d)!
}
