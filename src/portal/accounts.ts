import { queryP, withConnection } from '../helpers/mysql'
import {
  MAX_FEHLVERSUCHE,
  SPERRE_MINUTEN,
  TTL_INVITE_STUNDEN,
  TTL_RESET_STUNDEN
} from './config'
import { PortalFehler, badRequest, notFound, unauthorized } from './error'
import { sendeEinladung, sendeReset } from './mail'
import {
  createLinkToken,
  hashLinkToken,
  hashPassword,
  needsRehash,
  pruefePasswort,
  verifyPassword,
  verzoegereWieVerify
} from './password'
import { createPortalToken } from './token'

export interface PortalUserRow {
  portalUserID: number
  personID: number
  email: string
  password_hash: string | null
  is_superuser: number
  aktiv: number
  last_login: Date | null
  token_gen: number
  failed_logins: number
  /**
   * 1, solange die Sperre laeuft -- berechnet von MySQL, NICHT aus einem
   * Zeitstempel in JS abgeleitet.
   *
   * Grund: der MySQL-Server laeuft in UTC, der Node-Prozess in lokaler Zeit.
   * promise-mysql liefert einen TIMESTAMP als Date, das den UTC-Wert als
   * LOKALE Zeit interpretiert -- im Sommer also zwei Stunden zu frueh. Ein
   * `locked_until.getTime() > Date.now()` in JS ist damit immer falsch, und
   * die Kontosperre greift nie. Zeitvergleiche gehoeren hier ausnahmslos in
   * die Datenbank, die mit sich selbst konsistent rechnet.
   */
  gesperrt: number
  vorname: string
  nachname: string
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

export interface LoginErgebnis {
  token: string
  expiresAt: string
  user: {
    portalUserID: number
    personID: number
    vorname: string
    nachname: string
    email: string
    superuser: boolean
  }
}

/**
 * Anmeldung mit Mailadresse und Passwort.
 *
 * Drei Dinge sind hier bewusst so gebaut:
 *
 *  - Die Fehlermeldung ist immer dieselbe, egal ob die Adresse unbekannt ist
 *    oder das Passwort falsch. Sonst wird der Login zum Adressverzeichnis.
 *  - Bei unbekannter Adresse wird trotzdem einmal scrypt gerechnet
 *    (verzoegereWieVerify). Ohne das verraet die Antwortzeit dasselbe, was die
 *    Meldung verschweigt.
 *  - Fehlversuche werden am Konto gezaehlt, nicht nur pro IP. Ein verteilter
 *    Angriff umgeht das IP-Limit sonst muehelos.
 */
export async function login(
  emailRoh: unknown,
  passwortRoh: unknown
): Promise<LoginErgebnis> {
  const email = normalisiereEmail(emailRoh)
  const passwort = typeof passwortRoh === 'string' ? passwortRoh : ''

  if (!email || !passwort) {
    throw badRequest('INVALID_CREDENTIALS', 'E-Mail und Passwort angeben.')
  }

  const rows = await queryP<PortalUserRow>(
    `SELECT pu.*, p.vorname, p.nachname,
            (pu.locked_until IS NOT NULL AND pu.locked_until > NOW()) AS gesperrt
       FROM portalUser pu
       JOIN personen p ON p.personID = pu.personID
      WHERE pu.email = ? AND pu.aktiv = 1 AND p.anonymisiert = 0`,
    [email]
  )

  if (rows.length !== 1) {
    await verzoegereWieVerify(passwort)
    throw unauthorizedLogin()
  }
  const u = rows[0]

  if (Number(u.gesperrt) === 1) {
    throw new PortalFehler(
      'LOCKED',
      `Zu viele Fehlversuche. Bitte in ${SPERRE_MINUTEN} Minuten erneut versuchen.`,
      423
    )
  }

  const passt = await verifyPassword(passwort, u.password_hash)
  if (!passt) {
    await zaehleFehlversuch(u.portalUserID, u.failed_logins)
    throw unauthorizedLogin()
  }

  // Erfolgreich: Zaehler zuruecksetzen und, falls die scrypt-Parameter
  // inzwischen strenger sind, den Hash stillschweigend erneuern.
  const neuerHash = needsRehash(u.password_hash)
    ? await hashPassword(passwort)
    : null

  await queryP(
    `UPDATE portalUser
        SET last_login = NOW(), failed_logins = 0, locked_until = NULL
            ${neuerHash ? ', password_hash = ?' : ''}
      WHERE portalUserID = ?`,
    neuerHash ? [neuerHash, u.portalUserID] : [u.portalUserID]
  )

  return baueLogin(u)
}

function unauthorizedLogin(): PortalFehler {
  return new PortalFehler(
    'INVALID_CREDENTIALS',
    'E-Mail-Adresse und Passwort passen nicht zusammen.',
    401
  )
}

async function zaehleFehlversuch(
  portalUserID: number,
  bisher: number
): Promise<void> {
  const neu = bisher + 1
  if (neu >= MAX_FEHLVERSUCHE) {
    await queryP(
      `UPDATE portalUser
          SET failed_logins = ?, locked_until = NOW() + INTERVAL ? MINUTE
        WHERE portalUserID = ?`,
      [neu, SPERRE_MINUTEN, portalUserID]
    )
  } else {
    await queryP(
      'UPDATE portalUser SET failed_logins = ? WHERE portalUserID = ?',
      [neu, portalUserID]
    )
  }
}

async function baueLogin(u: PortalUserRow): Promise<LoginErgebnis> {
  const token = await createPortalToken(u.portalUserID, u.personID, u.token_gen)
  return {
    token,
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    user: {
      portalUserID: u.portalUserID,
      personID: u.personID,
      vorname: u.vorname,
      nachname: u.nachname,
      email: u.email,
      superuser: u.is_superuser === 1
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Einmal-Links (Einladung und "Passwort vergessen")                           */
/* -------------------------------------------------------------------------- */

/**
 * Erzeugt einen Einmal-Link und verschickt ihn.
 *
 * Alle noch offenen Tokens desselben Kontos werden dabei entwertet: sonst
 * sammeln sich bei mehrfachem Anfordern gueltige Links an, von denen jeder
 * einzelne das Konto uebernehmen kann.
 */
export async function erzeugeLink(
  portalUserID: number,
  zweck: 'invite' | 'reset',
  ip: string,
  empfaenger: { email: string; vorname: string }
): Promise<void> {
  const { token, hash } = createLinkToken()
  const stunden = zweck === 'invite' ? TTL_INVITE_STUNDEN : TTL_RESET_STUNDEN

  await withConnection(async (conn) => {
    await conn.query(
      'UPDATE portalToken SET benutzt_am = NOW() WHERE portalUserID = ? AND benutzt_am IS NULL',
      [portalUserID]
    )
    await conn.query(
      `INSERT INTO portalToken (portalUserID, token_hash, zweck, gueltig_bis, ip)
       VALUES (?, ?, ?, NOW() + INTERVAL ? HOUR, ?)`,
      [portalUserID, hash, zweck, stunden, ip]
    )
    // Aufraeumen ohne Cronjob: alte, laengst abgelaufene Zeilen fliegen raus,
    // wenn ohnehin geschrieben wird.
    await conn.query(
      'DELETE FROM portalToken WHERE gueltig_bis < NOW() - INTERVAL 30 DAY'
    )
  })

  if (zweck === 'invite') {
    await sendeEinladung(
      empfaenger.email,
      empfaenger.vorname,
      token,
      Math.round(stunden / 24)
    )
  } else {
    await sendeReset(empfaenger.email, empfaenger.vorname, token, stunden)
  }
}

/**
 * "Passwort vergessen".
 *
 * Antwortet dem Aufrufer nie, ob es das Konto gibt -- der Endpunkt waere sonst
 * eine bequeme Moeglichkeit herauszufinden, wer im EC-Nordbund einen Zugang
 * hat. Deshalb gibt diese Funktion auch bei unbekannter Adresse nichts zurueck.
 */
export async function passwortVergessen(
  emailRoh: unknown,
  ip: string
): Promise<void> {
  const email = normalisiereEmail(emailRoh)
  if (!email) return

  const rows = await queryP<{
    portalUserID: number
    email: string
    vorname: string
  }>(
    `SELECT pu.portalUserID, pu.email, p.vorname
       FROM portalUser pu
       JOIN personen p ON p.personID = pu.personID
      WHERE pu.email = ? AND pu.aktiv = 1 AND p.anonymisiert = 0`,
    [email]
  )
  if (rows.length !== 1) return

  await erzeugeLink(rows[0].portalUserID, 'reset', ip, {
    email: rows[0].email,
    vorname: rows[0].vorname
  })
}

export interface TokenInfo {
  valid: true
  zweck: 'invite' | 'reset'
  vorname: string
  email: string
}

/**
 * Prueft einen Link-Token, ohne ihn zu verbrauchen -- damit die Seite "Hallo
 * Max" anzeigen und einen abgelaufenen Link melden kann, bevor jemand ein
 * Passwort tippt.
 */
export async function pruefeLinkToken(token: unknown): Promise<TokenInfo> {
  if (typeof token !== 'string' || !token) throw tokenUngueltig()

  const rows = await queryP<{
    zweck: 'invite' | 'reset'
    vorname: string
    email: string
  }>(
    `SELECT t.zweck, p.vorname, pu.email
       FROM portalToken t
       JOIN portalUser pu ON pu.portalUserID = t.portalUserID
       JOIN personen p ON p.personID = pu.personID
      WHERE t.token_hash = ? AND t.benutzt_am IS NULL AND t.gueltig_bis > NOW()
        AND pu.aktiv = 1`,
    [hashLinkToken(token)]
  )
  if (rows.length !== 1) throw tokenUngueltig()

  return {
    valid: true,
    zweck: rows[0].zweck,
    vorname: rows[0].vorname,
    // Maskiert: die Seite soll bestaetigen koennen, an welche Adresse der Link
    // ging, ohne sie einem zufaelligen Linkfinder komplett zu verraten.
    email: maskiereEmail(rows[0].email)
  }
}

function tokenUngueltig(): PortalFehler {
  return new PortalFehler(
    'TOKEN_INVALID',
    'Dieser Link ist abgelaufen oder wurde bereits benutzt. Bitte fordere einen neuen an.',
    410
  )
}

/**
 * Loest einen Link-Token ein und setzt das Passwort.
 *
 * Der Token wird per UPDATE mit Bedingung entwertet und nicht erst gelesen und
 * dann geschrieben: zwei parallele Requests mit demselben Link wuerden sonst
 * beide durchkommen. `affectedRows === 0` heisst abgelaufen, unbekannt oder
 * schon benutzt -- alle drei Faelle bekommen dieselbe Antwort.
 */
export async function setzePasswort(
  tokenRoh: unknown,
  passwort: unknown,
  ip: string
): Promise<LoginErgebnis> {
  if (typeof tokenRoh !== 'string' || !tokenRoh) throw tokenUngueltig()
  const tokenHash = hashLinkToken(tokenRoh)

  const treffer = await queryP<{
    portalUserID: number
    email: string
    vorname: string
    nachname: string
  }>(
    `SELECT pu.portalUserID, pu.email, p.vorname, p.nachname
       FROM portalToken t
       JOIN portalUser pu ON pu.portalUserID = t.portalUserID
       JOIN personen p ON p.personID = pu.personID
      WHERE t.token_hash = ? AND t.benutzt_am IS NULL AND t.gueltig_bis > NOW()
        AND pu.aktiv = 1 AND p.anonymisiert = 0`,
    [tokenHash]
  )
  if (treffer.length !== 1) throw tokenUngueltig()
  const ziel = treffer[0]

  // Policy erst jetzt pruefen: so kann sie den Namen des Kontos einbeziehen.
  pruefePasswort(typeof passwort === 'string' ? passwort : '', {
    email: ziel.email,
    vorname: ziel.vorname,
    nachname: ziel.nachname
  })

  const hash = await hashPassword(passwort as string)

  const ok = await withConnection(async (conn) => {
    const res: any = await conn.query(
      `UPDATE portalToken SET benutzt_am = NOW()
        WHERE token_hash = ? AND benutzt_am IS NULL AND gueltig_bis > NOW()`,
      [tokenHash]
    )
    if (!res || res.affectedRows !== 1) return false

    await conn.query(
      `UPDATE portalUser
          SET password_hash = ?, pw_changed_at = NOW(),
              token_gen = token_gen + 1,
              failed_logins = 0, locked_until = NULL
        WHERE portalUserID = ?`,
      [hash, ziel.portalUserID]
    )
    // Alle uebrigen offenen Links desselben Kontos entwerten.
    await conn.query(
      `UPDATE portalToken SET benutzt_am = NOW()
        WHERE portalUserID = ? AND benutzt_am IS NULL`,
      [ziel.portalUserID]
    )
    return true
  })

  if (!ok) throw tokenUngueltig()

  const rows = await queryP<PortalUserRow>(
    `SELECT pu.*, p.vorname, p.nachname, 0 AS gesperrt
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ?`,
    [ziel.portalUserID]
  )
  void ip
  return baueLogin(rows[0])
}

/**
 * Passwortwechsel im eingeloggten Zustand. Setzt `pw_changed_at` und beendet
 * damit alle anderen Sitzungen (siehe scope.requirePortal).
 */
export async function aenderePasswort(
  portalUserID: number,
  altRoh: unknown,
  neuRoh: unknown
): Promise<LoginErgebnis> {
  const rows = await queryP<PortalUserRow>(
    `SELECT pu.*, p.vorname, p.nachname, 0 AS gesperrt
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ?`,
    [portalUserID]
  )
  if (rows.length !== 1) throw unauthorized()
  const u = rows[0]

  if (
    !(await verifyPassword(
      typeof altRoh === 'string' ? altRoh : '',
      u.password_hash
    ))
  ) {
    throw badRequest('WRONG_PASSWORD', 'Das bisherige Passwort stimmt nicht.')
  }

  pruefePasswort(typeof neuRoh === 'string' ? neuRoh : '', {
    email: u.email,
    vorname: u.vorname,
    nachname: u.nachname
  })

  const hash = await hashPassword(neuRoh as string)
  await queryP(
    `UPDATE portalUser
        SET password_hash = ?, pw_changed_at = NOW(), token_gen = token_gen + 1
      WHERE portalUserID = ?`,
    [hash, portalUserID]
  )

  // Der Wechsel entwertet ALLE Sitzungen, auch die eigene. Damit der gerade
  // Handelnde nicht mitten im Vorgang rausfliegt, bekommt er direkt einen
  // frischen Token -- andere Geraete muessen sich neu anmelden.
  const neu = await queryP<PortalUserRow>(
    `SELECT pu.*, p.vorname, p.nachname, 0 AS gesperrt
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ?`,
    [portalUserID]
  )
  return baueLogin(neu[0])
}

/* -------------------------------------------------------------------------- */
/* Verwaltung der Konten (aus EC-Verwaltung heraus)                            */
/* -------------------------------------------------------------------------- */

export interface AccountUebersicht {
  portalUserID: number
  personID: number
  vorname: string
  nachname: string
  gebDat: string | null
  email: string
  superuser: boolean
  aktiv: boolean
  passwortGesetzt: boolean
  offeneEinladung: boolean
  lastLogin: string | null
  gesperrt: boolean
}

export async function listeAccounts(): Promise<AccountUebersicht[]> {
  const rows = await queryP<any>(
    `SELECT pu.portalUserID, pu.personID, pu.email, pu.is_superuser, pu.aktiv,
            pu.password_hash IS NOT NULL AS hatPasswort, pu.last_login,
            (pu.locked_until IS NOT NULL AND pu.locked_until > NOW()) AS gesperrt,
            p.vorname, p.nachname, p.gebDat,
            EXISTS (SELECT 1 FROM portalToken t
                     WHERE t.portalUserID = pu.portalUserID
                       AND t.benutzt_am IS NULL AND t.gueltig_bis > NOW()) AS offen
       FROM portalUser pu
       JOIN personen p ON p.personID = pu.personID
      ORDER BY p.nachname, p.vorname`
  )
  return rows.map((r) => ({
    portalUserID: r.portalUserID,
    personID: r.personID,
    vorname: r.vorname,
    nachname: r.nachname,
    gebDat: r.gebDat ? isoTag(r.gebDat) : null,
    email: r.email,
    superuser: r.is_superuser === 1,
    aktiv: r.aktiv === 1,
    passwortGesetzt: Number(r.hatPasswort) === 1,
    offeneEinladung: Number(r.offen) === 1,
    lastLogin: r.last_login ? r.last_login.toISOString() : null,
    gesperrt: Number(r.gesperrt) === 1
  }))
}

export async function legeAccountAn(
  personID: unknown,
  emailRoh: unknown,
  superuser: boolean,
  erstelltVon: number,
  ip: string
): Promise<number> {
  const pid = ganzzahl(personID)
  const email = normalisiereEmail(emailRoh)
  if (!pid)
    throw badRequest('INVALID_INPUT', 'personID fehlt oder ist ungültig.')
  if (!email) throw badRequest('INVALID_INPUT', 'Keine gültige E-Mail-Adresse.')

  const person = await queryP<{ vorname: string; nachname: string }>(
    'SELECT vorname, nachname FROM personen WHERE personID = ? AND anonymisiert = 0',
    [pid]
  )
  if (person.length !== 1) throw notFound('Person nicht gefunden.')

  const konflikt = await queryP<{ personID: number; email: string }>(
    'SELECT personID, email FROM portalUser WHERE personID = ? OR email = ?',
    [pid, email]
  )
  if (konflikt.length > 0) {
    throw new PortalFehler(
      konflikt[0].personID === pid ? 'PERSON_HAS_ACCOUNT' : 'EMAIL_TAKEN',
      konflikt[0].personID === pid
        ? 'Diese Person hat bereits einen Portal-Zugang.'
        : 'Diese E-Mail-Adresse wird bereits verwendet.',
      409
    )
  }

  const res: any = await queryP(
    `INSERT INTO portalUser (personID, email, is_superuser, erstellt_von)
     VALUES (?, ?, ?, ?)`,
    [pid, email, superuser ? 1 : 0, erstelltVon]
  )
  const portalUserID = res.insertId

  await erzeugeLink(portalUserID, 'invite', ip, {
    email,
    vorname: person[0].vorname
  })

  return portalUserID
}

export async function ladeAccount(portalUserID: number) {
  const rows = await queryP<{
    portalUserID: number
    email: string
    aktiv: number
    vorname: string
  }>(
    `SELECT pu.portalUserID, pu.email, pu.aktiv, p.vorname
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ?`,
    [portalUserID]
  )
  if (rows.length !== 1) throw notFound('Portal-Zugang nicht gefunden.')
  return rows[0]
}

export async function aendereAccount(
  portalUserID: number,
  patch: {
    email?: unknown
    superuser?: unknown
    aktiv?: unknown
    notiz?: unknown
  }
): Promise<void> {
  await ladeAccount(portalUserID)

  const sets: string[] = []
  const params: unknown[] = []

  if (patch.email !== undefined) {
    const email = normalisiereEmail(patch.email)
    if (!email)
      throw badRequest('INVALID_INPUT', 'Keine gültige E-Mail-Adresse.')
    const belegt = await queryP(
      'SELECT 1 FROM portalUser WHERE email = ? AND portalUserID <> ?',
      [email, portalUserID]
    )
    if (belegt.length > 0) {
      throw new PortalFehler(
        'EMAIL_TAKEN',
        'Diese E-Mail-Adresse wird bereits verwendet.',
        409
      )
    }
    sets.push('email = ?')
    params.push(email)
  }
  if (patch.superuser !== undefined) {
    sets.push('is_superuser = ?')
    params.push(patch.superuser ? 1 : 0)
  }
  if (patch.aktiv !== undefined) {
    sets.push('aktiv = ?')
    params.push(patch.aktiv ? 1 : 0)
  }
  if (patch.notiz !== undefined) {
    sets.push('notiz = ?')
    params.push(String(patch.notiz ?? '').slice(0, 500))
  }
  if (sets.length === 0) return

  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE portalUser SET ${sets.join(', ')} WHERE portalUserID = ?`,
      [...params, portalUserID]
    )
    // Mailwechsel oder Deaktivierung entwerten offene Links: sonst kaeme
    // jemand ueber einen alten Einladungslink noch an das Konto.
    if (patch.email !== undefined || patch.aktiv !== undefined) {
      await conn.query(
        'UPDATE portalToken SET benutzt_am = NOW() WHERE portalUserID = ? AND benutzt_am IS NULL',
        [portalUserID]
      )
    }
  })
}

/**
 * Zugang entziehen. Bewusst ein Soft-Delete: `gesehenVon` in `fz` verweist auf
 * die Person, und die Audit-Spur soll nachvollziehbar bleiben.
 */
export async function deaktiviereAccount(portalUserID: number): Promise<void> {
  await ladeAccount(portalUserID)
  await withConnection(async (conn) => {
    await conn.query('UPDATE portalUser SET aktiv = 0 WHERE portalUserID = ?', [
      portalUserID
    ])
    await conn.query(
      'UPDATE portalToken SET benutzt_am = NOW() WHERE portalUserID = ? AND benutzt_am IS NULL',
      [portalUserID]
    )
  })
}

/* -------------------------------------------------------------------------- */
/* Kleinkram                                                                   */
/* -------------------------------------------------------------------------- */

function normalisiereEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length < 5 || e.length > 255) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

function maskiereEmail(email: string): string {
  const [lokal, domain] = email.split('@')
  if (!domain) return '***'
  const sichtbar = lokal.slice(0, 1)
  return `${sichtbar}${'*'.repeat(Math.max(2, lokal.length - 1))}@${domain}`
}

export function ganzzahl(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

function isoTag(d: Date): string {
  const gb = (v: number) => (v < 10 ? '0' + v : String(v))
  return `${d.getFullYear()}-${gb(d.getMonth() + 1)}-${gb(d.getDate())}`
}
