import { sign, verify } from 'jsonwebtoken'
import { TOKEN_LAUFZEIT } from './config'
import { unauthorized } from './error'

/**
 * JWT des Portals -- strikt getrennt vom Verwaltungs-Token.
 *
 * Warum ein eigenes Secret: `checkAuth` (src/auth.ts) prueft ausschliesslich
 * die Signatur und kennt keine Rechte. Jeder mit JWT_SECRET signierte Token
 * darf damit jede GraphQL-Mutation, inklusive mergePersons und abmelden. Mit
 * gemeinsamem Secret waere ein Portal-Login fuer Ehrenamtliche gleichbedeutend
 * mit Vollzugriff auf die Verwaltung. issuer/audience und die abweichenden
 * Feldnamen sind zusaetzliche Sicherungen, tragen aber nicht allein -- das
 * Secret ist die Grenze (Pruefung in config.portalStatus()).
 */
const ISSUER = 'ec-nordbund-portal'
const AUDIENCE = 'portal'

export interface PortalPayload {
  /** portalUser.portalUserID */
  pu: number
  /** personen.personID */
  p: number
  /**
   * Sitzungs-Generation (portalUser.token_gen). Jeder Passwortwechsel zaehlt
   * sie hoch und entwertet damit alle laufenden Sitzungen.
   *
   * Bewusst ein Zaehler und kein Zeitvergleich gegen pw_changed_at: JWT-`iat`
   * und der MySQL-Timestamp haben beide nur Sekundenaufloesung. Faellt ein
   * Passwortwechsel in dieselbe Sekunde, in der ein Token ausgegeben wurde,
   * bliebe dieser gueltig -- genau in dem Moment, in dem er es nicht mehr sein
   * soll.
   */
  g: number
  iat: number
  exp: number
}

function secret(): string {
  const s = process.env.PORTAL_JWT_SECRET
  // portalStatus() faengt das frueher ab; hier nur die Absicherung, damit ein
  // fehlendes Secret niemals zu einem mit "undefined" signierten Token fuehrt.
  if (!s) throw new Error('PORTAL_JWT_SECRET fehlt')
  return s
}

export function createPortalToken(
  portalUserID: number,
  personID: number,
  generation: number
): Promise<string> {
  return new Promise((res, rej) => {
    sign(
      { pu: portalUserID, p: personID, g: generation },
      secret(),
      { expiresIn: TOKEN_LAUFZEIT, issuer: ISSUER, audience: AUDIENCE },
      (err, encoded) => {
        if (err || !encoded) {
          rej(err ?? new Error('Kein Token erzeugt'))
          return
        }
        res(encoded)
      }
    )
  })
}

export function checkPortalToken(token: string): Promise<PortalPayload> {
  return new Promise((res, rej) => {
    verify(
      token,
      secret(),
      // Algorithmenliste explizit: ohne sie akzeptiert jsonwebtoken jeden
      // Algorithmus, den der Token selbst angibt. Der Bestand in
      // helpers/jwt.ts laesst sie weg -- hier nicht nachmachen.
      { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] },
      (err, decoded) => {
        if (err || !decoded) {
          rej(err ?? new Error('Kein Payload'))
          return
        }
        res(decoded as unknown as PortalPayload)
      }
    )
  })
}

/**
 * Liest den Token aus dem Authorization-Header.
 *
 * Die API-Konvention ist der rohe Token ohne "Bearer " (siehe src/auth.ts);
 * ein vorangestelltes Bearer wird trotzdem akzeptiert, weil jedes
 * Standard-HTTP-Werkzeug es so schickt. Der Zeichensatz-Check laeuft vor der
 * JWT-Pruefung, damit offensichtlicher Muell nicht erst durch die Krypto geht.
 */
export function tokenAusHeader(header: string | undefined): string {
  if (!header) throw unauthorized('Keine Authentifizierung uebermittelt.')
  const roh = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!/^[A-Za-z0-9._-]+$/.test(roh)) {
    throw unauthorized('Kein gueltiger Token uebermittelt.')
  }
  return roh
}
