import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto'
import { Request } from 'express'
import { queryP, withConnection } from '../helpers/mysql'
import {
  PortalFehler,
  badRequest,
  forbidden,
  unauthorized
} from '../portal/error'
import { createLinkToken } from '../portal/password'
import { FUSS, esc, sendePortalMail } from '../portal/mail'
import { tokenAusHeader } from '../portal/token'
import {
  CODE_GUELTIG_MINUTEN,
  CODE_MAX_OFFEN,
  CODE_MAX_PRO_STUNDE,
  CODE_MAX_PRO_STUNDE_JE_IP,
  CODE_STELLEN,
  FEHLVERSUCHE_FENSTER_STUNDEN,
  FEHLVERSUCHE_GESAMT,
  FEHLVERSUCHE_JE_IP,
  UEBERGABE_GUELTIG_MINUTEN,
  requireSchutzkonzeptAktiv,
  schutzkonzeptBaseUrl
} from './config'
import { erzeugeSkToken, pruefeSkToken } from './token'

export interface SkKreis {
  ecKreisID: number
  bezeichnung: string
}

/** Wer gerade im Ausfuell-System arbeitet. */
export interface SkScope {
  typ: 'email' | 'portal'
  /** Fuer geaendert_von und Audit: E-Mail oder `portal:<portalUserID>`. */
  akteur: string
  /** Anzeigename: E-Mail oder "Vorname Nachname (Schutzkonzept-Verwaltung)". */
  name: string
  kreise: SkKreis[]
}

export function normalisiereEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length < 5 || e.length > 255) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

/**
 * Hash eines Login-Codes.
 *
 * HMAC mit dem Secret statt eines nackten sha256: sechs Ziffern sind nur eine
 * Million Moeglichkeiten -- aus einem DB-Backup liesse sich ein gueltiger Code
 * sonst in Millisekunden zurueckrechnen. Die E-Mail steht mit drin, damit
 * derselbe Code bei zwei Adressen nicht denselben Hash ergibt.
 */
function codeHash(email: string, code: string): string {
  return createHmac('sha256', process.env.SCHUTZKONZEPT_JWT_SECRET || '')
    .update(`${email}|${code}`)
    .digest('hex')
}

/**
 * Alle E-Mail-Vergleiche in diesem Modul sind binaer (`COLLATE utf8mb4_bin`,
 * auf der Spaltenseite -- auf dem Parameter ginge es nicht, die Verbindung
 * spricht utf8mb3). Die Standard-Collation utf8mb4_general_ci haelt 'a' und
 * 'ä' fuer gleich: Wer die IDN-Domain ec-nördbund.de besitzt, bekaeme sonst
 * mit jugend@ec-nördbund.de den Login-Code der hinterlegten Adresse
 * jugend@ec-nordbund.de -- der Vergleich traefe, die Mail ginge an die
 * Variante. Das Schema stellt die Spalten ausserdem auf utf8mb4_bin um; die
 * Klausel hier haelt den Fehler auch bei nicht migriertem Schema zu.
 */
export async function kreiseZuEmail(email: string): Promise<SkKreis[]> {
  return queryP<SkKreis>(
    `SELECT ec.ecKreisID, ec.bezeichnung
       FROM skKreisEmail ke
       JOIN ecKreis ec ON ec.ecKreisID = ke.ecKreisID
      WHERE ke.email COLLATE utf8mb4_bin = ?
      ORDER BY ec.bezeichnung`,
    [email]
  )
}

/**
 * Audit ohne Request-Objekt (laeuft nach der Antwort bzw. ohne Route).
 * Wirft nie, wie skAudit.
 */
async function auditOhneRequest(
  akteur: string,
  aktion: string,
  ip: string
): Promise<void> {
  try {
    await queryP(
      'INSERT INTO skAudit (akteur, aktion, ziel, ip) VALUES (?,?,?,?)',
      [akteur.slice(0, 255), aktion, '', ip.slice(0, 45)]
    )
  } catch (err) {
    console.error('[schutzkonzept] Audit fehlgeschlagen:', aktion, err)
  }
}

