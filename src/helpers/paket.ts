import { queryP } from './mysql'

/**
 * Passt ein Blob in ein MySQL-Paket?
 *
 * promise-mysql schickt Buffer hex-kodiert im Statement, also mit doppelter
 * Groesse. Ist das Statement groesser als max_allowed_packet, bricht die
 * Verbindung mit einem kryptischen Treiberfehler ab -- vorher pruefen und
 * eine klare Meldung geben. Genutzt von Schutzkonzept und Dateivorlagen.
 */

/** max_allowed_packet der Pool-Verbindungen (Session-Wert) in Bytes. */
export async function maxPaketBytes(): Promise<number> {
  const [{ p }] = await queryP<{ p: number }>(
    'SELECT @@max_allowed_packet AS p'
  )
  return Number(p)
}

/** Hex-Kodierung im Treiber: doppelte Groesse plus Luft fuer das Statement. */
export const passtInPaket = (bytes: number, maxPaket: number): boolean =>
  bytes * 2 + 64 * 1024 <= maxPaket
