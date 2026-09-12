/**
 * Normalisierung fuer den Dubletten-Vergleich.
 *
 * Dieselben Funktionen werden von der Erkennung UND vom Merge benutzt: wenn der
 * Merge Kontaktdaten anders vergleicht als die Erkennung, fasst er Zeilen
 * zusammen, die die Erkennung fuer verschieden hielt (oder umgekehrt) -- und die
 * Vorschau in der Oberflaeche waere eine Luege.
 */

/**
 * Deutsche Umlaute und Eszett.
 *
 * Reihenfolge ist wichtig: das muss VOR der allgemeinen Diakritika-Entfernung
 * laufen. Sonst zerlegt NFD das "ä" in "a" + Trema und uebrig bleibt "a" --
 * dann weicht "Müller" (-> muller) von "Mueller" um ein Zeichen ab, statt
 * identisch zu sein. Genau diese Schreibvariante ist einer der haeufigsten
 * Dublettengruende, sie soll als exakter Treffer erkannt werden.
 */
const UMLAUTE: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ð/g, 'd'],
  [/þ/g, 'th']
]

/**
 * Normalisiert einen Namen fuer den Vergleich.
 *
 * Bindestriche, Apostrophe und Punkte werden zu Trennern, nicht entfernt:
 * "Anne-Marie" und "Anne Marie" sollen dieselben zwei Tokens ergeben, und
 * "O'Brien" soll nicht zu "obrien" verschmelzen.
 */
export function normName(s: string | null | undefined): string {
  if (!s) return ''
  let v = s.toLowerCase()
  for (const [re, ersatz] of UMLAUTE) v = v.replace(re, ersatz)
  v = v.normalize('NFD').replace(/[̀-ͯ]/g, '')
  v = v.replace(/[^a-z0-9]+/g, ' ')
  return v.trim().replace(/\s+/g, ' ')
}

/** Namens-Tokens (Vornamenketten, Doppelnachnamen). */
export function tokens(s: string | null | undefined): string[] {
  const v = normName(s)
  return v ? v.split(' ') : []
}

/**
 * Mailadresse.
 *
 * Bewusst OHNE die Gmail-Eigenheiten (Punkte im lokalen Teil ignorieren,
 * +Suffixe abschneiden): das gilt nur fuer Gmail, und bei anderen Anbietern
 * sind "a.b@" und "ab@" zwei verschiedene Postfaecher. Hier zwei Personen
 * zusammenzufassen, die nichts miteinander zu tun haben, waere der teurere
 * Fehler.
 */
export function normEmail(s: string | null | undefined): string {
  if (!s) return ''
  return s.trim().toLowerCase()
}

/**
 * Telefonnummer auf eine vergleichbare Form.
 *
 * Gleiche Nummer, verschieden geschrieben ist der Normalfall: "04321 / 12345",
 * "+49 4321 12345", "004321-12345". Alles ausser Ziffern fliegt weg, deutsche
 * Laendervorwahl wird zur fuehrenden Null, dann die Null entfernt.
 *
 * Sehr kurze Reste werden verworfen (leerer String = kein Signal): eine
 * dreistellige Durchwahl als Gleichheitsbeweis zu nehmen, wuerde Paare
 * verbinden, die nichts verbindet.
 */
export function normTelefon(s: string | null | undefined): string {
  if (!s) return ''
  let v = s.replace(/\D+/g, '')
  if (v.startsWith('0049')) v = v.slice(4)
  else if (v.startsWith('49') && v.length > 10) v = v.slice(2)
  v = v.replace(/^0+/, '')
  return v.length >= 6 ? v : ''
}

/**
 * Adresse als Vergleichsschluessel.
 *
 * Die Hausnummer bleibt absichtlich im Schluessel -- sie unterscheidet Nachbarn.
 *
 * "strasse" wird auf "str" gekuerzt, weil dieselbe Adresse in beiden
 * Schreibweisen vorkommt ("Musterstraße 1" / "Musterstr. 1"). Das Muster hat
 * bewusst KEINE Wortgrenze am Anfang: im Deutschen ist die zusammengeschriebene
 * Form der Normalfall, und mit fuehrendem \b haette die Ersetzung genau die
 * nicht erfasst (nur freistehendes "Strasse"). Die Wortgrenze am ENDE muss
 * bleiben, sonst wird auch "Strassenrand" angefasst.
 */
export function normAdresse(
  strasse: string | null | undefined,
  plz: string | null | undefined,
  ort: string | null | undefined
): string {
  const s = normName(strasse).replace(/(strasse|str)\b/g, 'str')
  const p = (plz ?? '').trim()
  const o = normName(ort)
  if (!s && !p && !o) return ''
  return `${p}|${s}|${o}`
}

/**
 * Intern-Tabelle: ordnet jedem Wert eine laufende Zahl zu.
 *
 * Der Paar-Vergleich laeuft ueber 2,39 Millionen Kombinationen. Namen und
 * Kontaktwerte dort als Strings zu vergleichen kostet deutlich mehr als ein
 * Integer-Vergleich, ohne irgendeinen Gewinn an Genauigkeit: gleich normalisiert
 * ist gleich. Deshalb wird jeder normalisierte Wert einmal gegen eine Zahl
 * getauscht, und der heisse Pfad rechnet nur noch mit Zahlen.
 *
 * Der leere String bekommt bewusst KEINE ID (-1): "beide haben keine Mail" ist
 * kein Treffer, sondern Abwesenheit von Information.
 */
export class Intern {
  private map = new Map<string, number>()
  private naechste = 0

  id(wert: string): number {
    if (!wert) return -1
    const vorhanden = this.map.get(wert)
    if (vorhanden !== undefined) return vorhanden
    const neu = this.naechste++
    this.map.set(wert, neu)
    return neu
  }

  get groesse(): number {
    return this.map.size
  }
}
