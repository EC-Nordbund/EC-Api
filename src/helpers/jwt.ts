import { sign, verify } from 'jsonwebtoken'
import { payload } from '../types/payload'
import { istAktiv } from '../users/sperre'

const secret_token = process.env.JWT_SECRET!

/**
 * Erzeuge einen JWT zum Login
 *
 * @author Sebastian
 * @param payload Payload das mit in JWT kommt
 * @returns JWT (AuthToken)
 */
export function createToken(payload: payload): Promise<string> {
  return new Promise<string>((res, rej) => {
    sign(
      payload,
      secret_token,
      { expiresIn: '13h', issuer: 'ec-nordbund' },
      (err: Error | null, encoded: string | undefined) => {
        if (err) {
          rej(err)
          return
        }

        if (!encoded) {
          rej('No Token generated')
          return
        }

        res(encoded)
      }
    )
  })
}

/**
 * Validiert einen JWT (AuthToken)
 *
 * @author Sebastian
 * @param token JWT (AuthToken)
 *
 * @returns Payload des JWT
 */
export function checkToken(token: string): Promise<payload> {
  return new Promise<payload>((res, rej) => {
    verify(token, secret_token, (err: Error | null, decoded: any) => {
      if (err) {
        rej(err)
        return
      }

      if (!decoded) {
        rej('No Data provided')
        return
      }

      // Gesperrte oder abgelaufene Konten sofort abweisen, nicht erst wenn
      // der Token nach 13 Stunden abläuft (users/sperre.ts).
      if (typeof decoded.userID !== 'number') {
        res(decoded)
        return
      }
      istAktiv(decoded.userID).then((aktiv) => {
        if (aktiv) res(decoded)
        else rej(new Error('Benutzer ist gesperrt'))
      }, rej)
    })
  })
}
