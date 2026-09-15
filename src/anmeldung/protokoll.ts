import { PoolConnection } from 'promise-mysql'
import { queryP } from '../helpers/mysql'

/**
 * Protokoll der eingreifenden Aenderungen an Anmeldungen.
 *
 * Geschrieben wird von drei Stellen: der bestehenden Abmeldung (GraphQL
 * `abmelden`), der Ruecknahme einer Abmeldung und der Loeschung einer
 * abgemeldeten Anmeldung (beide REST, src/api/anmeldung.ts).
 *
 * Inhalt sind ausschliesslich Status-, Zahlungs- und Abmeldefelder. Gesundheits-
 * und Allergieangaben, Bemerkungen und extra_json bleiben draussen: das sind
 * Daten nach DSGVO Art. 9 ueber Minderjaehrige, und ein Protokoll, das sie
 * mitschreibt, macht eine Loeschung wirkungslos (gleiche Regel wie portalAudit
 * und dublettenLog).
 */

/** Felder einer Anmeldung, die das Protokoll festhaelt. */
export type Zustand = {
  wartelistenPlatz: number
  position: number
  abmeldeZeitpunkt: string | null
  abmeldeGebuehr: number
  wegDerAbmeldung: string
  kommentarAbmeldung: string
  bisherBezahlt: number
  rueckbezahlt: number
}

export type Eintrag = {
  anmeldeID: string
  personID: number
  veranstaltungsID: number
  userID: number
  aktion: 'abmelden' | 'ruecknahme' | 'loeschen'
  begruendung: string
  vorher: Partial<Zustand>
  /** Bei `loeschen` leer -- es gibt kein Nachher. */
  nachher: Partial<Zustand>
  ip?: string
}

/**
 * Zieht aus einer Anmeldungszeile genau die protokollierten Felder.
 *
 * `abmeldeZeitpunkt` muss als `UNIX_TIMESTAMP(abmeldeZeitpunkt)` selektiert
 * sein (Epoch-Sekunden), nicht als rohe TIMESTAMP-Spalte: MySQL laeuft in UTC,
 * Node in lokaler Zeit, und promise-mysql liest den UTC-Wert als lokale Zeit --
 * im Sommer zwei Stunden daneben. UNIX_TIMESTAMP rechnet in der Datenbank um
 * und ist damit unabhaengig von beiden Zeitzonen.
 */
export function zustand(zeile: Record<string, any>): Zustand {
  const zeit = zeile.abmeldeZeitpunkt
  return {
    wartelistenPlatz: Number(zeile.wartelistenPlatz ?? 0),
    position: Number(zeile.position ?? 0),
    abmeldeZeitpunkt: epochZuIso(zeit),
    abmeldeGebuehr: Number(zeile.abmeldeGebuehr ?? 0),
    wegDerAbmeldung: String(zeile.wegDerAbmeldung ?? ''),
    kommentarAbmeldung: String(zeile.kommentarAbmeldung ?? ''),
    bisherBezahlt: Number(zeile.bisherBezahlt ?? 0),
    rueckbezahlt: Number(zeile.rueckbezahlt ?? 0)
  }
}

