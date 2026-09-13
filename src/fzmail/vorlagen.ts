import { ecError } from '../helpers/error'
import { queryP, withConnection } from '../helpers/mysql'

/**
 * Mailtexte des FZ-Systems (Repo fz-mail-system).
 *
 * Die zehn Texte standen wortwoertlich in dessen cron.php. Eine Formulierung
 * zu aendern hiess: Entwickler, Commit, Deployment -- fuer Saetze, die die
 * Landesreferentin schreibt und verantwortet. Sie liegen jetzt in
 * `fzMailVorlage` und werden in EC-Verwaltung gepflegt; der Cron liest sie von
 * dort und faellt auf die Fassung im PHP-Code zurueck, wenn er nichts findet.
 *
 * Diese API legt KEINE Vorlagen an und loescht keine: welche Mails es gibt,
 * entscheidet der Code im FZ-System. Hier werden nur Betreff und Text
 * bearbeitet.
 */

export interface Vorlage {
  schluessel: string
  name: string
  beschreibung: string
  empfaenger: string
  platzhalter: string[]
  betreff: string
  text: string
  geaendertAm: Date | null
  geaendertVon: number
}

interface VorlageRow {
  schluessel: string
  name: string
  beschreibung: string
  empfaenger: string
  platzhalter: string
  betreff: string
  text: string
  geaendert_am: Date | null
  geaendert_von: number
}

/** Die Tabellen kommen aus sql/fz-mail-vorlagen.sql -- ohne sie: 503. */
export async function pruefeSchema(): Promise<void> {
  const t = await queryP<{ c: number }>(
    `SELECT COUNT(*) AS c FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN ('fzMailVorlage','fzMailVorlageVersion')`
  )
  if (t[0]?.c !== 2) {
    throw new ecError(
      'Die Mailvorlagen-Tabellen fehlen. Bitte sql/fz-mail-vorlagen.sql einspielen.',
      503
    )
  }
}

function formen(r: VorlageRow): Vorlage {
  return {
    schluessel: r.schluessel,
    name: r.name,
    beschreibung: r.beschreibung,
    empfaenger: r.empfaenger,
    platzhalter: r.platzhalter
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    betreff: r.betreff,
    text: r.text,
    geaendertAm: r.geaendert_am,
    geaendertVon: r.geaendert_von
  }
}

export async function listeVorlagen(): Promise<Vorlage[]> {
  await pruefeSchema()
  const rows = await queryP<VorlageRow>(
    'SELECT * FROM fzMailVorlage ORDER BY name'
  )
  return rows.map(formen)
}

export async function ladeVorlage(schluessel: string): Promise<Vorlage> {
  await pruefeSchema()
  const rows = await queryP<VorlageRow>(
    'SELECT * FROM fzMailVorlage WHERE schluessel = ?',
    [schluessel]
  )
  if (rows.length !== 1) throw new ecError('Vorlage nicht gefunden', 404)
  return formen(rows[0])
}

/**
 * Pruefung vor dem Speichern.
 *
 * Der wichtigste Teil ist die Platzhalter-Liste: ein Tippfehler wie
 * {{vornahme}} faellt sonst erst auf, wenn die Mail beim Empfaenger liegt --
 * der Cron wirft unbekannte Platzhalter beim Versand still weg, die Anrede
 * waere dann leer. Deshalb hier harte Ablehnung statt stiller Korrektur.
 */
