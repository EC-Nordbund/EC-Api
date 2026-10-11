import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import { ecError } from '../helpers/error'
import { queryP, withConnection } from '../helpers/mysql'
import { maxPaketBytes, passtInPaket } from '../helpers/paket'
import { findeEintrag, KatalogEintrag, MIME } from './katalog'

/**
 * Ablage der Dateivorlagen: Datenbank zuerst, Dateisystem als Fallback.
 *
 * Alle Erzeuger (Briefe, FZ-Antrag, TN-Listen, Anmelde-Mails) holen ihre
 * Vorlage ueber ladeVorlage(). Solange sql/datei-vorlagen.sql nicht
 * eingespielt ist oder ein Schluessel keinen DB-Eintrag hat, kommt die Datei
 * aus dem Dateisystem -- die API verhaelt sich dann wie vor 09/2026.
 *
 * Cache: Die API laeuft als ein Prozess, geschrieben wird nur ueber dieses
 * Modul. Deshalb reicht ein Speicher-Cache je Schluessel, den jeder
 * Schreibpfad hier leert. Wer die Tabelle direkt per SQL aendert, startet
 * die API neu.
 */

/** 10 MB je Datei; siehe Begruendung in sql/datei-vorlagen.sql. */
export const MAX_BYTES = 10 * 1024 * 1024
/** Historie je Schluessel: aeltere Fassungen fallen weg. */
export const MAX_VERSIONEN = 10

export interface Datei {
  dateiname: string
  mimetype: string
  groesse: number
  sha256: string
  inhalt: Buffer
}

export interface Geladen extends Datei {
  quelle: 'db' | 'datei'
  eintrag: KatalogEintrag
}

export interface Kopf {
  schluessel: string
  dateiname: string
  mimetype: string
  groesse: number
  sha256: string
  /** ISO-UTC, siehe isoSql. */
  geaendertAm: string
  geaendertVon: number
  benutzer: string
}

export const sha256 = (b: Buffer) =>
  createHash('sha256').update(b).digest('hex')

/**
 * Zeitstempel als ISO-UTC direkt aus SQL (wie material/config.ts und
 * schutzkonzept/config.ts): die DB laeuft in UTC, Node in Ortszeit -- ein
 * Date aus dem Treiber laege im Sommer zwei Stunden daneben.
 */
const isoSql = (spalte: string): string =>
  `DATE_FORMAT(${spalte}, '%Y-%m-%dT%H:%i:%sZ')`

/* ------------------------------------------------------------- Schema -- */

const TABELLEN = ['dateiVorlage', 'dateiVorlageVersion']
let schemaDa = false
let zuletztGeprueft = 0
const PRUEF_ABSTAND_MS = 30 * 1000

/**
 * Sind die Tabellen da? Erfolg wird dauerhaft gemerkt, ein Fehlschlag nur
 * 30 Sekunden -- nach dem Einspielen muss die API nicht neu starten.
 * SHOW TABLES statt information_schema: dort hat der Prod-DB-User keine Rechte.
 */
export async function schemaVorhanden(): Promise<boolean> {
  if (schemaDa) return true
  const jetzt = Date.now()
  if (jetzt - zuletztGeprueft > PRUEF_ABSTAND_MS) {
    zuletztGeprueft = jetzt
    try {
      const rows = await queryP<Record<string, string>>(
        "SHOW TABLES LIKE 'dateiVorlage%'"
      )
      const namen = new Set(rows.map((r) => String(Object.values(r)[0])))
      schemaDa = TABELLEN.every((t) => namen.has(t))
    } catch {
      schemaDa = false
    }
    if (!schemaDa) {
      console.error(
        '[vorlagen] DB-Schema fehlt -- sql/datei-vorlagen.sql einspielen; Vorlagen kommen aus dem Dateisystem'
      )
    }
  }
  return schemaDa
}

/** Fuer die Pflegemaske: ohne Schema 503 mit klarer Ansage. */
export async function requireSchema(): Promise<void> {
  if (!(await schemaVorhanden())) {
    throw new ecError(
      'Die Dateivorlagen sind noch nicht eingerichtet. Bitte sql/datei-vorlagen.sql einspielen.',
      503
    )
  }
}

/* -------------------------------------------------------------- Lesen -- */

const cache = new Map<string, Geladen>()

export function invalidiere(schluessel?: string): void {
  if (schluessel === undefined) cache.clear()
  else cache.delete(schluessel)
}

export function eintragOder404(schluessel: string): KatalogEintrag {
  const e = findeEintrag(schluessel)
  if (!e) throw new ecError(`Unbekannte Vorlage „${schluessel}".`, 404)
  return e
}

/** Fallback-Datei lesen, falls vorhanden. */
function ausDateisystem(eintrag: KatalogEintrag): Datei | null {
  if (!eintrag.fallback || !existsSync(eintrag.fallback.pfad)) return null
  const inhalt = readFileSync(eintrag.fallback.pfad)
  return {
    dateiname: basename(eintrag.fallback.pfad),
    mimetype: MIME[eintrag.art],
    groesse: inhalt.length,
    sha256: sha256(inhalt),
    inhalt
  }
}

