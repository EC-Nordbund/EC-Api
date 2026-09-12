import { Response } from 'express'
import { ecError } from '../helpers/error'

/**
 * Fehlerausgabe fuer /portal/*.
 *
 * Bewusst abweichend vom `errorHandler` der uebrigen API: der antwortet mit
 * `text/plain` (so erwartet es EC-Verwaltung an vielen Stellen), was ein SPA
 * nicht strukturiert auswerten kann. Das Portal bekommt deshalb JSON mit einem
 * stabilen `code`, an dem das Frontend Faelle unterscheiden kann, ohne
 * Fehlertexte zu vergleichen.
 *
 * Die beiden Konventionen stehen bewusst nebeneinander -- wer eine neue Route
 * unter /v6 baut, nimmt errorHandler; unter /portal diesen hier.
 *
 * Nicht von ecError abgeleitet: dort ist `code` der HTTP-Status, hier ist es
 * der maschinenlesbare Fehlercode. Zwei Bedeutungen fuer einen Feldnamen waere
 * eine Falle fuer jeden, der spaeter eine Route dazwischen schreibt.
 */
export class PortalFehler extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'PortalFehler'
  }
}

/** Kurzformen fuer die immer gleichen Faelle. */
export const unauthorized = (m = 'Nicht angemeldet.') =>
  new PortalFehler('UNAUTHORIZED', m, 401)
export const forbidden = (m = 'Dafuer fehlt dir die Berechtigung.') =>
  new PortalFehler('NOT_IN_SCOPE', m, 403)
export const badRequest = (code: string, m: string) =>
  new PortalFehler(code, m, 400)
export const notFound = (m = 'Nicht gefunden.') =>
  new PortalFehler('NOT_FOUND', m, 404)

export function portalErrorHandler(err: unknown, res: Response): void {
  if (res.headersSent) {
    console.error('[portal] Fehler nach bereits gesendeter Antwort:', err)
    return
  }

  if (err instanceof PortalFehler) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message }
    })
    return
  }

  if (err instanceof ecError) {
    // ecError.code ist der HTTP-Status (siehe helpers/error.ts)
    res.status(err.code).json({
      error: { code: 'ERROR', message: err.message }
    })
    return
  }

  // Unerwartetes: nach aussen nur eine generische Meldung, Details ins Log.
  // Ein Stacktrace oder eine SQL-Fehlermeldung im Response wuerde Interna
  // (Tabellennamen, Pfade) an einen oeffentlich erreichbaren Endpunkt geben.
  console.error('[portal] Unerwarteter Fehler:', err)
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Unerwarteter Fehler.' }
  })
}
