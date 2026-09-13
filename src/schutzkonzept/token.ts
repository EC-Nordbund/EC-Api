import { sign, verify } from 'jsonwebtoken'
import { TOKEN_LAUFZEIT_EMAIL, TOKEN_LAUFZEIT_PORTAL } from './config'

/**
 * JWT des Schutzkonzept-Systems -- eigenes Secret, eigener issuer/audience.
 *
 * Zwei Arten von Sitzungen:
 *  - `email`:  per Login-Code angemeldet. Die Kreise werden bei jedem Request
 *              frisch aus skKreisEmail gelesen; eine entfernte Adresse verliert
 *              den Zugang sofort.
 *  - `portal`: ein Schutzkonzept-Verwalter, aus dem Portal fuer genau einen
 *              Kreis herueber gewechselt. Flag und token_gen des Portal-Zugangs
 *              werden bei jedem Request neu geprueft.
 */
const ISSUER = 'ec-nordbund-schutzkonzept'
const AUDIENCE = 'schutzkonzept'

export type SkPayload =
  | { typ: 'email'; e: string }
  | { typ: 'portal'; pu: number; g: number; k: number }

function secret(): string {
  const s = process.env.SCHUTZKONZEPT_JWT_SECRET
  if (!s) throw new Error('SCHUTZKONZEPT_JWT_SECRET fehlt')
  return s
}

export function erzeugeSkToken(payload: SkPayload): Promise<string> {
  return new Promise((res, rej) => {
    sign(
      payload,
      secret(),
      {
        expiresIn:
          payload.typ === 'email'
            ? TOKEN_LAUFZEIT_EMAIL
            : TOKEN_LAUFZEIT_PORTAL,
        issuer: ISSUER,
        audience: AUDIENCE
      },
      (err, encoded) =>
        err || !encoded ? rej(err ?? new Error('Kein Token')) : res(encoded)
    )
  })
}

export function pruefeSkToken(
  token: string
): Promise<SkPayload & { exp: number }> {
  return new Promise((res, rej) => {
    verify(
      token,
      secret(),
      { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] },
      (err, decoded) =>
        err || !decoded
          ? rej(err ?? new Error('Kein Payload'))
          : res(decoded as any)
    )
  })
}