export function fallbackVorhanden(eintrag: KatalogEintrag): boolean {
  return !!eintrag.fallback && existsSync(eintrag.fallback.pfad)
}

async function ausDatenbank(schluessel: string): Promise<Datei | null> {
  if (!(await schemaVorhanden())) return null
  const rows = await queryP<any>(
    'SELECT dateiname, mimetype, groesse, sha256, inhalt FROM dateiVorlage WHERE schluessel = ?',
    [schluessel]
  )
  if (rows.length !== 1) return null
  const r = rows[0]
  return {
    dateiname: r.dateiname,
    mimetype: r.mimetype,
    groesse: r.groesse,
    sha256: r.sha256,
    inhalt: r.inhalt as Buffer
  }
}

/**
 * Vorlage zu einem Schluessel: erst Datenbank, dann Dateisystem. Fehlt
 * beides, ist das ein Fehler mit Handlungsanweisung -- beim Sicherungsschein
 * bewusst kein Ausweichen auf ein anderes Jahr.
 */
export async function ladeVorlage(schluessel: string): Promise<Geladen> {
  const eintrag = eintragOder404(schluessel)
  const c = cache.get(schluessel)
  if (c) return c

  const db = await ausDatenbank(schluessel)
  const geladen: Geladen | null = db
    ? { ...db, quelle: 'db', eintrag }
    : (() => {
        const d = ausDateisystem(eintrag)
        return d ? { ...d, quelle: 'datei' as const, eintrag } : null
      })()

  if (!geladen) {
    throw new ecError(
      `Die Vorlage „${eintrag.name}" fehlt. Bitte in EC-Verwaltung unter Sonstiges → Dateivorlagen hochladen.`,
      500
    )
  }
  cache.set(schluessel, geladen)
  return geladen
}

/** Textvorlage (Markdown) als String. */
export async function ladeText(schluessel: string): Promise<string> {
  return (await ladeVorlage(schluessel)).inhalt.toString('utf8')
}

/** Alle DB-Eintraege ohne Blob, fuer die Liste der Pflegemaske. */
export async function listeKoepfe(): Promise<Map<string, Kopf>> {
  const aus = new Map<string, Kopf>()
  if (!(await schemaVorhanden())) return aus
  const rows = await queryP<any>(
    `SELECT d.schluessel, d.dateiname, d.mimetype, d.groesse, d.sha256,
            ${isoSql('d.geaendert_am')} AS geaendert_am, d.geaendert_von, COALESCE(u.username, '') AS benutzer
       FROM dateiVorlage d
       LEFT JOIN users u ON u.user_id = d.geaendert_von`
  )
  for (const r of rows) {
    aus.set(r.schluessel, {
      schluessel: r.schluessel,
      dateiname: r.dateiname,
      mimetype: r.mimetype,
      groesse: r.groesse,
      sha256: r.sha256,
      geaendertAm: r.geaendert_am,
      geaendertVon: r.geaendert_von,
      benutzer: r.benutzer
    })
  }
  return aus
}

/** Schluessel der Familienmitglieder, die in der DB liegen. */
export async function familienmitgliederInDb(
  muster: RegExp
): Promise<string[]> {
  if (!(await schemaVorhanden())) return []
  const rows = await queryP<{ schluessel: string }>(
    'SELECT schluessel FROM dateiVorlage'
  )
  return rows.map((r) => r.schluessel).filter((s) => muster.test(s))
}

/* ---------------------------------------------------------- Schreiben -- */

export type Ergebnis = 'gespeichert' | 'unveraendert'

/**
 * Speichern. Die bisherige Fassung wandert in die Historie -- per
 * INSERT … SELECT innerhalb der Datenbank, der Blob reist nicht noch einmal
 * durch den Treiber. Gleiche Datei (sha256) = nichts zu tun.
 */
