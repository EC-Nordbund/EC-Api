import { queryP } from '../helpers/mysql'

/**
 * "Kein Duplikat"-Markierungen (Tabelle `keinedublikate`).
 *
 * Die Tabelle stand jahrelang im Schema, ohne dass eine Zeile Code sie gelesen
 * oder geschrieben hat. Ihr Primaerschluessel ist (personID_1, personID_2) --
 * ohne feste Reihenfolge waeren (5,9) und (9,5) zwei verschiedene Zeilen, und
 * ein Paar, das der Anwender abgelehnt hat, kaeme in der anderen Richtung
 * wieder hoch.
 *
 * Deshalb geht JEDER Zugriff durch `paarKey()`: geschrieben wird immer mit der
 * kleineren ID zuerst, gelesen und geloescht richtungsunabhaengig (die Tabelle
 * kann Altbestand in beliebiger Reihenfolge enthalten).
 */

export interface PaarKey {
  klein: number
  gross: number
  /** Stabiler Schluessel fuer Set/Map: `${klein}:${gross}`. */
  key: string
}

export function paarKey(a: number, b: number): PaarKey {
  const klein = Math.min(a, b)
  const gross = Math.max(a, b)
  return { klein, gross, key: `${klein}:${gross}` }
}

export interface KeinDuplikatEintrag {
  personID_1: number
  personID_2: number
  markiert_von: number
  markiert_am: string | null
  notiz: string
  vorname_1: string
  nachname_1: string
  gebDat_1: string
  vorname_2: string
  nachname_2: string
  gebDat_2: string
  /** users.username, falls aufloesbar. */
  markiert_von_name: string | null
}

/** Alle Markierungen mit Namen und Urheber, fuer die Review-Ansicht. */
export async function listeKeineDubletten(): Promise<KeinDuplikatEintrag[]> {
  return queryP<KeinDuplikatEintrag>(
    `SELECT k.personID_1, k.personID_2, k.markiert_von,
            DATE_FORMAT(k.markiert_am, '%Y-%m-%dT%H:%i:%sZ') AS markiert_am,
            k.notiz,
            p1.vorname AS vorname_1, p1.nachname AS nachname_1,
            DATE_FORMAT(p1.gebDat, '%Y-%m-%d') AS gebDat_1,
            p2.vorname AS vorname_2, p2.nachname AS nachname_2,
            DATE_FORMAT(p2.gebDat, '%Y-%m-%d') AS gebDat_2,
            u.username AS markiert_von_name
       FROM keinedublikate k
       LEFT JOIN personen p1 ON p1.personID = k.personID_1
       LEFT JOIN personen p2 ON p2.personID = k.personID_2
       LEFT JOIN users u     ON u.user_id   = k.markiert_von
      ORDER BY k.markiert_am DESC`
  )
}

/**
 * Setzt eine Markierung. Idempotent: ein zweiter Klick auf dasselbe Paar ist
 * kein Fehler, sondern aktualisiert Urheber, Zeitpunkt und Notiz.
 */
export async function markiereKeinDuplikat(
  idA: number,
  idB: number,
  userID: number,
  notiz: string,
  mitMetadaten: boolean
): Promise<void> {
  const { klein, gross } = paarKey(idA, idB)

  if (!mitMetadaten) {
    // Ohne sql/dubletten-schema.sql gibt es die Metadaten-Spalten nicht. Die
    // Routen lehnen diesen Fall ohnehin mit 503 ab; der Zweig existiert, damit
    // diese Funktion nicht von aussen in einen SQL-Fehler laufen kann.
    await queryP(
      'INSERT IGNORE INTO keinedublikate (personID_1, personID_2) VALUES (?, ?)',
      [klein, gross]
    )
    return
  }

  await queryP(
    `INSERT INTO keinedublikate (personID_1, personID_2, markiert_von, notiz)
          VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE markiert_von = VALUES(markiert_von),
                             markiert_am  = CURRENT_TIMESTAMP,
                             notiz        = VALUES(notiz)`,
    [klein, gross, userID, notiz.slice(0, 500)]
  )
}

/**
 * Nimmt eine Markierung zurueck -- richtungsunabhaengig, weil Altbestand
 * verdreht eingetragen sein kann.
 *
 * Dass es diese Funktion gibt, ist kein Komfort: ein Fehlklick auf "kein
 * Duplikat" versteckt sonst dauerhaft eine echte Dublette, und die Tabelle hat
 * keine andere Pflegeoberflaeche -- der einzige Ausweg waere ein SQL-Eingriff in
 * der Produktionsdatenbank.
 */
export async function loescheKeinDuplikat(
  idA: number,
  idB: number
): Promise<number> {
  const res: any = await queryP(
    `DELETE FROM keinedublikate
      WHERE (personID_1 = ? AND personID_2 = ?)
         OR (personID_1 = ? AND personID_2 = ?)`,
    [idA, idB, idB, idA]
  )
  return res?.affectedRows ?? 0
}
