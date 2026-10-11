import { queryP } from '../helpers/mysql'

/**
 * Prüft bei jedem Request, ob das Verwaltungs-Konto noch aktiv ist.
 *
 * Der AuthToken gilt 13 Stunden (helpers/jwt.ts). Ohne diese Prüfung könnte
 * ein gesperrter Benutzer bis zum Ablauf seines Tokens weiterarbeiten -- die
 * Sperre aus der Administration (users/admin.ts) soll aber sofort greifen.
 *
 * Damit nicht jeder Request eine zusätzliche Abfrage kostet, wird das Ergebnis
 * je Benutzer kurz gemerkt. Beim Sperren wird der Eintrag verworfen
 * (vergissStatus), die Sperre wirkt in diesem Prozess also sofort, in einem
 * weiteren Prozess nach spätestens MERKDAUER_MS.
 */
const MERKDAUER_MS = 30 * 1000

const gemerkt = new Map<number, { bis: number; aktiv: boolean }>()

export async function istAktiv(userID: number): Promise<boolean> {
  const treffer = gemerkt.get(userID)
  if (treffer && treffer.bis > Date.now()) return treffer.aktiv

  const rows = await queryP<{ n: number }>(
    'SELECT COUNT(*) AS n FROM users WHERE user_id = ? AND ablauf_datum > NOW()',
    [userID]
  )
  const aktiv = Number(rows[0]?.n ?? 0) === 1
  gemerkt.set(userID, { bis: Date.now() + MERKDAUER_MS, aktiv })
  return aktiv
}

export function vergissStatus(userID: number): void {
  gemerkt.delete(userID)
}