function pruefeEingabe(vorlage: Vorlage, betreff: string, text: string): void {
  if (!betreff.trim())
    throw new ecError('Der Betreff darf nicht leer sein', 400)
  if (betreff.length > 255)
    throw new ecError('Der Betreff ist zu lang (max. 255 Zeichen)', 400)
  if (!text.trim()) throw new ecError('Der Text darf nicht leer sein', 400)
  if (text.length > 60000)
    throw new ecError('Der Text ist zu lang (max. 60.000 Zeichen)', 400)

  const gefunden = new Set<string>()
  for (const treffer of `${betreff}\n${text}`.matchAll(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g
  )) {
    gefunden.add(treffer[1])
  }

  const unbekannt = [...gefunden].filter(
    (p) => !vorlage.platzhalter.includes(p)
  )
  if (unbekannt.length) {
    throw new ecError(
      `Unbekannte Platzhalter: ${unbekannt
        .map((p) => `{{${p}}}`)
        .join(', ')}. Erlaubt sind hier: ${vorlage.platzhalter
        .map((p) => `{{${p}}}`)
        .join(', ')}`,
      400
    )
  }

  // Die Texte sind HTML und landen in einem Mailprogramm. Skripte laufen dort
  // ohnehin nicht, aber sie gehoeren auch nicht in eine Vorlage -- und in der
  // Vorschau der Verwaltung wuerden sie ausgefuehrt.
  if (/<script|javascript:|\son\w+\s*=/i.test(text)) {
    throw new ecError(
      'Der Text enthält Skript-Anteile (<script>, javascript: oder on…=). Bitte entfernen.',
      400
    )
  }
}

/**
 * Speichern. Die BISHERIGE Fassung wandert dabei in die Historie -- so ist
 * jede Zwischenstufe erhalten und ein versehentlich ueberschriebener Text
 * einen Klick entfernt.
 */
export async function speichereVorlage(
  schluessel: string,
  betreff: string,
  text: string,
  userID: number,
  anmerkung = ''
): Promise<void> {
  const vorher = await ladeVorlage(schluessel)
  pruefeEingabe(vorher, betreff, text)

  if (vorher.betreff === betreff && vorher.text === text) return

  await withConnection(async (conn) => {
    await conn.query(
      `INSERT INTO fzMailVorlageVersion (schluessel, betreff, text, user_id, anmerkung)
       VALUES (?,?,?,?,?)`,
      [schluessel, vorher.betreff, vorher.text, userID, anmerkung.slice(0, 200)]
    )
    await conn.query(
      `UPDATE fzMailVorlage
          SET betreff = ?, text = ?, geaendert_von = ?
        WHERE schluessel = ?`,
      [betreff, text, userID, schluessel]
    )
  })
}

export interface VersionKopf {
  versionID: number
  ts: Date
  userID: number
  benutzer: string
  anmerkung: string
  zeichen: number
}

export async function listeVersionen(
  schluessel: string
): Promise<VersionKopf[]> {
  await pruefeSchema()
  const rows = await queryP<any>(
    `SELECT v.versionID, v.ts, v.user_id, v.anmerkung, CHAR_LENGTH(v.text) AS zeichen,
            COALESCE(u.username, '') AS benutzer
       FROM fzMailVorlageVersion v
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
    zeichen: r.zeichen
  }))
}

export async function ladeVersion(
  schluessel: string,
  versionID: number
): Promise<{ betreff: string; text: string; ts: Date }> {
  await pruefeSchema()
  const rows = await queryP<any>(
    `SELECT betreff, text, ts FROM fzMailVorlageVersion
      WHERE versionID = ? AND schluessel = ?`,
    [versionID, schluessel]
  )
  if (rows.length !== 1) throw new ecError('Fassung nicht gefunden', 404)
  return rows[0]
}

/**
 * Eine alte Fassung zurueckholen. Kein Sonderweg: die alte Fassung wird
 * normal gespeichert, die aktuelle wandert dabei selbst in die Historie --
 * ein versehentliches Zurueckholen laesst sich also genauso zuruecknehmen.
 */
export async function stelleWiederHer(
  schluessel: string,
  versionID: number,
  userID: number
): Promise<void> {
  const alt = await ladeVersion(schluessel, versionID)
  await speichereVorlage(
    schluessel,
    alt.betreff,
    alt.text,
    userID,
    `Fassung ${versionID} wiederhergestellt`
  )
}

/** Beispielwerte fuer die Vorschau -- dieselben Namen wie im FZ-System. */
export const BEISPIELWERTE: Record<string, string> = {
  vorname: 'Maria',
  nachname: 'Beispiel',
  kreis: 'EC Musterstadt',
  fz_verantwortlicher: 'Doro Demo',
  fz_bis: '01.06.2031',
  antrag_ende: '07.11.2026'
}
