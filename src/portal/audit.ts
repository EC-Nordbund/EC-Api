import { Request } from 'express'
import { queryP } from '../helpers/mysql'

/**
 * Zugriffs- und Aenderungsprotokoll des Portals.
 *
 * Bewusst nur IDs, nie Inhalte: die TN-Listen enthalten Gesundheits- und
 * Allergieangaben Minderjaehriger (DSGVO Art. 9). Ein Protokoll, das diese
 * Daten selbst noch einmal speichert, verdoppelt das Problem, statt es
 * beherrschbar zu machen.
 *
 * Nicht die vorhandene Tabelle `userLogging` nachgenutzt: die wird von keiner
 * Zeile Code beschrieben, hat kein festes Format und keine Indizes.
 *
 * Wirft nie. Ein fehlgeschlagenes Protokoll darf keinen fachlichen Vorgang
 * abbrechen -- ein eingetragenes Fuehrungszeugnis soll nicht daran scheitern,
 * dass die Audit-Tabelle klemmt. Fehler landen im Log.
 */
export async function audit(
  portalUserID: number | null,
  aktion: string,
  ziel: string,
  req: Request
): Promise<void> {
  try {
    await queryP(
      'INSERT INTO portalAudit (portalUserID, aktion, ziel, ip) VALUES (?,?,?,?)',
      [portalUserID, aktion, ziel.slice(0, 100), clientIp(req)]
    )
  } catch (err) {
    console.error('[portal] Audit fehlgeschlagen:', aktion, ziel, err)
  }
}

/**
 * IP des Clients. Hinter dem Reverse Proxy der Produktion steht die echte
 * Adresse in X-Forwarded-For; `req.ip` liefert dort sonst die des Proxys.
 * Nur der erste Eintrag zaehlt, der Rest ist vom Client faelschbar.
 */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  const roh = Array.isArray(xff) ? xff[0] : xff
  const ip = roh ? roh.split(',')[0].trim() : req.ip
  return (ip || '').slice(0, 45)
}
