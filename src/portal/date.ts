/**
 * Datumsobjekte im Format der GraphQL-Typen `DateType` und `TimeStampType`.
 *
 * Klingt nach unnoetiger Nachbildung, ist aber die Bedingung dafuer, dass die
 * TN-Listen ueberhaupt funktionieren: die xlsx-Vorlagen in
 * EC-Verwaltung/public/templates referenzieren Platzhalter wie
 * `${begin.german}`, `${person.gebDat.input}` und `${anmeldeZeitpunkt.day}`.
 * Diese Pfade sind die GraphQL-Feldnamen. Liefert die REST-Route eine andere
 * Struktur, bleiben die Zellen leer -- ohne Fehlermeldung. Deshalb hier exakt
 * dieselbe Formatierung wie in graphql.ts (Z. 227 und Z. 707), inklusive
 * Zero-Padding.
 */

/** Zero-Padding wie `gb()` in graphql.ts:225. */
const gb = (v: number): string => (v < 10 ? '0' + v : String(v))

export interface DateObj {
  day: number
  month: number
  year: number
  german: string
  input: string
}

export interface TimestampObj {
  day: number
  month: number
  year: number
  h: number
  min: number
  s: number
  german: string
}

/**
 * Robuste Umwandlung. MySQL liefert DATE-Spalten als Date, je nach Spalte kann
 * aber auch ein String oder null ankommen (z. B. veranstaltungen.ende).
 * Alles, was sich nicht in ein gueltiges Datum verwandeln laesst, wird null --
 * ein "Invalid Date" im Response wuerde im Client zu "NaN.NaN.NaN".
 */
export function toDateSafe(val: Date | string | null | undefined): Date | null {
  if (!val) return null
  const d = val instanceof Date ? val : new Date(val)
  return isNaN(d.getTime()) ? null : d
}

export function dateObj(val: Date | string | null | undefined): DateObj | null {
  const d = toDateSafe(val)
  if (!d) return null
  return {
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    german: `${gb(d.getDate())}.${gb(d.getMonth() + 1)}.${d.getFullYear()}`,
    input: `${d.getFullYear()}-${gb(d.getMonth() + 1)}-${gb(d.getDate())}`
  }
}

export function tsObj(
  val: Date | string | null | undefined
): TimestampObj | null {
  const d = toDateSafe(val)
  if (!d) return null
  return {
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    h: d.getHours(),
    min: d.getMinutes(),
    s: d.getSeconds(),
    german: `${gb(d.getDate())}.${gb(d.getMonth() + 1)}.${d.getFullYear()} - ${gb(
      d.getHours()
    )}:${gb(d.getMinutes())}`
  }
}

/** `YYYY-MM-DD` fuer SQL-Parameter und Vergleiche. */
export function isoDatum(val: Date | string | null | undefined): string | null {
  const d = toDateSafe(val)
  if (!d) return null
  return `${d.getFullYear()}-${gb(d.getMonth() + 1)}-${gb(d.getDate())}`
}

/**
 * Nimmt ein `YYYY-MM-DD` aus einem Request entgegen.
 *
 * Streng statt `new Date(...)`: dessen Parser akzeptiert auch "2026", "morgen
 * ist auch noch ein Tag" wird zu Invalid Date, und "2026-02-31" rutscht als
 * 3. Maerz durch. Fuer ein Datum, das in `fz` landet und ueber die Gueltigkeit
 * einer Mitarbeit entscheidet, ist das zu locker.
 */
export function parseDatum(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [j, m, t] = v.split('-').map(Number)
  const d = new Date(j, m - 1, t)
  if (d.getFullYear() !== j || d.getMonth() !== m - 1 || d.getDate() !== t) {
    return null
  }
  return d
}

/** Heute, auf Mitternacht normiert (fuer Datumsvergleiche ohne Uhrzeit). */
export function heute(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function plusMonate(d: Date, monate: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + monate)
  return r
}

export function plusJahre(d: Date, jahre: number): Date {
  const r = new Date(d)
  r.setFullYear(r.getFullYear() + jahre)
  return r
}