/**
 * Login-Code anfordern.
 *
 * Die Route antwortet dem Aufrufer immer gleich (202) und ruft diese Funktion
 * erst NACH der Antwort auf -- sonst liesse sich an Antwort oder Antwortzeit
 * ablesen, welche Adressen hinterlegt sind (fuer bekannte Adressen folgen
 * Zaehlen, Transaktion und Mailversand, fuer unbekannte nichts).
 *
 * Limits und warum aeltere Codes gueltig bleiben: siehe config.ts.
 */
export async function fordereCodeAn(
  emailRoh: unknown,
  ip: string
): Promise<void> {
  const email = normalisiereEmail(emailRoh)
  if (!email) {
    throw badRequest(
      'INVALID_INPUT',
      'Bitte eine gültige E-Mail-Adresse angeben.'
    )
  }

  const kreise = await kreiseZuEmail(email)
  if (kreise.length === 0) return

  const [{ gesamt, vonIp }] = await queryP<{ gesamt: number; vonIp: number }>(
    `SELECT COUNT(*) AS gesamt, COALESCE(SUM(ip = ?), 0) AS vonIp
       FROM skLoginCode
      WHERE zweck = 'login' AND email COLLATE utf8mb4_bin = ?
        AND erstellt > NOW() - INTERVAL 1 HOUR`,
    [ip, email]
  )
  if (
    Number(gesamt) >= CODE_MAX_PRO_STUNDE ||
    Number(vonIp) >= CODE_MAX_PRO_STUNDE_JE_IP
  ) {
    // Sichtbar fuer die Verwaltung, falls jemand die Adresse zuschuettet.
    await auditOhneRequest(email, 'code.limit', ip)
    return
  }

  const code = String(randomInt(0, 10 ** CODE_STELLEN)).padStart(
    CODE_STELLEN,
    '0'
  )

  await withConnection(async (conn) => {
    // Aeltere offene Codes bleiben gueltig (geteilte Adresse, verzoegerte
    // Mail) -- beim Einloesen zaehlen nur die neuesten CODE_MAX_OFFEN.
    await conn.query(
      'DELETE FROM skLoginCode WHERE gueltig_bis < NOW() - INTERVAL 30 DAY'
    )
    await conn.query(
      `DELETE FROM skLoginFehlversuch
        WHERE ts < NOW() - INTERVAL ? HOUR`,
      [FEHLVERSUCHE_FENSTER_STUNDEN * 2]
    )
    await conn.query(
      `INSERT INTO skLoginCode (zweck, email, code_hash, gueltig_bis, ip)
       VALUES ('login', ?, ?, NOW() + INTERVAL ? MINUTE, ?)`,
      [email, codeHash(email, code), CODE_GUELTIG_MINUTEN, ip]
    )
  })

  const link = `${schutzkonzeptBaseUrl()}/#/login?email=${encodeURIComponent(email)}&code=${code}`
  // Der Code steht bewusst NICHT im Betreff: sendePortalMail protokolliert
  // nach gesendeteEmails, und dort soll kein gueltiger Code lesbar sein.
  sendePortalMail(
    email,
    'Dein Anmeldecode für das Schutzkonzept',
    `<p>Hallo,</p>
<p>du hast einen Anmeldecode für das <strong>Schutzkonzept</strong>
(${kreise.map((k) => esc(k.bezeichnung)).join(', ')}) angefordert.</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p>
<p>Oder direkt anmelden: <a href="${link}">${esc(link)}</a></p>
<p>Der Code ist ${CODE_GUELTIG_MINUTEN} Minuten gültig und funktioniert genau einmal.</p>
${FUSS}`,
    code
  ).catch((err) =>
    console.error('[schutzkonzept] Code-Mail fehlgeschlagen:', err)
  )
}

/**
 * Code einloesen -> Sitzungs-Token.
 *
 * Fehlversuche zaehlen je Adresse ueber alle Codes (skLoginFehlversuch),
 * auch fuer unbekannte Adressen -- sonst verriete die Sperre, welche
 * Adressen hinterlegt sind.
 */
