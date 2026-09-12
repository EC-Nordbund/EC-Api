import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { badRequest } from './error'

/**
 * Passwort-Hashing und Einmal-Links des Portals.
 *
 * scrypt statt des sha3_512(salt + pwd) der Verwaltung (src/users/users.ts):
 * SHA3 ist ein schneller Hash, eine GPU rechnet davon Milliarden pro Sekunde --
 * ein geleakter Dump waere bei realen Passwoertern in Stunden offen. scrypt ist
 * speicherhart (N=16384, r=8 entspricht ~16 MB pro Versuch) und bremst
 * Offline-Angriffe um Groessenordnungen. Es steckt in Node selbst, kostet also
 * weder eine neue Abhaengigkeit noch ein natives Modul (argon2 und bcrypt waeren
 * beides -- Rollup/esbuild bundelt hier).
 */
const N = 16384
const R = 8
const P = 1
const DK_LEN = 64
const SALT_LEN = 16

/** Mindestlaenge nach NIST 800-63B: Laenge statt Zeichenklassen-Zwang. */
const MIN_LAENGE = 12
/** Obergrenze, damit ein 1-MB-Passwort den Server nicht mit scrypt beschaeftigt. */
const MAX_LAENGE = 200

function scryptAsync(pwd: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => {
    // Bewusst die asynchrone Variante: scryptSync wuerde den Event-Loop bei
    // diesen Parametern 50-100 ms blockieren und damit alle parallelen
    // Requests der API ausbremsen. Async laeuft im libuv-Threadpool.
    scrypt(pwd.normalize('NFKC'), salt, DK_LEN, { N, r: R, p: P }, (err, dk) =>
      err ? rej(err) : res(dk)
    )
  })
}

/**
 * Erzeugt einen selbstbeschreibenden Hash-String:
 *   scrypt$N=16384,r=8,p=1$<salt-b64>$<hash-b64>
 * Die Parameter stehen mit drin, damit sie sich spaeter erhoehen lassen, ohne
 * die Bestandshashes zu migrieren (beim naechsten Login neu hashen).
 */
export async function hashPassword(pwd: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const dk = await scryptAsync(pwd, salt)
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString(
    'base64'
  )}$${dk.toString('base64')}`
}

/**
 * Prueft ein Passwort gegen einen gespeicherten Hash. Gibt immer einen
 * booleschen Wert zurueck, wirft nie -- ein kaputter Hash-String in der DB darf
 * keinen 500er ausloesen, sondern schlicht nicht passen.
 */
export async function verifyPassword(
  pwd: string,
  gespeichert: string | null
): Promise<boolean> {
  if (!gespeichert) return false
  const teile = gespeichert.split('$')
  if (teile.length !== 4 || teile[0] !== 'scrypt') return false

  const params = Object.fromEntries(
    teile[1].split(',').map((kv) => {
      const [k, v] = kv.split('=')
      return [k, parseInt(v, 10)]
    })
  )
  if (!params.N || !params.r || !params.p) return false

  const salt = Buffer.from(teile[2], 'base64')
  const erwartet = Buffer.from(teile[3], 'base64')

  const dk = await new Promise<Buffer | null>((res) =>
    scrypt(
      pwd.normalize('NFKC'),
      salt,
      erwartet.length,
      { N: params.N, r: params.r, p: params.p },
      (err, out) => res(err ? null : out)
    )
  )
  if (!dk || dk.length !== erwartet.length) return false
  return timingSafeEqual(dk, erwartet)
}

/**
 * Hash mit veralteten Parametern? Dann beim naechsten erfolgreichen Login
 * stillschweigend neu schreiben.
 */
export function needsRehash(gespeichert: string | null): boolean {
  if (!gespeichert) return false
  return !gespeichert.startsWith(`scrypt$N=${N},r=${R},p=${P}$`)
}

/**
 * Konstanter Vergleichsaufwand fuer unbekannte Konten.
 *
 * Ohne das verraet die Antwortzeit des Logins, ob es eine Mailadresse gibt:
 * bekanntes Konto = 80 ms scrypt, unbekanntes = sofort 401. Der Dummy-Hash
 * sorgt dafuer, dass beide Faelle gleich lange brauchen.
 */
const DUMMY_HASH = `scrypt$N=${N},r=${R},p=${P}$${randomBytes(
  SALT_LEN
).toString('base64')}$${randomBytes(DK_LEN).toString('base64')}`

export async function verzoegereWieVerify(pwd: string): Promise<void> {
  await verifyPassword(pwd, DUMMY_HASH)
}

/**
 * Passwort-Policy. Bewusst ohne Zeichenklassen-Zwang (NIST 800-63B): der treibt
 * Leute zu "Passwort1!" statt zu laengeren Passphrasen. Stattdessen Mindest-
 * laenge plus eine kleine Sperrliste gegen das Naheliegende.
 */
export function pruefePasswort(
  pwd: string,
  kontext: { email?: string; vorname?: string; nachname?: string } = {}
): void {
  if (typeof pwd !== 'string' || pwd.length < MIN_LAENGE) {
    throw badRequest(
      'WEAK_PASSWORD',
      `Das Passwort muss mindestens ${MIN_LAENGE} Zeichen lang sein.`
    )
  }
  if (pwd.length > MAX_LAENGE) {
    throw badRequest(
      'WEAK_PASSWORD',
      `Das Passwort darf höchstens ${MAX_LAENGE} Zeichen lang sein.`
    )
  }

  const klein = pwd.toLowerCase()
  const verboten = [
    'passwort',
    'password',
    'ec-nordbund',
    'ecnordbund',
    'fuehrungszeugnis',
    'portal',
    kontext.email?.split('@')[0],
    kontext.vorname,
    kontext.nachname
  ]
    .filter((v): v is string => !!v && v.length >= 4)
    .map((v) => v.toLowerCase())

  if (verboten.some((v) => klein.includes(v))) {
    throw badRequest(
      'WEAK_PASSWORD',
      'Das Passwort darf deinen Namen, deine Mailadresse oder offensichtliche Wörter nicht enthalten.'
    )
  }
}

/**
 * Einmal-Link fuer Einladung und Passwort-Reset.
 *
 * Der Klartext geht nur in die Mail, in der DB liegt ausschliesslich der
 * sha256-Hash -- ein Datenbank-Backup enthaelt damit keine benutzbaren Links.
 * sha256 genuegt hier (im Gegensatz zum Passwort): 32 Zufallsbytes sind nicht
 * erratbar, es braucht kein Key-Stretching.
 */
export function createLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashLinkToken(token) }
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
