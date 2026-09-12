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
 * IP des Clients.
 *
 * Ausschliesslich ueber `req.ip`, nicht durch eigenes Auslesen von
 * X-Forwarded-For: dessen erster Eintrag stammt vom Client und ist damit frei
 * erfunden -- im Protokoll staenden sonst Fantasie-Adressen, und genau dort
 * will man sich darauf verlassen koennen. Express wertet den Header anhand der
 * `trust proxy`-Einstellung aus (siehe index.ts) und liefert die Adresse, die
 * der vertrauenswuerdige Proxy eingetragen hat.
 */
export function clientIp(req: Request): string {
  return (req.ip || '').slice(0, 45)
}