export async function loginMitCode(
  emailRoh: unknown,
  codeRoh: unknown,
  ip: string
): Promise<{ token: string; email: string }> {
  const email = normalisiereEmail(emailRoh)
  const code = typeof codeRoh === 'string' ? codeRoh.replace(/\s/g, '') : ''
  const ungueltig = () =>
    new PortalFehler(
      'CODE_INVALID',
      'Der Code ist falsch oder abgelaufen.',
      400
    )

  if (!email || !new RegExp(`^\\d{${CODE_STELLEN}}$`).test(code))
    throw ungueltig()

  const [{ gesamt, vonIp }] = await queryP<{ gesamt: number; vonIp: number }>(
    `SELECT COUNT(*) AS gesamt, COALESCE(SUM(ip = ?), 0) AS vonIp
       FROM skLoginFehlversuch
      WHERE email COLLATE utf8mb4_bin = ? AND ts > NOW() - INTERVAL ? HOUR`,
    [ip, email, FEHLVERSUCHE_FENSTER_STUNDEN]
  )
  if (
    Number(gesamt) >= FEHLVERSUCHE_GESAMT ||
    Number(vonIp) >= FEHLVERSUCHE_JE_IP
  ) {
    await auditOhneRequest(email, 'login.gesperrt', ip)
    throw new PortalFehler(
      'LOCKED',
      'Zu viele falsche Codes für diese Adresse. Bitte später erneut versuchen.',
      429
    )
  }

  const rows = await queryP<{ codeID: number; code_hash: string }>(
    `SELECT codeID, code_hash FROM skLoginCode
      WHERE zweck = 'login' AND email COLLATE utf8mb4_bin = ? AND benutzt_am IS NULL
        AND gueltig_bis > NOW()
      ORDER BY codeID DESC LIMIT ?`,
    [email, CODE_MAX_OFFEN]
  )

  // Alle Kandidaten vergleichen, nicht beim ersten Treffer abbrechen.
  const ist = Buffer.from(codeHash(email, code), 'hex')
  let treffer: number | null = null
  for (const r of rows) {
    const erwartet = Buffer.from(r.code_hash, 'hex')
    // Laengenvergleich vorab: timingSafeEqual wirft bei ungleicher Laenge,
    // und ein krummer Wert in der Spalte soll keinen 500er ergeben.
    if (erwartet.length === ist.length && timingSafeEqual(erwartet, ist)) {
      treffer = r.codeID
    }
  }

  if (treffer === null) {
    await queryP('INSERT INTO skLoginFehlversuch (email, ip) VALUES (?, ?)', [
      email,
      ip
    ])
    // Fehlversuche unbekannter Adressen kommen an keinem anderen Aufraeumen
    // vorbei (fordereCodeAn laeuft nur fuer hinterlegte Adressen).
    if (Math.random() < 0.01) {
      await queryP(
        'DELETE FROM skLoginFehlversuch WHERE ts < NOW() - INTERVAL ? HOUR',
        [FEHLVERSUCHE_FENSTER_STUNDEN * 2]
      )
    }
    if (rows.length > 0) {
      // Nur noch Statistik; begrenzt wird ueber skLoginFehlversuch.
      await queryP(
        'UPDATE skLoginCode SET versuche = versuche + 1 WHERE codeID IN (?)',
        [rows.map((r) => r.codeID)]
      )
    }
    throw ungueltig()
  }

  // Atomar verbrauchen: zwei parallele Requests mit demselben Code -- nur
  // einer bekommt affectedRows = 1.
  const r: any = await queryP(
    `UPDATE skLoginCode SET benutzt_am = NOW()
      WHERE codeID = ? AND benutzt_am IS NULL AND gueltig_bis > NOW()`,
    [treffer]
  )
  if (!r || r.affectedRows !== 1) throw ungueltig()

  if ((await kreiseZuEmail(email)).length === 0) throw ungueltig()

  return { token: await erzeugeSkToken({ typ: 'email', e: email }), email }
}

/* ------------------------------------------------------------ Uebergabe -- */

