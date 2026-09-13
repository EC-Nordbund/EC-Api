import { queryP } from '../helpers/mysql'
import { badRequest, notFound, PortalFehler } from './error'
import type { PortalScope } from './scope'

/**
 * Download-Bereich des Portals.
 *
 * Freizeitleiter und EC-Kreis-Verantwortliche brauchen immer wieder dieselben
 * Formulare -- Abrechnungsbogen, Merkblaetter, Einverstaendniserklaerungen.
 * Bisher kamen die auf Nachfrage aus der Geschaeftsstelle per Mail, in
 * wechselnden Fassungen.
 *
 * Zwei feste Bereiche, nicht frei konfigurierbar: was eine Freizeitleitung
 * braucht, ist etwas anderes als das, was ein EC-Kreis braucht, und eine
 * Rechtematrix pro Datei waere Pflegeaufwand ohne Gegenwert. Wer beides macht,
 * sieht beides.
 *
 *   freizeit -- sichtbar, wer eine Veranstaltung im Scope hat (Leitung,
 *               Hauptleitung und Kuechenleitung)
 *   kreis    -- sichtbar, wer fuer einen EC-Kreis zustaendig ist (FZ oder Ort)
 */

export type Bereich = 'freizeit' | 'kreis'

export const BEREICHE: Bereich[] = ['freizeit', 'kreis']

export const BEREICH_NAME: Record<Bereich, string> = {
  freizeit: 'Für Freizeiten',
  kreis: 'Für EC-Kreise'
}

/**
 * 10 MB je Datei.
 *
 * Die Datei reist base64-kodiert durch JSON (+33 %) und landet als ein einziges
 * Paket in MySQL; `max_allowed_packet` steht in Produktion womoeglich auf dem
 * MariaDB-Standard von 16 MB. Ausserdem ist ein 30-MB-Anhang fuer ein Merkblatt
 * ohnehin ein Fehler und keine Anforderung.
 */
export const MAX_BYTES = 10 * 1024 * 1024

/**
 * Erlaubte Dateitypen. Bewusst eine Positivliste: alles, was hier nicht steht,
 * wird abgelehnt.
 *
 * Ohne SVG und HTML -- beide koennen Skripte enthalten, und beide wuerden unter
 * unserer Domain ausgeliefert. Die Dateien gehen zwar als Anhang raus
 * (Content-Disposition: attachment), aber die Regel soll nicht daran haengen,
 * dass ein Header irgendwann verloren geht.
 */
const ERLAUBTE_TYPEN: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word (alt)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'Word',
  'application/vnd.ms-excel': 'Excel (alt)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint (alt)',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PowerPoint',
  'application/vnd.oasis.opendocument.text': 'OpenDocument Text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument Tabelle',
  'application/zip': 'ZIP-Archiv',
  'text/plain': 'Textdatei',
  'text/csv': 'CSV',
  'image/png': 'Bild (PNG)',
  'image/jpeg': 'Bild (JPEG)',
  'image/gif': 'Bild (GIF)'
}

export interface DownloadKopf {
  downloadID: number
  bereich: Bereich
  kategorie: string
  titel: string
  beschreibung: string
  dateiname: string
  mimetype: string
  groesse: number
  sortierung: number
  aktiv: boolean
  geaendert: Date
}

/** Spaltenliste ohne `inhalt` -- eine Liste darf keine Blobs laden. */
const KOPF_SPALTEN = `downloadID, bereich, kategorie, titel, beschreibung,
                      dateiname, mimetype, groesse, sortierung, aktiv, geaendert`

function formen(r: any): DownloadKopf {
  return {
    downloadID: r.downloadID,
    bereich: r.bereich,
    kategorie: r.kategorie,
    titel: r.titel,
    beschreibung: r.beschreibung,
    dateiname: r.dateiname,
    mimetype: r.mimetype,
    groesse: r.groesse,
    sortierung: r.sortierung,
    aktiv: r.aktiv === 1,
    geaendert: r.geaendert
  }
}

