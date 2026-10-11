import { randomBytes } from 'crypto'
import { sha3_512 } from 'js-sha3'
import { ecError } from '../helpers/error'
import { queryP } from '../helpers/mysql'
import { vergissStatus } from './sperre'

/**
 * Pflege der Verwaltungs-Konten (Tabelle `users`) aus EC-Verwaltung,
 * Sonstiges -> Administration.
 *
 * Es gibt bewusst keine Rollen: jeder angemeldete Benutzer der Verwaltung darf
 * Benutzer anlegen und sperren.
 *
 * Gelöscht wird nie. `users.user_id` steht in Protokollen und Historien
 * (Anmeldungs-Protokoll, Dateivorlagen, FZ-Mailtexte) -- ein gelöschter
 * Benutzer würde dort zu "unbekannt". Gesperrt wird über das Ablaufdatum:
 * login() lässt nur Konten mit `ablauf_datum > NOW()` zu, eine Sperre setzt es
 * auf heute. Entsperren heißt, ein neues Ablaufdatum zu setzen. Dadurch
 * braucht die Administration keine Schemaänderung.
 *
 * Zeitstempel kommen als ISO-UTC direkt aus SQL (wie vorlagen/store.ts): die
 * DB läuft in UTC, Node in Ortszeit -- ein Date aus dem Treiber läge im Sommer
 * zwei Stunden daneben.
 *
 * `last_login` hat ON UPDATE current_timestamp(): jedes UPDATE ohne
 * `last_login = last_login` würde die Spalte auf jetzt setzen und die Liste
 * verfälschen.
 */

export type VerwaltungsUser = {
  userID: number
  username: string
  personID: number
  vorname: string | null
  nachname: string | null
  ablaufDatum: string
  lastLogin: string | null
  aktiv: boolean
}

const MIN_PASSWORT = 8

/** Gleiches Verfahren wie in users.ts, damit login() die Konten annimmt. */
function hash(pwd: string, salt: string): string {
  return sha3_512(salt + pwd)
}

function neuesSalt(): string {
  return randomBytes(64).toString('hex')
}

function ganzzahl(wert: unknown): number {
  const n = typeof wert === 'string' ? Number(wert) : wert
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return 0
  return n
}

function pruefeDatum(wert: unknown): string {
  if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(wert)) {
    throw new ecError('Das Ablaufdatum fehlt oder ist ungültig.', 400)
  }
  const d = new Date(`${wert}T00:00:00Z`)
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== wert) {
    throw new ecError('Das Ablaufdatum fehlt oder ist ungültig.', 400)
  }
  return wert
}

function pruefePasswort(wert: unknown): string {
  if (typeof wert !== 'string' || wert.length < MIN_PASSWORT) {
    throw new ecError(
      `Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.`,
      400
    )
  }
  if (wert.length > 200) {
    throw new ecError('Das Passwort ist zu lang.', 400)
  }
  return wert
}

export async function listeUser(): Promise<VerwaltungsUser[]> {
  const rows = await queryP<any>(
    `SELECT u.user_id AS userID, u.username, u.person_id AS personID,
            p.vorname, p.nachname,
            DATE_FORMAT(u.ablauf_datum, '%Y-%m-%d') AS ablaufDatum,
            DATE_FORMAT(u.last_login, '%Y-%m-%dT%H:%i:%sZ') AS lastLogin,
            (u.ablauf_datum > NOW()) AS aktiv
       FROM users u
       LEFT JOIN personen p ON p.personID = u.person_id
      ORDER BY aktiv DESC, u.username`
  )
  return rows.map((r) => ({ ...r, aktiv: Number(r.aktiv) === 1 }))
}

async function ladeUser(userID: number): Promise<{ user_id: number }> {
  const rows = await queryP<{ user_id: number }>(
    'SELECT user_id FROM users WHERE user_id = ?',
    [userID]
  )
  if (rows.length !== 1) {
    throw new ecError('Der Benutzer existiert nicht.', 404)
  }
  return rows[0]
}

export async function legeUserAn(eingabe: {
  personID: unknown
  username: unknown
  passwort: unknown
  ablaufDatum: unknown
}): Promise<number> {
  const personID = ganzzahl(eingabe.personID)
  if (!personID) throw new ecError('Bitte eine Person auswählen.', 400)

  const username =
    typeof eingabe.username === 'string' ? eingabe.username.trim() : ''
  if (username.length < 3 || username.length > 200) {
    throw new ecError(
      'Der Benutzername muss zwischen 3 und 200 Zeichen haben.',
      400
    )
  }
  if (/\s/.test(username)) {
    throw new ecError('Der Benutzername darf keine Leerzeichen enthalten.', 400)
  }

  const passwort = pruefePasswort(eingabe.passwort)
  const ablaufDatum = pruefeDatum(eingabe.ablaufDatum)

  const person = await queryP(
    'SELECT personID FROM personen WHERE personID = ?',
    [personID]
  )
  if (person.length !== 1) {
    throw new ecError('Die Person existiert nicht.', 400)
  }

  const vorhanden = await queryP(
    'SELECT user_id FROM users WHERE username = ?',
    [username]
  )
  if (vorhanden.length) {
    throw new ecError('Diesen Benutzernamen gibt es schon.', 409)
  }

  const salt = neuesSalt()
  const res: any = await queryP(
    `INSERT INTO users (person_id, username, password, salt, ablauf_datum)
     VALUES (?, ?, ?, ?, ?)`,
    [personID, username, hash(passwort, salt), salt, ablaufDatum]
  )
  return res.insertId
}

/**
 * Sperrt einen Benutzer sofort. Das eigene Konto lässt sich nicht sperren --
 * sonst sperrt sich der letzte aktive Benutzer aus, und zurück führt dann nur
 * noch ein Eingriff in die Datenbank.
 */
export async function sperreUser(
  userID: number,
  eigeneUserID: number
): Promise<void> {
  if (userID === eigeneUserID) {
    throw new ecError('Das eigene Konto kann nicht gesperrt werden.', 409)
  }
  await ladeUser(userID)
  await queryP(
    `UPDATE users SET ablauf_datum = CURDATE(), last_login = last_login
      WHERE user_id = ?`,
    [userID]
  )
  vergissStatus(userID)
}

export async function setzeAblaufDatum(
  userID: number,
  ablaufDatum: unknown,
  eigeneUserID: number
): Promise<void> {
  const datum = pruefeDatum(ablaufDatum)
  await ladeUser(userID)
  if (
    userID === eigeneUserID &&
    new Date(`${datum}T00:00:00`).getTime() <= Date.now()
  ) {
    throw new ecError('Das eigene Konto kann nicht gesperrt werden.', 409)
  }
  await queryP(
    `UPDATE users SET ablauf_datum = ?, last_login = last_login
      WHERE user_id = ?`,
    [datum, userID]
  )
  vergissStatus(userID)
}

export async function setzePasswort(
  userID: number,
  passwort: unknown
): Promise<void> {
  const pwd = pruefePasswort(passwort)
  await ladeUser(userID)
  const salt = neuesSalt()
  await queryP(
    `UPDATE users SET password = ?, salt = ?, last_login = last_login
      WHERE user_id = ?`,
    [hash(pwd, salt), salt, userID]
  )
}

export { ganzzahl }