/** Portal: Einmal-Link erzeugen, mit dem ein Verwalter in einen Kreis wechselt. */
export async function erzeugeUebergabe(
  portalUserID: number,
  ecKreisID: number,
  ip: string
): Promise<{ url: string }> {
  const v = await ladeVerwalter(portalUserID)
  if (!v) throw forbidden()
  const { token, hash } = createLinkToken()
  // token_gen mitspeichern: ein Passwort-Reset oder "alle Sitzungen beenden"
  // soll auch noch nicht eingeloeste Links entwerten, nicht nur Tokens.
  await queryP(
    `INSERT INTO skLoginCode (zweck, portalUserID, ecKreisID, token_gen, code_hash, gueltig_bis, ip)
     VALUES ('uebergabe', ?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, ?)`,
    [portalUserID, ecKreisID, v.token_gen, hash, UEBERGABE_GUELTIG_MINUTEN, ip]
  )
  return { url: `${schutzkonzeptBaseUrl()}/#/uebergabe?token=${token}` }
}

interface VerwalterRow {
  portalUserID: number
  token_gen: number
  vorname: string
  nachname: string
}

async function ladeVerwalter(
  portalUserID: number
): Promise<VerwalterRow | null> {
  const rows = await queryP<VerwalterRow>(
    `SELECT pu.portalUserID, pu.token_gen, p.vorname, p.nachname
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ? AND pu.aktiv = 1 AND p.anonymisiert = 0
        AND (pu.is_schutzkonzept_verwalter = 1 OR pu.is_superuser = 1)`,
    [portalUserID]
  )
  return rows[0] ?? null
}

export async function loginMitUebergabe(
  tokenRoh: unknown
): Promise<{ token: string }> {
  const ungueltig = () =>
    new PortalFehler(
      'TOKEN_INVALID',
      'Der Link ist abgelaufen oder wurde schon benutzt.',
      410
    )
  if (
    typeof tokenRoh !== 'string' ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(tokenRoh)
  ) {
    throw ungueltig()
  }
  const hash = createHash('sha256').update(tokenRoh).digest('hex')

  return withConnection(async (conn) => {
    const rows: {
      codeID: number
      portalUserID: number
      ecKreisID: number
      token_gen: number | null
    }[] = await conn.query(
      `SELECT codeID, portalUserID, ecKreisID, token_gen FROM skLoginCode
          WHERE zweck = 'uebergabe' AND code_hash = ? AND benutzt_am IS NULL
            AND gueltig_bis > NOW()
          FOR UPDATE`,
      [hash]
    )
    if (rows.length !== 1) throw ungueltig()
    await conn.query(
      'UPDATE skLoginCode SET benutzt_am = NOW() WHERE codeID = ?',
      [rows[0].codeID]
    )
    const v = await ladeVerwalter(rows[0].portalUserID)
    if (!v || v.token_gen !== rows[0].token_gen) throw ungueltig()
    return {
      token: await erzeugeSkToken({
        typ: 'portal',
        pu: v.portalUserID,
        g: v.token_gen,
        k: rows[0].ecKreisID
      })
    }
  })
}

/* ---------------------------------------------------------------- Scope -- */

export async function requireSk(req: Request): Promise<SkScope> {
  await requireSchutzkonzeptAktiv()
  const token = tokenAusHeader(req.headers.authorization)

  let payload
  try {
    payload = await pruefeSkToken(token)
  } catch {
    throw unauthorized('Anmeldung abgelaufen oder ungültig.')
  }

  if (payload.typ === 'email') {
    const kreise = await kreiseZuEmail(payload.e)
    if (kreise.length === 0) throw unauthorized('Zugang nicht mehr gültig.')
    return { typ: 'email', akteur: payload.e, name: payload.e, kreise }
  }

  if (payload.typ === 'portal') {
    const v = await ladeVerwalter(payload.pu)
    if (!v || v.token_gen !== payload.g) {
      throw unauthorized('Zugang nicht mehr gültig.')
    }
    const kreise = await queryP<SkKreis>(
      'SELECT ecKreisID, bezeichnung FROM ecKreis WHERE ecKreisID = ?',
      [payload.k]
    )
    return {
      typ: 'portal',
      akteur: `portal:${v.portalUserID}`,
      name: `${v.vorname} ${v.nachname} (Schutzkonzept-Verwaltung)`,
      kreise
    }
  }

  throw unauthorized()
}

export function assertSkKreis(scope: SkScope, ecKreisID: number): SkKreis {
  const k = scope.kreise.find((x) => x.ecKreisID === ecKreisID)
  if (!k) throw forbidden('Für diesen EC-Kreis bist du nicht freigeschaltet.')
  return k
}