/** Ohne Tabelle: 503 statt SQL-Fehler in jeder Route. */
export async function pruefeSchema(): Promise<void> {
  const t = await queryP<{ c: number }>(
    `SELECT COUNT(*) AS c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'portalDownload'`
  )
  if (t[0]?.c !== 1) {
    throw new PortalFehler(
      'KEIN_SCHEMA',
      'Der Download-Bereich ist noch nicht eingerichtet.',
      503
    )
  }
}

/** Welche Bereiche diese Anmeldung sehen darf. */
export function bereicheFuer(scope: PortalScope): Bereich[] {
  if (scope.superuser) return [...BEREICHE]

  const bereiche: Bereich[] = []
  if (scope.veranstaltungen.length) bereiche.push('freizeit')
  if (scope.kreise.length) bereiche.push('kreis')
  return bereiche
}

export async function listeFuerPortal(
  bereiche: Bereich[]
): Promise<DownloadKopf[]> {
  await pruefeSchema()
  if (!bereiche.length) return []

  const platzhalter = bereiche.map(() => '?').join(',')
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} FROM portalDownload
      WHERE aktiv = 1 AND bereich IN (${platzhalter})
      ORDER BY bereich, kategorie, sortierung, titel`,
    bereiche
  )
  return rows.map(formen)
}

/** Alles, auch Inaktives -- fuer die Pflegemaske in EC-Verwaltung. */
export async function listeAlle(): Promise<DownloadKopf[]> {
  await pruefeSchema()
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} FROM portalDownload
      ORDER BY bereich, kategorie, sortierung, titel`
  )
  return rows.map(formen)
}

export async function ladeKopf(downloadID: number): Promise<DownloadKopf> {
  await pruefeSchema()
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN} FROM portalDownload WHERE downloadID = ?`,
    [downloadID]
  )
  if (rows.length !== 1) throw notFound('Datei nicht gefunden.')
  return formen(rows[0])
}

export async function ladeDatei(
  downloadID: number
): Promise<{ kopf: DownloadKopf; inhalt: Buffer }> {
  await pruefeSchema()
  const rows = await queryP<any>(
    `SELECT ${KOPF_SPALTEN}, inhalt FROM portalDownload WHERE downloadID = ?`,
    [downloadID]
  )
  if (rows.length !== 1) throw notFound('Datei nicht gefunden.')
  return { kopf: formen(rows[0]), inhalt: rows[0].inhalt as Buffer }
}

export interface Eingabe {
  bereich?: unknown
  kategorie?: unknown
  titel?: unknown
  beschreibung?: unknown
  sortierung?: unknown
  aktiv?: unknown
  dateiname?: unknown
  mimetype?: unknown
  /** base64, ohne data:-Praefix */
  inhalt?: unknown
}

interface GepruefteDatei {
  dateiname: string
  mimetype: string
  inhalt: Buffer
}

function text(wert: unknown, feld: string, maxLaenge: number, pflicht = false) {
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

/**
 * Datei pruefen: Typ, Groesse, Dateiname.
 *
 * Der Dateiname wird auf den reinen Namen gekuerzt -- ein Browser schickt bei
 * manchen Eingaben einen Pfad mit, und der landet sonst im
 * Content-Disposition-Header.
 */
function pruefeDatei(eingabe: Eingabe): GepruefteDatei {
  const roh = typeof eingabe.inhalt === 'string' ? eingabe.inhalt : ''
  if (!roh) throw badRequest('KEINE_DATEI', 'Es wurde keine Datei übergeben.')

  const mimetype = text(eingabe.mimetype, 'Dateityp', 120, true)
  if (!ERLAUBTE_TYPEN[mimetype]) {
    throw badRequest(
      'TYP',
      `Dateien vom Typ "${mimetype}" sind hier nicht vorgesehen. Erlaubt sind: ${[
        ...new Set(Object.values(ERLAUBTE_TYPEN))
      ].join(', ')}.`
    )
  }

  const inhalt = Buffer.from(roh, 'base64')
  if (!inhalt.length) {
    throw badRequest('LEER', 'Die Datei ist leer.')
  }
  if (inhalt.length > MAX_BYTES) {
    throw badRequest(
      'ZU_GROSS',
      `Die Datei ist ${(inhalt.length / 1024 / 1024).toFixed(
        1
      )} MB groß, erlaubt sind ${MAX_BYTES / 1024 / 1024} MB.`
    )
  }

  const dateiname =
    text(eingabe.dateiname, 'Dateiname', 255, true).split(/[\\/]/).pop() ?? ''

  return { dateiname, mimetype, inhalt }
}

function pruefeBereich(wert: unknown): Bereich {
  if (wert === 'freizeit' || wert === 'kreis') return wert
  throw badRequest('BEREICH', 'Bereich muss "freizeit" oder "kreis" sein.')
}

export async function anlegen(
  eingabe: Eingabe,
  userID: number
): Promise<number> {
  await pruefeSchema()

  const bereich = pruefeBereich(eingabe.bereich)
  const titel = text(eingabe.titel, 'Titel', 200, true)
  const datei = pruefeDatei(eingabe)

  const r: any = await queryP(
    `INSERT INTO portalDownload
       (bereich, kategorie, titel, beschreibung, dateiname, mimetype, groesse,
        inhalt, sortierung, aktiv, geaendert_von)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      bereich,
      text(eingabe.kategorie, 'Kategorie', 80),
      titel,
      text(eingabe.beschreibung, 'Beschreibung', 500),
      datei.dateiname,
      datei.mimetype,
      datei.inhalt.length,
      datei.inhalt,
      Number(eingabe.sortierung) || 0,
      eingabe.aktiv === false ? 0 : 1,
      userID
    ]
  )
  return r.insertId
}

