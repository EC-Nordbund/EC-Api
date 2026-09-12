import { queryP } from '../helpers/mysql'

/**
 * Prueft einmalig, ob sql/dubletten-schema.sql eingespielt ist.
 *
 * Anders als beim Portal gibt es hier bewusst KEINEN harten Startup-Guard, der
 * alles auf 503 setzt: Erkennung, Kandidatenliste, Paar-Detail und Merge
 * brauchen ausschliesslich das Bestandsschema und funktionieren ohne diese
 * Datei vollstaendig. Betroffen sind nur die Metadaten der
 * "kein Duplikat"-Markierung und das Protokoll.
 *
 * Deshalb: Lese-Routen laufen weiter und liefern einen Hinweis mit, die beiden
 * kein-duplikat-Routen antworten mit 503 (eine Markierung ohne Urheber und
 * Zeitpunkt waere nicht nachvollziehbar und nicht pflegbar), und der Merge
 * ueberspringt lediglich den Protokolleintrag.
 *
 * Ergebnis wird gecacht -- das ist eine Schema-Frage, die sich zur Laufzeit
 * nicht aendert (Vorbild: src/portal/config.ts).
 */

let geprueft: boolean | null = null

export async function hatSchemaErweiterung(): Promise<boolean> {
  if (geprueft !== null) return geprueft

  try {
    const spalten = await queryP<{ n: number }>(
      `SELECT COUNT(*) n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'keinedublikate'
          AND COLUMN_NAME IN ('markiert_von', 'markiert_am', 'notiz')`
    )
    const tabellen = await queryP<{ n: number }>(
      `SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'dublettenLog'`
    )
    geprueft =
      Number(spalten[0]?.n ?? 0) === 3 && Number(tabellen[0]?.n ?? 0) === 1
  } catch {
    geprueft = false
  }

  if (!geprueft) {
    console.warn(
      '[dubletten] sql/dubletten-schema.sql ist nicht eingespielt: ' +
        '"kein Duplikat" ist deaktiviert, Merges werden nicht protokolliert.'
    )
  }
  return geprueft
}

/** Hinweis fuer die Oberflaeche, oder null wenn alles da ist. */
export async function schemaHinweis(): Promise<string | null> {
  if (await hatSchemaErweiterung()) return null
  return (
    'sql/dubletten-schema.sql ist nicht eingespielt. Vorschläge und ' +
    'Zusammenführen funktionieren, aber Paare können nicht dauerhaft als ' +
    '„kein Duplikat" gespeichert werden.'
  )
}

/** Nur fuer Tests: erneute Pruefung erzwingen. */
export function schemaPruefungZuruecksetzen(): void {
  geprueft = null
}
