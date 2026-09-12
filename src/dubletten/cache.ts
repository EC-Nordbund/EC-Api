import { queryP } from '../helpers/mysql'
import { erkenne } from './erkennung'
import { paarKey } from './keine'
import type { Kandidat } from './typen'

/**
 * Cache der Kandidatenliste.
 *
 * Gecacht wird ausschliesslich das Ergebnis, nicht der normalisierte
 * Personenbestand: der waere beim naechsten Abruf veraltet, und die Paar-Ansicht
 * liest ohnehin frisch. Realistisch liegen hier ein paar Hundert Paare, also
 * deutlich unter einem Megabyte.
 *
 * Nur EIN Node-Prozess bedient die API (kein Cluster). Sollte das einmal
 * skaliert werden, hat jede Instanz ihren eigenen Cache -- unkritisch, weil hier
 * nur eine Vorschlagsliste liegt und jede dauerhafte Entscheidung (Merge,
 * "kein Duplikat") in der Datenbank landet und ueber den Fingerprint bei allen
 * Instanzen ankommt.
 */

interface Snapshot {
  berechnetAm: number
  dauerMs: number
  anzahlPersonen: number
  abgeschnitten: boolean
  paare: Kandidat[]
  index: Map<string, Kandidat>
  fingerprint: string
}

/** Rueckfallebene hinter der Fingerprint-Pruefung. */
const TTL_MS = 10 * 60 * 1000

let snapshot: Snapshot | null = null
/** Laufende Berechnung, damit parallele Anfragen sie teilen. */
let laufend: Promise<Snapshot> | null = null

/**
 * Billiger Zustandsabdruck des Datenbestands (eine Query, ~1 ms).
 *
 * Das ist der Hauptmechanismus der Invalidierung, und zwar deshalb: Personen
 * entstehen auch voellig ausserhalb dieses Moduls -- beim Anmelden von der
 * Website, ueber das Portal, durch GraphQL-Mutationen der Verwaltung. Jeden
 * dieser Pfade mit einem invalidate() zu versehen waere invasiv und beim
 * naechsten neuen Pfad wieder vergessen. `letzteAenderung` traegt
 * ON UPDATE current_timestamp() und ist damit ein verlaesslicher Indikator.
 */
async function fingerprint(): Promise<string> {
  const [r] = await queryP<{
    n: number
    maxID: number | null
    geaendert: string | null
    kd: number
  }>(
    `SELECT COUNT(*) n, MAX(personID) maxID,
            MAX(letzteAenderung) geaendert,
            (SELECT COUNT(*) FROM keinedublikate) kd
       FROM personen
      WHERE anonymisiert = 0`
  )
  return `${r.n}|${r.maxID ?? 0}|${r.geaendert ?? ''}|${r.kd}`
}

async function berechne(): Promise<Snapshot> {
  const fp = await fingerprint()
  const e = await erkenne()
  const index = new Map<string, Kandidat>()
  for (const p of e.paare) {
    index.set(paarKey(p.personID_1, p.personID_2).key, p)
  }
  return {
    berechnetAm: Date.now(),
    dauerMs: e.dauerMs,
    anzahlPersonen: e.anzahlPersonen,
    abgeschnitten: e.abgeschnitten,
    paare: e.paare,
    index,
    fingerprint: fp
  }
}

export interface CacheErgebnis {
  berechnetAm: string
  dauerMs: number
  anzahlPersonen: number
  abgeschnitten: boolean
  paare: Kandidat[]
}

/**
 * Liefert die Kandidatenliste, berechnet sie wenn noetig.
 *
 * @param force erzwingt eine Neuberechnung (Endpunkt "neu berechnen")
 */
export async function hole(force = false): Promise<CacheErgebnis> {
  // Laeuft schon eine Berechnung, wird sie geteilt statt eine zweite zu starten:
  // fuenf gleichzeitige Seitenaufrufe wuerden sonst fuenf CPU-Laeufe
  // hintereinander in den Event-Loop haengen.
  if (laufend) {
    const s = await laufend
    return alsErgebnis(s)
  }

  if (!force && snapshot) {
    const alter = Date.now() - snapshot.berechnetAm
    if (alter < TTL_MS) {
      const fp = await fingerprint()
      if (fp === snapshot.fingerprint) return alsErgebnis(snapshot)
    }
  }

  laufend = berechne()
  try {
    snapshot = await laufend
    return alsErgebnis(snapshot)
  } finally {
    laufend = null
  }
}

function alsErgebnis(s: Snapshot): CacheErgebnis {
  return {
    berechnetAm: new Date(s.berechnetAm).toISOString(),
    dauerMs: s.dauerMs,
    anzahlPersonen: s.anzahlPersonen,
    abgeschnitten: s.abgeschnitten,
    paare: s.paare
  }
}

/** Verwirft den Cache; neu gerechnet wird faul beim naechsten Abruf. */
export function invalidiere(): void {
  snapshot = null
}

/**
 * Entfernt ein Paar punktuell aus dem Cache, ohne neu zu rechnen.
 *
 * Fuer "kein Duplikat": wer eine Liste von 40 Vorschlaegen durcharbeitet, klickt
 * das womoeglich 30 Mal. 30 Vollberechnungen waeren unbenutzbar, und die Liste
 * wuerde sich bei jedem Klick unter den Fingern neu sortieren.
 */
export function entfernePaar(idA: number, idB: number): void {
  if (!snapshot) return
  const { key } = paarKey(idA, idB)
  if (!snapshot.index.has(key)) return
  snapshot.index.delete(key)
  snapshot.paare = snapshot.paare.filter(
    (p) => paarKey(p.personID_1, p.personID_2).key !== key
  )
  // Der Fingerprint enthaelt die Zeilenzahl von keinedublikate. Die hat sich
  // durch die Markierung gerade geaendert -- ohne Nachziehen wuerde der naechste
  // Abruf den Cache fuer veraltet halten und doch neu rechnen, womit der Patch
  // nichts gebracht haette.
  const t = snapshot.fingerprint.split('|')
  if (t.length === 4) {
    t[3] = String(Number(t[3]) + 1)
    snapshot.fingerprint = t.join('|')
  }
}

/** Nur fuer Tests/Diagnose: ist gerade etwas gecacht? */
export function istGecacht(): boolean {
  return snapshot !== null
}