/**
 * Aendern. Die Datei ist optional: ohne `inhalt` werden nur die Angaben
 * daneben angefasst, mit `inhalt` wird die Datei ersetzt -- der Eintrag und
 * damit der Link bleiben gleich. Die alte Fassung ist danach weg (so
 * entschieden), die Verwaltung fragt deshalb vorher nach.
 */
export async function aendern(
  downloadID: number,
  eingabe: Eingabe,
  userID: number
): Promise<void> {
  const vorher = await ladeKopf(downloadID)

  const felder: string[] = []
  const werte: unknown[] = []

  const setze = (spalte: string, wert: unknown) => {
    felder.push(`${spalte} = ?`)
    werte.push(wert)
  }

  if (eingabe.bereich !== undefined) {
    setze('bereich', pruefeBereich(eingabe.bereich))
  }
  if (eingabe.titel !== undefined) {
    setze('titel', text(eingabe.titel, 'Titel', 200, true))
  }
  if (eingabe.kategorie !== undefined) {
    setze('kategorie', text(eingabe.kategorie, 'Kategorie', 80))
  }
  if (eingabe.beschreibung !== undefined) {
    setze('beschreibung', text(eingabe.beschreibung, 'Beschreibung', 500))
  }
  if (eingabe.sortierung !== undefined) {
    setze('sortierung', Number(eingabe.sortierung) || 0)
  }
  if (eingabe.aktiv !== undefined) {
    setze('aktiv', eingabe.aktiv ? 1 : 0)
  }

  if (eingabe.inhalt !== undefined) {
    const datei = pruefeDatei(eingabe)
    setze('dateiname', datei.dateiname)
    setze('mimetype', datei.mimetype)
    setze('groesse', datei.inhalt.length)
    setze('inhalt', datei.inhalt)
  }

  if (!felder.length) return

  setze('geaendert_von', userID)
  werte.push(vorher.downloadID)

  await queryP(
    `UPDATE portalDownload SET ${felder.join(', ')} WHERE downloadID = ?`,
    werte
  )
}

export async function loeschen(downloadID: number): Promise<void> {
  await ladeKopf(downloadID)
  await queryP('DELETE FROM portalDownload WHERE downloadID = ?', [downloadID])
}

/** Fuer die Pflegemaske: welche Typen erlaubt sind, in Klartext. */
export const TYPEN_KLARTEXT = [...new Set(Object.values(ERLAUBTE_TYPEN))]
export const TYPEN_MIME = Object.keys(ERLAUBTE_TYPEN)
