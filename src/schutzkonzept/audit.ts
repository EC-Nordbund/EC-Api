import { Request } from 'express'
import { queryP } from '../helpers/mysql'
import { clientIp } from '../portal/audit'

/**
 * Audit-Spur des Schutzkonzepts. Wie portal/audit.ts: nur Kennungen, nie
 * Inhalte, und wirft nie.
 */
export async function skAudit(
  akteur: string,
  aktion: string,
  ziel: string,
  req: Request
): Promise<void> {
  try {
    await queryP(
      'INSERT INTO skAudit (akteur, aktion, ziel, ip) VALUES (?,?,?,?)',
      [akteur.slice(0, 255), aktion, ziel.slice(0, 100), clientIp(req)]
    )
  } catch (err) {
    console.error('[schutzkonzept] Audit fehlgeschlagen:', aktion, ziel, err)
  }
}
