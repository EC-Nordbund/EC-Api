/**
 * Levenshtein-Distanz mit Obergrenze.
 *
 * Eigene Implementierung statt einer Dependency: package.json enthaelt nichts
 * Passendes, und fuer 40 Zeilen eine weitere Abhaengigkeit aufzunehmen waere
 * unverhaeltnismaessig.
 *
 * Die Funktion laeuft bei 2188 Personen einige Hunderttausend Mal (jedes Paar,
 * das das Laengen-Gate passiert), deshalb ist sie auf fruehen Abbruch statt auf
 * Vollstaendigkeit optimiert: gefragt ist nie die exakte Distanz grosser Werte,
 * sondern nur "ist sie <= max".
 */

/**
 * Liefert die Levenshtein-Distanz von a und b, oder `max + 1`, sobald
 * feststeht, dass sie groesser als `max` ist.
 */
export function levMax(a: string, b: string, max: number): number {
  // Billigster Ausschluss zuerst: allein der Laengenunterschied kostet schon
  // so viele Operationen.
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a === b) return 0

  // Gemeinsames Prefix und Suffix tragen nichts zur Distanz bei.
  let start = 0
  const minLen = Math.min(a.length, b.length)
  while (start < minLen && a[start] === b[start]) start++

  let endeA = a.length
  let endeB = b.length
  while (endeA > start && endeB > start && a[endeA - 1] === b[endeB - 1]) {
    endeA--
    endeB--
  }

  let s = a.slice(start, endeA)
  let t = b.slice(start, endeB)

  if (s.length === 0) return t.length <= max ? t.length : max + 1
  if (t.length === 0) return s.length <= max ? s.length : max + 1

  // Kuerzeren String nach vorn: die Zeilenpuffer richten sich nach s.
  if (s.length > t.length) {
    const tmp = s
    s = t
    t = tmp
  }

  const breite = s.length + 1
  let vorher = new Array<number>(breite)
  let aktuell = new Array<number>(breite)

  for (let i = 0; i < breite; i++) vorher[i] = i

  for (let j = 1; j <= t.length; j++) {
    aktuell[0] = j
    let zeilenMin = j

    // Nur das Band um die Diagonale berechnen: ausserhalb davon kann die
    // Distanz max nicht mehr unterschreiten. Die Raender des Bandes werden
    // bewusst auf max+1 gesetzt, damit sie als "zu weit" in die Minima eingehen.
    const von = Math.max(1, j - max)
    const bis = Math.min(s.length, j + max)

    if (von > 1) aktuell[von - 1] = max + 1

    for (let i = von; i <= bis; i++) {
      const kosten = s[i - 1] === t[j - 1] ? 0 : 1
      const wert = Math.min(
        vorher[i] + 1, // Loeschung
        aktuell[i - 1] + 1, // Einfuegung
        vorher[i - 1] + kosten // Ersetzung
      )
      aktuell[i] = wert
      if (wert < zeilenMin) zeilenMin = wert
    }

    // Kein Wert dieser Zeile liegt noch im Budget -- spaetere Zeilen koennen
    // nur groesser werden.
    if (zeilenMin > max) return max + 1

    const tmp = vorher
    vorher = aktuell
    aktuell = tmp
  }

  const d = vorher[s.length]
  return d <= max ? d : max + 1
}

/**
 * Prueft, ob zwei gleich lange Ziffernfolgen durch das Vertauschen zweier
 * benachbarter Ziffern auseinander hervorgehen (1998 / 1989, 1967 / 1976).
 *
 * Das ist der klassische Zahlendreher beim Abtippen eines Geburtsjahres und
 * liegt bei Levenshtein bei Distanz 2 -- also in derselben Kategorie wie zwei
 * unabhaengige Tippfehler, obwohl er deutlich verdaechtiger ist. Deshalb eine
 * eigene Pruefung statt Damerau-Levenshtein ueberall.
 */
export function istZifferndreher(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false

  const abweichungen: number[] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      abweichungen.push(i)
      if (abweichungen.length > 2) return false
    }
  }

  if (abweichungen.length !== 2) return false
  const [i, j] = abweichungen
  return j === i + 1 && a[i] === b[j] && a[j] === b[i]
}