/** Epoch-Sekunden (oder null/0) -> ISO-String; alles andere unveraendert null. */
function epochZuIso(v: unknown): string | null {
  const n = Number(v)
  if (!v || !Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

const INSERT = `INSERT INTO anmeldungProtokoll
    (anmeldeID, personID, veranstaltungsID, user_id, aktion, begruendung, vorher, nachher, ip)
  VALUES (?,?,?,?,?,?,?,?,?)`

function werte(e: Eintrag): unknown[] {
  return [
    e.anmeldeID,
    e.personID,
    e.veranstaltungsID,
    e.userID,
    e.aktion,
    e.begruendung.slice(0, 500),
    JSON.stringify(e.vorher),
    JSON.stringify(e.nachher),
    (e.ip ?? '').slice(0, 45)
  ]
}

/**
 * Schreibt einen Eintrag innerhalb einer laufenden Transaktion.
 *
 * Wirft absichtlich weiter: bei Ruecknahme und Loeschung gehoert der
 * Protokolleintrag zum Vorgang. Eine Loeschung, deren Protokoll nicht
 * geschrieben werden konnte, waere spurlos -- dann lieber gar nicht loeschen
 * und die Transaktion zuruecknehmen.
 */
export async function protokolliere(
  conn: PoolConnection,
  e: Eintrag
): Promise<void> {
  await conn.query(INSERT, werte(e))
}

/**
 * Schreibt einen Eintrag ausserhalb einer Transaktion und schluckt Fehler.
 *
 * Fuer die bestehende Abmeldung: die lief jahrelang ohne Protokoll, und ein
 * fehlendes anmeldung-protokoll.sql darf eine fachlich korrekte Abmeldung
 * nicht scheitern lassen (gleiche Abwaegung wie beim Merge in
 * src/dubletten/merge.ts).
 */
export async function protokolliereLeise(e: Eintrag): Promise<void> {
  try {
    await queryP(INSERT, werte(e))
  } catch (err) {
    const text = String((err as Error).message)
    if (/doesn't exist|Unknown table/i.test(text)) {
      console.warn(
        '[anmeldung] anmeldungProtokoll fehlt – Abmeldung nicht protokolliert. ' +
          'sql/anmeldung-protokoll.sql einspielen.'
      )
      return
    }
    console.error(
      '[anmeldung] Protokoll fehlgeschlagen:',
      e.aktion,
      e.anmeldeID,
      err
    )
  }
}

/** Eine Protokollzeile, wie sie die Verwaltung anzeigt. */
export type ProtokollZeile = {
  protokollID: number
  ts: string
  anmeldeID: string
  personID: number
  veranstaltungsID: number
  aktion: string
  begruendung: string
  vorher: Partial<Zustand>
  nachher: Partial<Zustand>
  /** Anzeigename aus `users`, leer wenn der Account inzwischen weg ist. */
  benutzer: string
  person: string
}

type Filter = {
  anmeldeID?: string
  personID?: number
  veranstaltungsID?: number
}

/**
 * Liest das Protokoll.
 *
 * Der Personenname kommt aus `personen` und nicht aus dem Eintrag: das
 * Protokoll speichert bewusst keine Personendaten, und nach einer Loeschung
 * existiert die Person selbst ja weiter -- nur ihre Anmeldung nicht mehr.
 */
export async function leseProtokoll(
  filter: Filter,
  limit = 200
): Promise<ProtokollZeile[]> {
  const wo: string[] = []
  const params: unknown[] = []

  if (filter.anmeldeID) {
    wo.push('p.anmeldeID = ?')
    params.push(filter.anmeldeID)
  }
  if (filter.personID) {
    wo.push('p.personID = ?')
    params.push(filter.personID)
  }
  if (filter.veranstaltungsID) {
    wo.push('p.veranstaltungsID = ?')
    params.push(filter.veranstaltungsID)
  }
  if (wo.length === 0) return []

  const zeilen = await queryP<any>(
    `SELECT p.protokollID, UNIX_TIMESTAMP(p.ts) AS ts, p.anmeldeID, p.personID, p.veranstaltungsID,
            p.aktion, p.begruendung, p.vorher, p.nachher,
            COALESCE(u.username, '') AS benutzer,
            COALESCE(CONCAT(per.vorname, ' ', per.nachname), '') AS person
       FROM anmeldungProtokoll p
       LEFT JOIN users    u   ON u.user_id   = p.user_id
       LEFT JOIN personen per ON per.personID = p.personID
      WHERE ${wo.join(' AND ')}
      ORDER BY p.ts DESC, p.protokollID DESC
      LIMIT ?`,
    [...params, limit]
  )

  return zeilen.map((z) => ({
    protokollID: z.protokollID,
    ts: epochZuIso(z.ts) ?? '',
    anmeldeID: z.anmeldeID,
    personID: z.personID,
    veranstaltungsID: z.veranstaltungsID,
    aktion: z.aktion,
    begruendung: z.begruendung,
    vorher: jsonOderLeer(z.vorher),
    nachher: jsonOderLeer(z.nachher),
    benutzer: z.benutzer,
    person: z.person
  }))
}

/**
 * Ein kaputter JSON-Wert (Handeingriff in der Datenbank) darf nicht die ganze
 * Protokollansicht ausknipsen -- gerade dann will man hinsehen.
 */
function jsonOderLeer(v: unknown): Partial<Zustand> {
  try {
    return JSON.parse(String(v || '{}'))
  } catch {
    return {}
  }
}

/**
 * Prueft einmalig, ob sql/anmeldung-protokoll.sql eingespielt ist.
 * Ergebnis wird gecacht -- eine Schema-Frage aendert sich zur Laufzeit nicht
 * (Vorbild: src/dubletten/schema.ts).
 */
let geprueft: boolean | null = null

export async function hatProtokollTabelle(): Promise<boolean> {
  if (geprueft !== null) return geprueft
  try {
    const r = await queryP<{ n: number }>(
      `SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'anmeldungProtokoll'`
    )
    geprueft = Number(r[0]?.n ?? 0) === 1
  } catch {
    geprueft = false
  }
  if (!geprueft) {
    console.warn(
      '[anmeldung] sql/anmeldung-protokoll.sql ist nicht eingespielt: ' +
        'Rücknahme und Löschung sind deaktiviert.'
    )
  }
  return geprueft
}

/** Nur fuer Tests: erneute Pruefung erzwingen. */
export function schemaPruefungZuruecksetzen(): void {
  geprueft = null
}