export async function speichere(
  schluessel: string,
  datei: Datei,
  userID: number,
  anmerkung = ''
): Promise<Ergebnis> {
  await requireSchema()
  eintragOder404(schluessel)

  if (!datei.inhalt.length) throw new ecError('Die Datei ist leer.', 400)
  if (datei.inhalt.length > MAX_BYTES) {
    throw new ecError(
      `Die Datei ist ${(datei.inhalt.length / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind ${MAX_BYTES / 1024 / 1024} MB.`,
      400
    )
  }
  if (!passtInPaket(datei.inhalt.length, await maxPaketBytes())) {
    throw new ecError(
      'Die Datei ist für die Datenbankverbindung zu groß (max_allowed_packet). Bitte kleiner machen oder den Wert in der DB anheben.',
      400
    )
  }

  const bisher = await queryP<{ sha256: string }>(
    'SELECT sha256 FROM dateiVorlage WHERE schluessel = ?',
    [schluessel]
  )
  if (bisher.length && bisher[0].sha256 === datei.sha256) return 'unveraendert'

  await withConnection(async (conn) => {
    if (bisher.length) {
      await conn.query(
        `INSERT INTO dateiVorlageVersion
           (schluessel, dateiname, mimetype, groesse, sha256, inhalt, user_id, anmerkung)
         SELECT schluessel, dateiname, mimetype, groesse, sha256, inhalt, ?, ?
           FROM dateiVorlage WHERE schluessel = ?`,
        [userID, anmerkung.slice(0, 200), schluessel]
      )
      const [{ c }] = await conn.query(
        'SELECT COUNT(*) AS c FROM dateiVorlageVersion WHERE schluessel = ?',
        [schluessel]
      )
      if (c > MAX_VERSIONEN) {
        await conn.query(
          `DELETE FROM dateiVorlageVersion WHERE schluessel = ?
            ORDER BY versionID ASC LIMIT ?`,
          [schluessel, c - MAX_VERSIONEN]
        )
      }
    }
    await conn.query(
      `INSERT INTO dateiVorlage
         (schluessel, dateiname, mimetype, groesse, sha256, inhalt, geaendert_von)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         dateiname = VALUES(dateiname), mimetype = VALUES(mimetype),
         groesse = VALUES(groesse), sha256 = VALUES(sha256),
         inhalt = VALUES(inhalt), geaendert_von = VALUES(geaendert_von)`,
      [
        schluessel,
        datei.dateiname,
        datei.mimetype,
        datei.inhalt.length,
        datei.sha256,
        datei.inhalt,
        userID
      ]
    )
  })
  invalidiere(schluessel)
  return 'gespeichert'
}

export interface VersionKopf {
  versionID: number
  /** ISO-UTC, siehe isoSql. */
  ts: string
  userID: number
  benutzer: string
  anmerkung: string
  groesse: number
  dateiname: string
  sha256: string
}

export async function listeVersionen(
  schluessel: string
): Promise<VersionKopf[]> {
  await requireSchema()
  eintragOder404(schluessel)
  const rows = await queryP<any>(
    `SELECT v.versionID, ${isoSql('v.ts')} AS ts, v.user_id, v.anmerkung, v.groesse, v.dateiname, v.sha256,
            COALESCE(u.username, '') AS benutzer
       FROM dateiVorlageVersion v
       LEFT JOIN users u ON u.user_id = v.user_id
      WHERE v.schluessel = ?
      ORDER BY v.versionID DESC
      LIMIT 50`,
    [schluessel]
  )
  return rows.map((r) => ({
    versionID: r.versionID,
    ts: r.ts,
    userID: r.user_id,
    benutzer: r.benutzer,
    anmerkung: r.anmerkung,
    groesse: r.groesse,
    dateiname: r.dateiname,
    sha256: r.sha256
  }))
}

export async function ladeVersion(
  schluessel: string,
  versionID: number
): Promise<Datei> {
  await requireSchema()
  const rows = await queryP<any>(
    `SELECT dateiname, mimetype, groesse, sha256, inhalt FROM dateiVorlageVersion
      WHERE versionID = ? AND schluessel = ?`,
    [versionID, schluessel]
  )
  if (rows.length !== 1) throw new ecError('Fassung nicht gefunden.', 404)
  const r = rows[0]
  return {
    dateiname: r.dateiname,
    mimetype: r.mimetype,
    groesse: r.groesse,
    sha256: r.sha256,
    inhalt: r.inhalt as Buffer
  }
}

/**
 * Alte Fassung zurueckholen -- als normales Speichern, die aktuelle Fassung
 * wandert dabei selbst in die Historie (wie bei den FZ-Mailtexten).
 */
export async function stelleWiederHer(
  schluessel: string,
  versionID: number,
  userID: number
): Promise<Ergebnis> {
  const alt = await ladeVersion(schluessel, versionID)
  return speichere(schluessel, alt, userID, `Fassung ${versionID} zurückgeholt`)
}

/** DB-Eintrag entfernen; die Historie bleibt, der Fallback greift wieder. */
export async function loesche(schluessel: string): Promise<void> {
  await requireSchema()
  eintragOder404(schluessel)
  await queryP('DELETE FROM dateiVorlage WHERE schluessel = ?', [schluessel])
  invalidiere(schluessel)
}

/**
 * Datei aus dem Dateisystem der laufenden API in die DB holen. Das ist der
 * Weg fuer die Vorlagen, die nur auf dem Prod-Server liegen (Briefe,
 * Sicherungsscheine) und die niemand lokal hat.
 */
export async function uebernehme(
  schluessel: string,
  userID: number
): Promise<Ergebnis | 'keine-datei'> {
  const eintrag = eintragOder404(schluessel)
  const d = ausDateisystem(eintrag)
  if (!d) return 'keine-datei'
  return speichere(schluessel, d, userID, 'aus dem Dateisystem übernommen')
}
