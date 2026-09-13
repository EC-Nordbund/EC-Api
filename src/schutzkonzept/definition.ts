/**
 * Formular-Definition und Formulardaten des Schutzkonzepts.
 *
 * KOPIE in EC-Portal/src/schutzkonzept/definition.ts und
 * schutzkonzept/src/schutzkonzept/definition.ts -- Aenderungen bitte in allen
 * drei Repos spiegeln (siehe DUPLIKATE.md). Die Datei hat deshalb bewusst
 * keinen einzigen Import: Backend und Frontends rechnen Fortschritt,
 * Pflichtfelder und Bereinigung mit exakt demselben Code.
 *
 * Zwei Formen, zwei Regeln:
 *
 *  - Die DEFINITION ist ein Baum (Bereiche > Abschnitte > Felder). So wird sie
 *    gebaut und angezeigt.
 *  - Die DATEN, die das Formular erzeugt, sind so flach wie moeglich:
 *    `{ [key]: wert }`. Eine Mehrfachauswahl wird zu je einem Boolean pro
 *    Option (`${key}_${option.key}`). Die EINZIGE Verschachtelung ist das
 *    Tabellen-Feld (`gruppe`): ein Array aus wiederum flachen Zeilen.
 *
 * Die DOCX-Daten haben dieselben Schluessel wie die gespeicherten Daten, nur
 * mit Ausgabewerten (Checkbox -> "X", Datum -> TT.MM.JJJJ, ...).
 *
 * Drei Dinge liegen NEBEN den Daten, nicht darin:
 *  - `feld.regeln` (Wertebereich je Feld) und `feld.erinnerung` (Mail vor
 *    einem Datum) gehoeren zur Definition; ausgewertet werden sie hier
 *    (regelVerstoesse, erinnerungsTermine), damit Server und Client dasselbe
 *    sagen.
 *  - Die Bestaetigung eines Abschnitts ("geprueft") ist KEINE Antwort und
 *    steht deshalb nicht in `daten`, sondern als Liste von Abschnitt-IDs am
 *    Stand. Ob sie noch gilt, entscheidet abschnittsHash: aendert sich ein
 *    Wert des Abschnitts, ist die Bestaetigung weg.
 */

export type FeldTyp =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'radio'
  | 'multiselect'
  | 'checkbox'
  | 'info'
  | 'gruppe'

export const FELD_TYPEN: { typ: FeldTyp; label: string }[] = [
  { typ: 'text', label: 'Text (einzeilig)' },
  { typ: 'textarea', label: 'Text (mehrzeilig)' },
  { typ: 'number', label: 'Zahl' },
  { typ: 'date', label: 'Datum' },
  { typ: 'select', label: 'Auswahl (Liste)' },
  { typ: 'radio', label: 'Auswahl (Radio-Buttons)' },
  { typ: 'multiselect', label: 'Mehrfachauswahl' },
  { typ: 'checkbox', label: 'Checkbox' },
  { typ: 'info', label: 'Info-Text (nur Anzeige)' },
  { typ: 'gruppe', label: 'Tabelle (wiederholbare Einträge)' }
]

export interface Option {
  id: string
  /** Teil des flachen Schluessels `${feld.key}_${option.key}`. */
  key: string
  label: string
}

/**
 * Wertebereich eines Felds. Immer vollstaendig vorhanden (normalisiert); was
 * nicht zum Typ passt, steht auf "keine Grenze". Datumsgrenzen sind
 * Ausdruecke, weil "nicht in der Vergangenheit" in jedem Jahr gelten soll:
 * `heute`, relativ dazu (`+1y`, `-3m`, `+14d`) oder fest als JJJJ-MM-TT.
 * Leer = offen.
 */
export interface Regeln {
  /** Nur `date`. */
  minDatum: string
  maxDatum: string
  /** Nur `number`; null = keine Grenze. */
  min: number | null
  max: number | null
  /** Nur `text` und `textarea`; 0 = keine Grenze. */
  minLaenge: number
  maxLaenge: number
}

/**
 * Erinnerungs-Mail an die Schutzkonzept-Adressen des Kreises vor (und nach)
 * einem eingetragenen Datum, z. B. "naechste Ueberpruefung am". Hier steht
 * nur, WELCHE Termine erinnern (erinnerungsTermine); welche Stufe an einem
 * Tag faellig ist, entscheidet allein der Job in der API
 * (erinnerung.ts, faelligeStufe) -- eine zweite Fassung im Client wuerde
 * frueher oder spaeter etwas anderes anzeigen, als der Server verschickt.
 * Das Portal bekommt die Stufe deshalb fertig vom Server
 * (anstehendeErinnerungen).
 */
export interface Erinnerung {
  /** Nur bei `date`; bei allen anderen Typen immer false. */
  aktiv: boolean
  /** Tage vor dem Datum, absteigend, ohne Doppelte; 0 = am Tag selbst. */
  tageVorher: number[]
  /** Nach dem Datum woechentlich erinnern, hoechstens UEBERFAELLIG_MAX_WOCHEN. */
  ueberfaelligWoechentlich: boolean
}

export const ERINNERUNG_STANDARD_TAGE = [30, 0]
export const UEBERFAELLIG_MAX_WOCHEN = 4

export interface Einstellungen {
  /**
   * Jeder Abschnitt muss vor dem Veroeffentlichen einzeln als "geprueft"
   * bestaetigt sein (siehe unbestaetigteAbschnitte).
   */
  abschnitteBestaetigen: boolean
}

export interface Feld {
  /** Stabile ID, bleibt ueber alle Formularversionen gleich. */
  id: string
  /** Interne Bezeichnung = Platzhaltername in der DOCX. Leer bei `info`. */
  key: string
  label: string
  /** Hilfetext unter dem Feld; bei `info` der angezeigte Text. */
  hilfe: string
  typ: FeldTyp
  pflicht: boolean
  /** select, radio, multiselect */
  optionen: Option[]
  /** Ausgabe in der DOCX fuer "angekreuzt" (checkbox, Options-Flags). */
  wertAn: string
  /** Ausgabe in der DOCX fuer "nicht angekreuzt". */
  wertAus: string
  /** Nur `gruppe`: Spalten einer Zeile. Keine Tabellen in Tabellen. */
  felder: Feld[]
  /** Nur `gruppe`. 0 = keine Untergrenze. */
  minEintraege: number
  /** Nur `gruppe`. 0 = keine Obergrenze. */
  maxEintraege: number
  /** Nur `gruppe`: Bezeichnung eines Eintrags, z. B. "Gruppenraum". */
  eintragLabel: string
  regeln: Regeln
  erinnerung: Erinnerung
}

export interface Abschnitt {
  id: string
  titel: string
  beschreibung: string
  felder: Feld[]
}

export interface Bereich {
  id: string
  titel: string
  beschreibung: string
  abschnitte: Abschnitt[]
}

export interface Definition {
  bereiche: Bereich[]
  einstellungen: Einstellungen
}

/** Ein Wert in den flachen Daten. Arrays gibt es nur fuer Tabellen. */
export type Zeile = Record<string, string | number | boolean | null>
export type Wert = string | number | boolean | null | Zeile[]
export type Daten = Record<string, Wert>

/**
 * Harte Obergrenzen. Der Server kuerzt alles darueber beim Bereinigen, deshalb
 * sind sie bewusst grosszuegig (ein Verhaltenskodex als Info-Text, eine lange
 * Risikoanalyse) und exportiert: die Frontends setzen daraus maxlength/counter
 * und sperren "hinzufuegen", damit nie still etwas abgeschnitten wird.
 * Achtung: ein Bereich geht als ein Request durch den 2-MB-JSON-Parser.
 */
export const GRENZEN = {
  textLaenge: 2000,
  textareaLaenge: 50000,
  keyLaenge: 60,
  maxZeilen: 200,
  labelLaenge: 1000,
  hilfeLaenge: 20000,
  /** wertAn / wertAus */
  wertLaenge: 50,
  eintragLabelLaenge: 100,
  maxBereiche: 50,
  maxAbschnitte: 100,
  /** Felder je Abschnitt */
  maxFelder: 200,
  /** Spalten je Tabelle */
  maxSpalten: 50,
  maxOptionen: 100,
  /** Datumsausdruck in Regeln ("+14d", "2026-12-31") */
  regelAusdruckLaenge: 20,
  /** Eintraege in erinnerung.tageVorher */
  maxErinnerungen: 10,
  /** Groesster Wert in tageVorher (10 Jahre) */
  tageVorherMax: 3650
}

/* ------------------------------------------------------------ Hilfen ---- */

export function neueId(): string {
  const zeichen = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 12; i++) {
    s += zeichen[Math.floor(Math.random() * zeichen.length)]
  }
  return s
}

/** "Gruppenräume (innen)" -> "gruppenraeume_innen" */
export function slug(text: string): string {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, '_$1')
      .slice(0, GRENZEN.keyLaenge) || 'feld'
  )
}

export const hatOptionen = (typ: FeldTyp): boolean =>
  typ === 'select' || typ === 'radio' || typ === 'multiselect'

export const hatDaten = (typ: FeldTyp): boolean => typ !== 'info'

/** Alle Felder eines Bereichs (oberste Ebene, ohne Tabellenspalten). */
export function felderVonBereich(b: Bereich): Feld[] {
  return b.abschnitte.flatMap((a) => a.felder)
}

export function alleFelder(def: Pick<Definition, 'bereiche'>): Feld[] {
  return def.bereiche.flatMap(felderVonBereich)
}

/* -------------------------------------------------------------- Datum ---- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

const tageImMonat = (jahr: number, monat: number): number =>
  new Date(Date.UTC(jahr, monat, 0)).getUTCDate()

/** JJJJ-MM-TT, und den Tag gibt es (kein 2026-02-30). */
export function gueltigesIsoDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false
  const [j, m, t] = s.split('-').map(Number)
  return m >= 1 && m <= 12 && t >= 1 && t <= tageImMonat(j, m)
}

const isoAus = (d: Date): string =>
  `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

/**
 * Datum um n Tage/Monate/Jahre verschieben, rein rechnerisch in UTC -- so
 * gibt es keine Sommerzeit-Ueberraschung. Monatsende wird gekappt:
 * 31.01. + 1m = 28.02.
 */
export function verschiebeDatum(
  iso: string,
  n: number,
  einheit: 'd' | 'm' | 'y'
): string {
  const [j, m, t] = iso.split('-').map(Number)
  if (einheit === 'd') return isoAus(new Date(Date.UTC(j, m - 1, t + n)))
  const gesamt = j * 12 + (m - 1) + (einheit === 'y' ? n * 12 : n)
  const nj = Math.floor(gesamt / 12)
  const nm = gesamt - nj * 12 + 1
  return isoAus(
    new Date(Date.UTC(nj, nm - 1, Math.min(t, tageImMonat(nj, nm))))
  )
}

const RELATIV_RE = /^([+-])(\d{1,5})([dmy])$/

/**
 * Hoechstens 100 Jahre relativ: mehr ergaebe fuenfstellige oder negative
 * Jahre, und die String-Vergleiche der Regeln (ISO sortiert nur bei vier
 * Ziffern richtig) kippen dann still -- `+9999y` als Hoechstdatum lehnte
 * jedes Datum ab.
 */
export const RELATIV_MAX_JAHRE = 100
const RELATIV_MAX: Record<'d' | 'm' | 'y', number> = {
  d: RELATIV_MAX_JAHRE * 366,
  m: RELATIV_MAX_JAHRE * 12,
  y: RELATIV_MAX_JAHRE
}

/** `+14d` -> { n: 14, einheit: 'd' }; null, wenn keine (erlaubte) Verschiebung. */
function relativTeile(
  a: string
): { n: number; einheit: 'd' | 'm' | 'y' } | null {
  const m = RELATIV_RE.exec(a)
  if (!m) return null
  const einheit = m[3] as 'd' | 'm' | 'y'
  const betrag = Number(m[2])
  if (betrag > RELATIV_MAX[einheit]) return null
  return { n: m[1] === '-' ? -betrag : betrag, einheit }
}

/** Ist der Text ein Datumsausdruck fuer Regeln? Leer zaehlt als "offen". */
export function gueltigerDatumAusdruck(ausdruck: unknown): boolean {
  const a = String(ausdruck ?? '')
    .trim()
    .toLowerCase()
  return (
    a === '' ||
    a === 'heute' ||
    relativTeile(a) !== null ||
    gueltigesIsoDatum(a)
  )
}

/**
 * Datumsausdruck einer Regel aufloesen: `heute`, `+1y`, `-3m`, `+14d` oder
 * JJJJ-MM-TT -> JJJJ-MM-TT. null bei leerem oder ungueltigem Ausdruck (die
 * Syntax prueft pruefeDefinition vorab mit gueltigerDatumAusdruck) und wenn
 * das Ergebnis kein vierstelliges Jahr mehr hat (`-3000y`).
 */
export function parseRelativDatum(
  ausdruck: unknown,
  heute: string
): string | null {
  const a = String(ausdruck ?? '')
    .trim()
    .toLowerCase()
  if (!a) return null
  if (gueltigesIsoDatum(a)) return a
  if (!gueltigesIsoDatum(heute)) return null
  if (a === 'heute') return heute
  const r = relativTeile(a)
  if (!r) return null
  const ergebnis = verschiebeDatum(heute, r.n, r.einheit)
  return gueltigesIsoDatum(ergebnis) ? ergebnis : null
}

/**
 * Heutiges Datum in deutscher Ortszeit als JJJJ-MM-TT -- unabhaengig von der
 * Zeitzone des Servers oder Browsers, damit "nicht in der Vergangenheit" um
 * 0:30 Uhr nicht noch den Vortag meint.
 */
export function heuteISO(jetzt: Date = new Date()): string {
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(jetzt)
  const t = (typ: string) => teile.find((p) => p.type === typ)?.value ?? ''
  return `${t('year')}-${t('month')}-${t('day')}`
}

/**
 * Entfernt Zeichen, die in XML 1.0 verboten sind. docx-templates maskiert nur
 * & < >; ein U+000B (Shift+Enter aus Word) landet sonst roh in document.xml,
 * LibreOffice/Gotenberg scheitert, und der Kreis kann nie veroeffentlichen.
 * Vertikaler Tab und Seitenumbruch werden zu Zeilenumbruechen, \n und \t
 * bleiben. Einzelne Surrogate (kaputtes UTF-16 aus JSON) fliegen ebenfalls.
 */
export function bereinigeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u000b\u000c]/g, '\n')
    .replace(/[\u0000-\u0008\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (m) =>
      m.length === 2 ? m : ''
    )
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? bereinigeText(v).slice(0, max) : ''

/**
 * Liest nur eigene Eigenschaften. `daten['constructor']` o. ae. liefert
 * sonst Object.prototype-Werte, die als "ausgefuellt" durchgehen.
 */
const eigen = (q: any, k: string): any =>
  q && typeof q === 'object' && Object.prototype.hasOwnProperty.call(q, k)
    ? q[k]
    : undefined

/**
 * Namen, die als Schluessel eines Daten-Objekts nicht funktionieren:
 * `__proto__` setzt den Prototyp statt einer Eigenschaft, `__code__` und
 * `__result__` ueberschreiben in der vm-Sandbox von docx-templates den
 * auszufuehrenden Code, die uebrigen kollidieren mit Object.prototype.
 */
const OBJEKT_NAMEN = new Set([
  'constructor',
  'prototype',
  'hasownproperty',
  'isprototypeof',
  'propertyisenumerable',
  'tostring',
  'tolocalestring',
  'valueof'
])

const istUnsichererKey = (k: string): boolean =>
  k.startsWith('__') || k.endsWith('__') || OBJEKT_NAMEN.has(k.toLowerCase())

/* ---------------------------------------------------- Normalisierung ---- */

const ganz = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n > 0 ? n : 0
}

const ID_RE = /^[a-zA-Z0-9_-]{1,40}$/
const idOderNeu = (v: unknown): string =>
  typeof v === 'string' && ID_RE.test(v) ? v : neueId()

const TYPEN = new Set(FELD_TYPEN.map((t) => t.typ))

const zahlOderNull = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Obergrenze des Servers fuer Texte dieses Typs; 0 = kein Textfeld. */
const textGrenze = (typ: FeldTyp): number =>
  typ === 'text'
    ? GRENZEN.textLaenge
    : typ === 'textarea'
      ? GRENZEN.textareaLaenge
      : 0

function normalisiereRegeln(roh: any, typ: FeldTyp): Regeln {
  const grenze = textGrenze(typ)
  const ausdruck = (v: unknown): string =>
    typ === 'date'
      ? str(v, GRENZEN.regelAusdruckLaenge).trim().toLowerCase()
      : ''
  return {
    minDatum: ausdruck(roh?.minDatum),
    maxDatum: ausdruck(roh?.maxDatum),
    min: typ === 'number' ? zahlOderNull(roh?.min) : null,
    max: typ === 'number' ? zahlOderNull(roh?.max) : null,
    minLaenge: grenze ? ganz(roh?.minLaenge) : 0,
    // Mehr als die Servergrenze kann kein Text lang sein -- still kappen.
    maxLaenge: grenze ? Math.min(ganz(roh?.maxLaenge), grenze) : 0
  }
}

function normalisiereErinnerung(roh: any, typ: FeldTyp): Erinnerung {
  let tage = [...ERINNERUNG_STANDARD_TAGE]
  if (Array.isArray(roh?.tageVorher)) {
    const gueltig = roh.tageVorher
      .map((t: unknown) =>
        typeof t === 'number' ? t : parseInt(String(t ?? ''), 10)
      )
      .filter(
        (n: number) =>
          Number.isInteger(n) && n >= 0 && n <= GRENZEN.tageVorherMax
      )
    tage = [...new Set<number>(gueltig)]
      .sort((a, b) => b - a)
      .slice(0, GRENZEN.maxErinnerungen)
  }
  return {
    aktiv: typ === 'date' && roh?.aktiv === true,
    tageVorher: tage,
    ueberfaelligWoechentlich: roh?.ueberfaelligWoechentlich !== false
  }
}

function normalisiereFeld(roh: any, inTabelle: boolean): Feld {
  let typ: FeldTyp = TYPEN.has(roh?.typ) ? roh.typ : 'text'
  if (inTabelle && (typ === 'gruppe' || typ === 'info')) typ = 'text'
  return {
    id: idOderNeu(roh?.id),
    key: str(roh?.key, GRENZEN.keyLaenge).trim(),
    label: str(roh?.label, GRENZEN.labelLaenge),
    hilfe: str(roh?.hilfe, GRENZEN.hilfeLaenge),
    typ,
    pflicht: typ !== 'info' && roh?.pflicht === true,
    optionen: hatOptionen(typ)
      ? (Array.isArray(roh?.optionen) ? roh.optionen : [])
          .slice(0, GRENZEN.maxOptionen)
          .map((o: any): Option => ({
            id: idOderNeu(o?.id),
            key: str(o?.key, GRENZEN.keyLaenge).trim(),
            label: str(o?.label, GRENZEN.labelLaenge)
          }))
      : [],
    wertAn:
      typeof roh?.wertAn === 'string'
        ? str(roh.wertAn, GRENZEN.wertLaenge)
        : 'X',
    wertAus: str(roh?.wertAus, GRENZEN.wertLaenge),
    felder:
      typ === 'gruppe' && !inTabelle
        ? (Array.isArray(roh?.felder) ? roh.felder : [])
            .slice(0, GRENZEN.maxSpalten)
            .map((f: any) => normalisiereFeld(f, true))
        : [],
    minEintraege: typ === 'gruppe' ? ganz(roh?.minEintraege) : 0,
    maxEintraege: typ === 'gruppe' ? ganz(roh?.maxEintraege) : 0,
    eintragLabel:
      typ === 'gruppe'
        ? str(roh?.eintragLabel, GRENZEN.eintragLabelLaenge)
        : '',
    regeln: normalisiereRegeln(roh?.regeln, typ),
    erinnerung: normalisiereErinnerung(roh?.erinnerung, typ)
  }
}

/**
 * Bringt beliebiges JSON in die Form einer Definition: unbekannte
 * Eigenschaften fallen weg, fehlende bekommen Standardwerte. Wirft nie.
 * Fachliche Fehler (doppelte Keys ...) meldet erst pruefeDefinition().
 */
export function normalisiereDefinition(roh: any): Definition {
  const bereiche = Array.isArray(roh?.bereiche) ? roh.bereiche : []
  return {
    bereiche: bereiche.slice(0, GRENZEN.maxBereiche).map((b: any): Bereich => ({
      id: idOderNeu(b?.id),
      titel: str(b?.titel, GRENZEN.labelLaenge),
      beschreibung: str(b?.beschreibung, GRENZEN.hilfeLaenge),
      abschnitte: (Array.isArray(b?.abschnitte) ? b.abschnitte : [])
        .slice(0, GRENZEN.maxAbschnitte)
        .map((a: any): Abschnitt => ({
          id: idOderNeu(a?.id),
          titel: str(a?.titel, GRENZEN.labelLaenge),
          beschreibung: str(a?.beschreibung, GRENZEN.hilfeLaenge),
          felder: (Array.isArray(a?.felder) ? a.felder : [])
            .slice(0, GRENZEN.maxFelder)
            .map((f: any) => normalisiereFeld(f, false))
        }))
    })),
    einstellungen: {
      // Standard an: aeltere Definitionen ohne `einstellungen` verlangen die
      // Bestaetigung also auch -- das ist der gewuenschte Normalfall.
      abschnitteBestaetigen: roh?.einstellungen?.abschnitteBestaetigen !== false
    }
  }
}

/* ------------------------------------------------------------ Pruefung -- */

/**
 * Woerter, die als Platzhaltername nicht funktionieren: die Befehle von
 * docx-templates (ein `{{LINK}}` wird als Befehl gelesen, nicht als
 * Variable) und JavaScript-Schluesselwoerter (Platzhalter sind JS-Ausdruecke).
 */
const RESERVIERT = new Set([
  'query',
  'cmd_node',
  'alias',
  'for',
  'end-for',
  'if',
  'end-if',
  'ins',
  'exec',
  'image',
  'link',
  'html',
  'in',
  'true',
  'false',
  'null',
  'undefined',
  'new',
  'this',
  'typeof',
  'var',
  'let',
  'const',
  'function',
  'return',
  'delete',
  'void',
  'with',
  'class',
  'do',
  'while',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'import',
  'export',
  'super',
  'yield',
  'await',
  'enum',
  'else',
  'instanceof',
  'nan',
  'infinity'
])

export const KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Metadaten, die jede DOCX zusaetzlich bekommt (siehe docxDaten). */
export const META_KEYS = [
  'meta_kreis',
  'meta_stand_version',
  'meta_formular_version',
  'meta_datum',
  'meta_entwurf'
]

export interface Problem {
  /** Wo: Bereich/Abschnitt/Feld-IDs, soweit bekannt (zum Hinspringen). */
  bereichId?: string
  abschnittId?: string
  feldId?: string
  text: string
}

export interface Pruefung {
  fehler: Problem[]
  warnungen: Problem[]
}

function pruefeKey(key: string): string | null {
  if (!key) return 'Interne Bezeichnung fehlt.'
  if (!KEY_RE.test(key)) {
    return `„${key}“: nur Buchstaben, Ziffern und _ (nicht mit Ziffer beginnend).`
  }
  if (RESERVIERT.has(key.toLowerCase())) {
    return `„${key}“ ist ein reserviertes Wort und als Platzhalter nicht nutzbar.`
  }
  if (key.toLowerCase().startsWith('meta_')) {
    return `„${key}“: das Präfix meta_ ist für Metadaten reserviert.`
  }
  if (istUnsichererKey(key)) {
    return `„${key}“ ist intern belegt (kein __ am Anfang oder Ende, keine Namen wie constructor).`
  }
  return null
}

/**
 * Fachliche Pruefung vor dem Veroeffentlichen. Drafts duerfen Fehler haben
 * (sonst liesse sich ein halb gebautes Formular nicht speichern).
 *
 * `platzhalter`: Variablennamen aus den DOCX-Vorlagen. Platzhalter ohne
 * passenden Key sind nur eine Warnung -- eine Vorlage kann auch eigene
 * Hilfsvariablen aus FOR-Schleifen verwenden.
 *
 * `heute` nur fuer den Vergleich relativer Datumsgrenzen ("+1y" gegen
 * "2027-01-01" haengt vom Tag ab); Tests geben es fest vor.
 */
export function pruefeDefinition(
  def: Definition,
  platzhalter: { vorlage: string; keys: string[] }[] = [],
  heute: string = heuteISO()
): Pruefung {
  const fehler: Problem[] = []
  const warnungen: Problem[] = []
  const ids = new Set<string>()
  const pruefeId = (id: string, wo: Problem) => {
    if (ids.has(id)) fehler.push({ ...wo, text: `Doppelte interne ID ${id}.` })
    ids.add(id)
  }

  /** Alle erzeugten Schluessel der obersten Ebene -> Herkunft. */
  const schluessel = new Map<string, string>()
  const belege = (k: string, herkunft: string, wo: Problem) => {
    const vorher = schluessel.get(k)
    if (vorher) {
      fehler.push({
        ...wo,
        text: `Schlüssel „${k}“ entsteht doppelt (${vorher} / ${herkunft}).`
      })
    } else {
      schluessel.set(k, herkunft)
    }
  }

  if (def.bereiche.length === 0) {
    fehler.push({ text: 'Das Formular braucht mindestens einen Bereich.' })
  }

  /** Regeln und Erinnerung: Syntax und "min ueber max" (gilt auch fuer Spalten). */
  const pruefeRegeln = (f: Feld, wo: Problem) => {
    const r = f.regeln
    if (f.typ === 'date') {
      for (const [was, a] of [
        ['Frühestens', r.minDatum],
        ['Spätestens', r.maxDatum]
      ]) {
        if (!gueltigerDatumAusdruck(a)) {
          fehler.push({
            ...wo,
            text: `${f.label}: „${a}“ (${was}) ist kein Datumsausdruck (heute, +1y, -3m, +14d oder JJJJ-MM-TT; höchstens ${RELATIV_MAX_JAHRE} Jahre).`
          })
        } else if (a && !parseRelativDatum(a, heute)) {
          // Syntaktisch in Ordnung, aber das Ergebnis verlaesst den Bereich
          // 1000..9999 (z. B. `-3000y`) -- die Regel waere dann wirkungslos
          // oder spraeche jedes Datum ab.
          fehler.push({
            ...wo,
            text: `${f.label}: „${a}“ (${was}) ergibt kein gültiges Datum.`
          })
        }
      }
      const min = parseRelativDatum(r.minDatum, heute)
      const max = parseRelativDatum(r.maxDatum, heute)
      if (min && max && min > max) {
        fehler.push({
          ...wo,
          text: `${f.label}: Frühestes Datum (${datumDe(min)}) liegt nach dem spätesten (${datumDe(max)}).`
        })
      }
    }
    if (
      f.typ === 'number' &&
      r.min !== null &&
      r.max !== null &&
      r.min > r.max
    ) {
      fehler.push({ ...wo, text: `${f.label}: Minimum größer als Maximum.` })
    }
    const grenze = textGrenze(f.typ)
    if (grenze) {
      // Der Server kappt bei `grenze` -- eine hoehere Mindestlaenge waere nie
      // erfuellbar und sperrte das Veroeffentlichen dauerhaft.
      if (r.minLaenge > grenze) {
        fehler.push({
          ...wo,
          text: `${f.label}: Mindestlänge darf nicht über ${grenze} Zeichen liegen.`
        })
      } else if (r.maxLaenge && r.minLaenge > r.maxLaenge) {
        fehler.push({
          ...wo,
          text: `${f.label}: Mindestlänge größer als Höchstlänge.`
        })
      }
    }
    const e = f.erinnerung
    if (e.aktiv && e.tageVorher.length === 0 && !e.ueberfaelligWoechentlich) {
      warnungen.push({
        ...wo,
        text: `${f.label}: Erinnerung ist aktiv, aber ohne Zeitpunkt (weder Tage vorher noch überfällig).`
      })
    }
  }

  const pruefeFeld = (
    f: Feld,
    wo: Problem,
    belegeKey: (k: string, herkunft: string, wo: Problem) => void
  ) => {
    pruefeId(f.id, wo)
    if (!f.label.trim()) {
      fehler.push({ ...wo, text: 'Ein Feld hat keine Beschriftung.' })
    }
    if (f.typ === 'info') return
    const keyFehler = pruefeKey(f.key)
    if (keyFehler) {
      fehler.push({ ...wo, text: `${f.label || 'Feld'}: ${keyFehler}` })
    } else {
      belegeKey(f.key, `Feld „${f.label}“`, wo)
    }

    pruefeRegeln(f, wo)

    if (hatOptionen(f.typ)) {
      if (f.optionen.length === 0) {
        fehler.push({ ...wo, text: `${f.label}: keine Auswahloptionen.` })
      }
      const optKeys = new Set<string>()
      for (const o of f.optionen) {
        pruefeId(o.id, wo)
        if (!o.label.trim()) {
          fehler.push({ ...wo, text: `${f.label}: Option ohne Beschriftung.` })
        }
        if (!o.key || !/^[a-zA-Z0-9_]+$/.test(o.key)) {
          fehler.push({
            ...wo,
            text: `${f.label}: Option „${o.label}“ braucht einen Schlüssel aus Buchstaben, Ziffern, _.`
          })
          continue
        }
        if (optKeys.has(o.key)) {
          fehler.push({
            ...wo,
            text: `${f.label}: Optionsschlüssel „${o.key}“ doppelt.`
          })
        }
        optKeys.add(o.key)
        if (f.key && !keyFehler) {
          // Der zusammengesetzte Schluessel ist selbst ein Platzhalter und
          // braucht dieselben Regeln: Feld `meta` + Option `kreis` ergaebe
          // sonst `meta_kreis`, Feld `_` + Option `code__` ergaebe `__code__`.
          const k = `${f.key}_${o.key}`
          const abgeleitetFehler = pruefeKey(k)
          if (abgeleitetFehler) {
            fehler.push({
              ...wo,
              text: `${f.label}: Option „${o.label}“ ergibt ${abgeleitetFehler}`
            })
          } else {
            belegeKey(k, `Option „${o.label}“ von „${f.label}“`, wo)
          }
        }
      }
    }

    if (f.typ === 'gruppe') {
      if (f.felder.length === 0) {
        fehler.push({
          ...wo,
          text: `${f.label}: Die Tabelle hat keine Spalten.`
        })
      }
      // Mehr als GRENZEN.maxZeilen speichert der Server nie. Eine hoehere
      // Mindestanzahl wuerde jeden Kreis dauerhaft am Veroeffentlichen hindern.
      if (f.maxEintraege > GRENZEN.maxZeilen) {
        fehler.push({
          ...wo,
          text: `${f.label}: Höchstanzahl darf nicht über ${GRENZEN.maxZeilen} liegen.`
        })
      }
      if (f.minEintraege > (f.maxEintraege || GRENZEN.maxZeilen)) {
        fehler.push({
          ...wo,
          text: f.maxEintraege
            ? `${f.label}: Mindestanzahl größer als Höchstanzahl.`
            : `${f.label}: Mindestanzahl darf nicht über ${GRENZEN.maxZeilen} liegen.`
        })
      }
      const zeilenKeys = new Map<string, string>()
      for (const sf of f.felder) {
        pruefeFeld(sf, { ...wo, feldId: sf.id }, (k, herkunft, w) => {
          const vorher = zeilenKeys.get(k)
          if (vorher) {
            fehler.push({
              ...w,
              text: `${f.label}: Spaltenschlüssel „${k}“ entsteht doppelt (${vorher} / ${herkunft}).`
            })
          } else {
            zeilenKeys.set(k, herkunft)
          }
        })
      }
    }
  }

  for (const b of def.bereiche) {
    pruefeId(b.id, { bereichId: b.id, text: '' })
    if (!b.titel.trim()) {
      fehler.push({ bereichId: b.id, text: 'Ein Bereich hat keinen Titel.' })
    }
    if (b.abschnitte.length === 0) {
      fehler.push({
        bereichId: b.id,
        text: `Bereich „${b.titel}“ hat keine Abschnitte.`
      })
    }
    for (const a of b.abschnitte) {
      pruefeId(a.id, { bereichId: b.id, abschnittId: a.id, text: '' })
      if (!a.titel.trim()) {
        fehler.push({
          bereichId: b.id,
          abschnittId: a.id,
          text: `Ein Abschnitt in „${b.titel}“ hat keinen Titel.`
        })
      }
      if (a.felder.length === 0) {
        warnungen.push({
          bereichId: b.id,
          abschnittId: a.id,
          text: `Abschnitt „${a.titel}“ hat keine Felder.`
        })
      }
      for (const f of a.felder) {
        pruefeFeld(
          f,
          { bereichId: b.id, abschnittId: a.id, feldId: f.id, text: '' },
          belege
        )
      }
    }
  }

  // Platzhalter-Abgleich: nur Warnungen.
  const bekannt = new Set<string>([...schluessel.keys(), ...META_KEYS])
  const inVorlagen = new Set<string>()
  for (const v of platzhalter) {
    for (const k of v.keys) {
      inVorlagen.add(k)
      if (!bekannt.has(k)) {
        warnungen.push({
          text: `Vorlage „${v.vorlage}“ nutzt „${k}“, das es im Formular nicht gibt (bleibt leer).`
        })
      }
    }
  }
  if (platzhalter.length > 0) {
    for (const f of alleFelder(def)) {
      if (f.typ === 'info' || !f.key || !KEY_RE.test(f.key)) continue
      const genutzt =
        inVorlagen.has(f.key) ||
        f.optionen.some((o) => inVorlagen.has(`${f.key}_${o.key}`))
      if (!genutzt) {
        warnungen.push({
          feldId: f.id,
          text: `„${f.key}“ (${f.label}) kommt in keiner Vorlage vor.`
        })
      }
    }
  }

  return { fehler, warnungen }
}

/* ----------------------------------------------------------- Bereinigen -- */

function bereinigeEinzelwert(f: Feld, v: unknown): Wert {
  switch (f.typ) {
    case 'text':
      return str(v, GRENZEN.textLaenge)
    case 'textarea':
      return str(v, GRENZEN.textareaLaenge)
    case 'number': {
      if (v === '' || v === null || v === undefined) return null
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
    case 'select':
    case 'radio':
      return typeof v === 'string' && f.optionen.some((o) => o.key === v)
        ? v
        : ''
    case 'checkbox':
      return v === true
    default:
      return null
  }
}

/**
 * Schreibt die Werte der gegebenen Felder aus `eingabe` bereinigt nach
 * `ziel`. Unbekannte Schluessel werden ignoriert, falsche Typen werden zu
 * "leer". Liefert `ziel` zurueck.
 */
export function uebernimmWerte(
  felder: Feld[],
  eingabe: any,
  ziel: Daten
): Daten {
  // Unsichere Keys (siehe istUnsichererKey) werden gar nicht geschrieben:
  // pruefeDefinition laesst sie nicht mehr zu, aber Drafts und aeltere
  // Versionen laufen hier ungeprueft durch.
  const setze = (k: string, v: Wert) => {
    if (!istUnsichererKey(k)) ziel[k] = v
  }
  for (const f of felder) {
    if (!hatDaten(f.typ) || !f.key) continue
    if (f.typ === 'multiselect') {
      for (const o of f.optionen) {
        const k = `${f.key}_${o.key}`
        setze(k, eigen(eingabe, k) === true)
      }
    } else if (f.typ === 'gruppe') {
      const roh = eigen(eingabe, f.key)
      const zeilen = Array.isArray(roh) ? roh : []
      setze(
        f.key,
        zeilen
          .slice(
            0,
            Math.min(f.maxEintraege || GRENZEN.maxZeilen, GRENZEN.maxZeilen)
          )
          .map((z: any) => uebernimmWerte(f.felder, z, {}) as Zeile)
      )
    } else {
      setze(f.key, bereinigeEinzelwert(f, eigen(eingabe, f.key)))
    }
  }
  return ziel
}

/** Vollstaendig bereinigte Daten zu einer Definition (nur bekannte Keys). */
export function bereinigeDaten(def: Definition, daten: any): Daten {
  return uebernimmWerte(alleFelder(def), daten, {})
}

/* ------------------------------------------------------------ Migration -- */

/**
 * Ordnet neuen Feldern (bzw. Optionen) die alten zu. Zuerst ueber die stabile
 * ID: wird eine interne Bezeichnung umbenannt, bleiben die Antworten erhalten.
 * Findet sich keine ID, dann ueber den gleichen Key -- der Builder zeigt nur
 * Keys, und wer ein Feld loescht und unter gleichem Namen neu anlegt, erwartet
 * die alten Antworten. Das gilt nur fuer alte Eintraege, deren ID im neuen
 * Formular nicht mehr vorkommt; sonst wuerde ein umbenanntes Feld doppelt
 * vergeben.
 */
function ordneZu<T extends { id: string; key: string }>(
  neue: T[],
  alte: T[]
): Map<T, T> {
  const altNachId = new Map(alte.map((a) => [a.id, a]))
  const neueIds = new Set(neue.map((n) => n.id))
  const vergeben = new Set<T>()
  const zuordnung = new Map<T, T>()
  for (const n of neue) {
    const a = altNachId.get(n.id)
    if (a && !vergeben.has(a)) {
      zuordnung.set(n, a)
      vergeben.add(a)
    }
  }
  for (const n of neue) {
    if (zuordnung.has(n) || !n.key) continue
    const a = alte.find(
      (x) => x.key === n.key && !neueIds.has(x.id) && !vergeben.has(x)
    )
    if (a) {
      zuordnung.set(n, a)
      vergeben.add(a)
    }
  }
  return zuordnung
}

function zahlDe(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v)
    ? // Ohne Tausenderpunkt: eine Jahreszahl 2026 waere sonst "2.026".
      v.toLocaleString('de-DE', {
        useGrouping: false,
        maximumFractionDigits: 10
      })
    : ''
}

/** Die angekreuzten Optionen eines alten Auswahlfelds. */
function gewaehlteOptionen(af: Feld, quelle: any): Option[] {
  if (af.typ === 'multiselect') {
    return af.optionen.filter(
      (o) => eigen(quelle, `${af.key}_${o.key}`) === true
    )
  }
  const v = eigen(quelle, af.key)
  return af.optionen.filter((o) => o.key === v)
}

/**
 * Die alte Antwort als Text, so wie sie auch im PDF stuende. Checkboxen
 * bleiben leer: "nicht angekreuzt" ist nicht dasselbe wie "nein".
 */
function alsText(af: Feld, quelle: any): string {
  const v = eigen(quelle, af.key)
  switch (af.typ) {
    case 'text':
    case 'textarea':
      return typeof v === 'string' ? v : ''
    case 'number':
      return zahlDe(v)
    case 'date':
      return typeof v === 'string' ? datumDe(v) : ''
    case 'select':
    case 'radio':
    case 'multiselect':
      return gewaehlteOptionen(af, quelle)
        .map((o) => o.label)
        .join(', ')
    default:
      return ''
  }
}

/**
 * Welche neuen Optionen entsprechen der alten Antwort? Bei Auswahl -> Auswahl
 * ueber die Options-Zuordnung, bei Text -> Auswahl ueber einen Treffer auf
 * Schluessel oder Beschriftung (ohne Gross-/Kleinschreibung). Fuer eine
 * Mehrfachauswahl darf der Text auch eine Liste sein ("A, B" -- so schreibt
 * alsText sie selbst).
 */
function neueOptionen(nf: Feld, af: Feld, quelle: any): Option[] {
  if (hatOptionen(af.typ)) {
    const alt = new Set(gewaehlteOptionen(af, quelle))
    const zuordnung = ordneZu(nf.optionen, af.optionen)
    return nf.optionen.filter((o) => {
      const a = zuordnung.get(o)
      return !!a && alt.has(a)
    })
  }
  const norm = (s: string) => s.trim().toLowerCase()
  const treffer = (t: string) =>
    nf.optionen.find(
      (o) =>
        norm(o.key) === norm(t) ||
        (!!o.label.trim() && norm(o.label) === norm(t))
    )
  const text = alsText(af, quelle)
  if (!text.trim()) return []
  const ganz = treffer(text)
  if (ganz) return [ganz]
  if (nf.typ !== 'multiselect') return []
  const teile = text.split(/[,;\n]/).map(treffer)
  return nf.optionen.filter((o) => teile.includes(o))
}

/** TT.MM.JJJJ oder JJJJ-MM-TT -> JJJJ-MM-TT, sonst leer. */
function datumIso(s: string): string {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
}

/**
 * Zahl aus einem deutsch geschriebenen Text, sonst null. Ein Punkt ist hier
 * Tausendertrenner, das Komma Dezimaltrenner ("1.500,50" -> 1500.5); nur
 * ohne Komma darf ein einzelner Punkt Dezimaltrenner sein ("1500.50", "1.5").
 * Mehrdeutiges wie "1,500.50" oder "2.000 Personen" wird verworfen -- ein
 * fehlender Wert faellt als Pflichtfeld auf, eine falsche Zahl nicht.
 * Bewusst nicht in bereinigeEinzelwert: der Zahlen-Input der Frontends
 * schickt "1.500" als 1,5 (JavaScript-Schreibweise), dort waere das falsch.
 */
export function zahlAusText(text: string): number | null {
  const t = text.trim()
  let n: number
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    n = Number(t.replace(/\./g, '').replace(',', '.'))
  } else if (/^[+-]?\d+(,\d+)?$/.test(t)) {
    n = Number(t.replace(',', '.'))
  } else if (/^[+-]?\d+\.\d+$/.test(t)) {
    n = Number(t)
  } else {
    return null
  }
  return Number.isFinite(n) ? n : null
}

function umschluesseln(felderNeu: Feld[], felderAlt: Feld[], q: any) {
  const z: Record<string, unknown> = {}
  const setze = (k: string, v: unknown) => {
    if (!istUnsichererKey(k)) z[k] = v
  }
  const zuordnung = ordneZu(felderNeu, felderAlt)
  for (const nf of felderNeu) {
    const af = zuordnung.get(nf)
    if (!af || !af.key || !nf.key || !hatDaten(af.typ)) continue
    switch (nf.typ) {
      case 'text':
      case 'textarea':
        setze(nf.key, alsText(af, q))
        break
      case 'number':
        // Ein Text wird nur uebernommen, wenn er eine (deutsche) Zahl ist.
        setze(
          nf.key,
          af.typ === 'number' ? eigen(q, af.key) : zahlAusText(alsText(af, q))
        )
        break
      case 'date':
        setze(
          nf.key,
          af.typ === 'date' ? eigen(q, af.key) : datumIso(alsText(af, q))
        )
        break
      case 'checkbox':
        if (af.typ === 'checkbox') setze(nf.key, eigen(q, af.key))
        break
      case 'select':
      case 'radio':
        // Mehrfach- -> Einfachauswahl: nur die erste Option passt hinein.
        setze(nf.key, neueOptionen(nf, af, q)[0]?.key ?? '')
        break
      case 'multiselect': {
        const gewaehlt = new Set(neueOptionen(nf, af, q))
        for (const o of nf.optionen) {
          setze(`${nf.key}_${o.key}`, gewaehlt.has(o))
        }
        break
      }
      case 'gruppe': {
        if (af.typ !== 'gruppe') break
        const roh = eigen(q, af.key)
        // Zu viele Zeilen (maxEintraege gesenkt) kuerzt bereinigeDaten auf
        // die neue Hoechstzahl; die ersten Eintraege bleiben erhalten.
        setze(
          nf.key,
          (Array.isArray(roh) ? roh : []).map((zeile: any) =>
            umschluesseln(nf.felder, af.felder, zeile)
          )
        )
        break
      }
    }
  }
  return z
}

/**
 * Uebertraegt Daten von einer Formularversion auf eine andere.
 *
 * Felder und Optionen werden per ID, ersatzweise per Key zugeordnet (siehe
 * ordneZu). Bei geaenderten Typen wird umgewandelt, soweit das ohne Raten
 * geht: Zahl/Datum/Auswahl -> Text wie im PDF, Text -> Zahl/Datum wenn er
 * eine(s) ist, Text -> Auswahl bei Treffer auf Schluessel oder Beschriftung.
 * Entfernte Felder und Optionen fallen weg. Ein Feld, das zwischen oberster
 * Ebene und Tabellenspalte wandert, wird nicht uebernommen.
 */
export function migriereDaten(
  alt: Definition,
  neu: Definition,
  daten: any
): Daten {
  return bereinigeDaten(
    neu,
    umschluesseln(alleFelder(neu), alleFelder(alt), daten)
  )
}

/* ---------------------------------------------- Ausgefuellt / Fortschritt -- */

function istLeer(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  )
}

/** Ist ein Feld (oberste Ebene oder Spalte in einer Zeile) beantwortet? */
export function istAusgefuellt(f: Feld, daten: any): boolean {
  const q = daten && typeof daten === 'object' ? daten : {}
  switch (f.typ) {
    case 'info':
      return true
    case 'checkbox':
      // Pflicht-Checkbox = Zustimmung: nur angekreuzt zaehlt. Eine freiwillige
      // Checkbox ist mit "nein" genauso beantwortet wie mit "ja".
      return f.pflicht
        ? eigen(q, f.key) === true
        : typeof eigen(q, f.key) === 'boolean'
    case 'multiselect':
      return f.optionen.some((o) => eigen(q, `${f.key}_${o.key}`) === true)
    case 'gruppe': {
      const roh = eigen(q, f.key)
      const zeilen = Array.isArray(roh) ? roh : []
      // Dieselbe Untergrenze wie fehlendePflichtfelder: eine freiwillige,
      // leere Tabelle ("Weitere Raeume, falls vorhanden") ist beantwortet,
      // sonst erreicht der Fortschritt nie 100 %.
      if (zeilen.length < Math.max(f.pflicht ? 1 : 0, f.minEintraege)) {
        return false
      }
      return zeilen.every((z: any) =>
        f.felder.every((sf) => !sf.pflicht || istAusgefuellt(sf, z))
      )
    }
    default:
      return !istLeer(eigen(q, f.key))
  }
}

export interface Fehlend {
  bereichId: string
  abschnittId: string
  feldId: string
  label: string
  /** Bei Tabellen: 1-basierte Zeile und Spalte, falls es an einer Zeile liegt. */
  zeile?: number
  spalte?: string
}

/** Unausgefuellte Pflichtfelder -- die Sperre vor dem Veroeffentlichen. */
export function fehlendePflichtfelder(def: Definition, daten: any): Fehlend[] {
  const q = daten && typeof daten === 'object' ? daten : {}
  const out: Fehlend[] = []
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) {
      for (const f of a.felder) {
        const wo = {
          bereichId: b.id,
          abschnittId: a.id,
          feldId: f.id,
          label: f.label
        }
        if (f.typ === 'gruppe') {
          const roh = eigen(q, f.key)
          const zeilen: any[] = Array.isArray(roh) ? roh : []
          const min = f.pflicht ? Math.max(1, f.minEintraege) : f.minEintraege
          if (zeilen.length < min) {
            out.push({
              ...wo,
              label: `${f.label}: mindestens ${min} ${f.eintragLabel || 'Eintrag'}${min > 1 ? '/Einträge' : ''}`
            })
          }
          zeilen.forEach((z: any, i: number) => {
            for (const sf of f.felder) {
              if (sf.pflicht && !istAusgefuellt(sf, z)) {
                out.push({
                  ...wo,
                  zeile: i + 1,
                  spalte: sf.label,
                  label: `${f.label}, ${f.eintragLabel || 'Eintrag'} ${i + 1}: ${sf.label}`
                })
              }
            }
          })
        } else if (f.pflicht && !istAusgefuellt(f, q)) {
          out.push(wo)
        }
      }
    }
  }
  return out
}

/**
 * Fortschritt in Prozent. Jedes Feld mit Daten zaehlt, Pflichtfelder doppelt.
 * 100 gibt es nur, wenn wirklich alles beantwortet ist (abrunden).
 */
export function fortschritt(
  def: Pick<Definition, 'bereiche'>,
  daten: any
): number {
  let gesamt = 0
  let erreicht = 0
  for (const f of alleFelder(def)) {
    if (!hatDaten(f.typ)) continue
    const gewicht = f.pflicht ? 2 : 1
    gesamt += gewicht
    if (istAusgefuellt(f, daten)) erreicht += gewicht
  }
  return gesamt === 0 ? 0 : Math.floor((erreicht / gesamt) * 100)
}

/** Fortschritt eines einzelnen Bereichs (fuer den Stepper). */
export function fortschrittBereich(b: Bereich, daten: any): number {
  return fortschritt({ bereiche: [b] }, daten)
}

/* --------------------------------------------------------------- Regeln -- */

/** Regeln eines Felds mit aufgeloesten Datumsgrenzen (min/max am Datums-Input). */
export interface RegelGrenzen {
  minDatum: string | null
  maxDatum: string | null
  min: number | null
  max: number | null
  minLaenge: number
  maxLaenge: number
}

const KEINE_REGELN: Regeln = {
  minDatum: '',
  maxDatum: '',
  min: null,
  max: null,
  minLaenge: 0,
  maxLaenge: 0
}

export function aufgeloesteRegeln(f: Feld, heute: string): RegelGrenzen {
  // `|| KEINE_REGELN`: ein im Builder frisch angelegtes Feld kann noch ohne
  // Normalisierung hier ankommen.
  const r = f.regeln || KEINE_REGELN
  return {
    minDatum: parseRelativDatum(r.minDatum, heute),
    maxDatum: parseRelativDatum(r.maxDatum, heute),
    min: r.min,
    max: r.max,
    minLaenge: r.minLaenge,
    maxLaenge: r.maxLaenge
  }
}

/**
 * Verstoesst ein gesetzter Wert gegen die Regeln des Felds? Text der
 * Meldung oder null. Leere Werte sind nie ein Verstoss -- ob etwas fehlen
 * darf, entscheidet allein `pflicht`.
 */
export function regelVerstoss(
  f: Feld,
  wert: unknown,
  heute: string
): string | null {
  const g = aufgeloesteRegeln(f, heute)
  switch (f.typ) {
    case 'date': {
      if (typeof wert !== 'string' || !wert) return null
      if (g.minDatum && wert < g.minDatum) {
        return `Das Datum darf nicht vor dem ${datumDe(g.minDatum)} liegen.`
      }
      if (g.maxDatum && wert > g.maxDatum) {
        return `Das Datum darf nicht nach dem ${datumDe(g.maxDatum)} liegen.`
      }
      return null
    }
    case 'number': {
      if (typeof wert !== 'number' || !Number.isFinite(wert)) return null
      if (g.min !== null && wert < g.min) return `Mindestens ${zahlDe(g.min)}.`
      if (g.max !== null && wert > g.max) return `Höchstens ${zahlDe(g.max)}.`
      return null
    }
    case 'text':
    case 'textarea': {
      if (typeof wert !== 'string' || wert.trim() === '') return null
      // Zaehlen, was der Server speichert: bereinigeDaten wirft Steuerzeichen
      // vorher raus, sonst meldet der Client "(bisher 4)" und der Server 3.
      const n = bereinigeText(wert).length
      if (g.minLaenge && n < g.minLaenge) {
        return `Mindestens ${g.minLaenge} Zeichen (bisher ${n}).`
      }
      if (g.maxLaenge && n > g.maxLaenge) {
        return `Höchstens ${g.maxLaenge} Zeichen (bisher ${n}).`
      }
      return null
    }
    default:
      return null
  }
}

/** Kurzer Hinweis unter dem Feld ("Zwischen 01.01.2026 und 31.12.2026"), leer ohne Regel. */
export function regelHinweis(f: Feld, heute: string): string {
  const g = aufgeloesteRegeln(f, heute)
  const spanne = (
    von: string | null,
    bis: string | null,
    einheit: string
  ): string => {
    if (von !== null && bis !== null)
      return `Zwischen ${von} und ${bis}${einheit}`
    if (von !== null) return `Mindestens ${von}${einheit}`
    if (bis !== null) return `Höchstens ${bis}${einheit}`
    return ''
  }
  switch (f.typ) {
    case 'date':
      if (g.minDatum && g.maxDatum) {
        return `Zwischen ${datumDe(g.minDatum)} und ${datumDe(g.maxDatum)}`
      }
      if (g.minDatum) return `Frühestens ${datumDe(g.minDatum)}`
      if (g.maxDatum) return `Spätestens ${datumDe(g.maxDatum)}`
      return ''
    case 'number':
      return spanne(
        g.min === null ? null : zahlDe(g.min),
        g.max === null ? null : zahlDe(g.max),
        ''
      )
    case 'text':
    case 'textarea':
      return spanne(
        g.minLaenge ? String(g.minLaenge) : null,
        g.maxLaenge ? String(g.maxLaenge) : null,
        ' Zeichen'
      )
    default:
      return ''
  }
}

export interface Verstoss extends Fehlend {
  text: string
}

/**
 * Alle Regelverstoesse in den Daten, wie fehlendePflichtfelder aufgebaut --
 * die zweite Sperre vor dem Veroeffentlichen. Tabellenzeilen inklusive.
 */
export function regelVerstoesse(
  def: Definition,
  daten: any,
  heute: string
): Verstoss[] {
  const q = daten && typeof daten === 'object' ? daten : {}
  const out: Verstoss[] = []
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) {
      for (const f of a.felder) {
        const wo = {
          bereichId: b.id,
          abschnittId: a.id,
          feldId: f.id,
          label: f.label
        }
        if (f.typ === 'gruppe') {
          const roh = eigen(q, f.key)
          const zeilen: any[] = Array.isArray(roh) ? roh : []
          zeilen.forEach((z: any, i: number) => {
            for (const sf of f.felder) {
              const text = regelVerstoss(sf, eigen(z, sf.key), heute)
              if (text) {
                out.push({
                  ...wo,
                  zeile: i + 1,
                  spalte: sf.label,
                  label: `${f.label}, ${f.eintragLabel || 'Eintrag'} ${i + 1}: ${sf.label}`,
                  text
                })
              }
            }
          })
        } else {
          const text = regelVerstoss(f, eigen(q, f.key), heute)
          if (text) out.push({ ...wo, text })
        }
      }
    }
  }
  return out
}

/* ----------------------------------------------------------- Erinnerung -- */

export interface ErinnerungsTermin {
  /**
   * Feld-Key; bei Tabellenspalten `${tabelle.key}.${spalte.key}` -- ein Punkt
   * kommt in Keys nicht vor, der Name ist also eindeutig.
   */
  feldKey: string
  /** Nur bei Tabellen: 1-basierte Zeile. */
  zeile?: number
  bereichId: string
  abschnittId: string
  feldId: string
  /** Titel des Abschnitts -- damit "Veraenderung bis zum" in Listen und Mails einen Bezug hat. */
  abschnitt: string
  label: string
  datumISO: string
  tageVorher: number[]
  ueberfaelligWoechentlich: boolean
}

/**
 * Alle Datumsfelder mit aktiver Erinnerung und gesetztem Datum, auch in
 * Tabellenzeilen. Grundlage fuer den taeglichen Job und die Portal-Anzeige
 * "anstehende Termine".
 */
export function erinnerungsTermine(
  def: Definition,
  daten: any
): ErinnerungsTermin[] {
  const q = daten && typeof daten === 'object' ? daten : {}
  const out: ErinnerungsTermin[] = []
  const termin = (
    f: Feld,
    wert: unknown,
    basis: Omit<
      ErinnerungsTermin,
      'datumISO' | 'tageVorher' | 'ueberfaelligWoechentlich'
    >
  ) => {
    const e = f.erinnerung
    if (f.typ !== 'date' || !e?.aktiv || !gueltigesIsoDatum(wert)) return
    out.push({
      ...basis,
      datumISO: wert,
      tageVorher: [...e.tageVorher],
      ueberfaelligWoechentlich: e.ueberfaelligWoechentlich
    })
  }
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) {
      for (const f of a.felder) {
        const wo = {
          bereichId: b.id,
          abschnittId: a.id,
          feldId: f.id,
          abschnitt: a.titel
        }
        if (f.typ === 'gruppe') {
          const roh = eigen(q, f.key)
          const zeilen: any[] = Array.isArray(roh) ? roh : []
          zeilen.forEach((z: any, i: number) => {
            for (const sf of f.felder) {
              termin(sf, eigen(z, sf.key), {
                ...wo,
                feldId: sf.id,
                feldKey: `${f.key}.${sf.key}`,
                zeile: i + 1,
                label: `${f.label}, ${f.eintragLabel || 'Eintrag'} ${i + 1}: ${sf.label}`
              })
            }
          })
        } else {
          termin(f, eigen(q, f.key), { ...wo, feldKey: f.key, label: f.label })
        }
      }
    }
  }
  return out
}

/* --------------------------------------------- Abschnitte bestaetigen -- */

/** JSON mit sortierten Schluesseln -- gleicher Inhalt, gleicher String. */
export function stabilesJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabilesJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabilesJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/**
 * Nur die Werte dieses Abschnitts als flaches Teilobjekt (inklusive
 * Options-Flags und Tabellen), bereinigt -- damit "1" und 1 oder ein
 * fehlender und ein leerer Wert nicht als Aenderung zaehlen.
 */
export function abschnittsWerte(a: Abschnitt, daten: any): Daten {
  return uebernimmWerte(a.felder, daten, {})
}

/**
 * Stabiler Fingerabdruck der Werte eines Abschnitts. Server und Client
 * vergleichen damit, ob sich ein bestaetigter Abschnitt seit der
 * Bestaetigung geaendert hat. Keine Kryptographie noetig: es geht um
 * Gleichheit, nicht um Geheimhaltung.
 */
export function abschnittsHash(a: Abschnitt, daten: any): string {
  return stabilesJson(abschnittsWerte(a, daten))
}

export interface AbschnittRef {
  bereichId: string
  abschnittId: string
  titel: string
}

/** Abschnitt-IDs aus beliebiger Eingabe: nur bekannte, in Formular-Reihenfolge. */
export function bereinigeBestaetigt(def: Definition, roh: unknown): string[] {
  const ids = new Set<string>(
    Array.isArray(roh) ? roh.filter((x) => typeof x === 'string') : []
  )
  const out: string[] = []
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) if (ids.has(a.id)) out.push(a.id)
  }
  return out
}

/**
 * Noch nicht bestaetigte Abschnitte -- die dritte Sperre vor dem
 * Veroeffentlichen. Leer, wenn die Einstellung aus ist. Auch reine
 * Info-Abschnitte (Verhaltenskodex) zaehlen: gelesen und bestaetigt.
 */
export function unbestaetigteAbschnitte(
  def: Definition,
  bestaetigt: string[]
): AbschnittRef[] {
  if (!def.einstellungen?.abschnitteBestaetigen) return []
  const ok = new Set(bestaetigt)
  const out: AbschnittRef[] = []
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) {
      if (!ok.has(a.id)) {
        out.push({ bereichId: b.id, abschnittId: a.id, titel: a.titel })
      }
    }
  }
  return out
}

/**
 * Bestaetigungen nach einem Speichern: bisherige bleiben nur, wenn sich
 * die Werte des Abschnitts nicht geaendert haben; was der Request jetzt
 * bestaetigt, kommt dazu. Unbekannte IDs fallen weg. Ergebnis in
 * Formular-Reihenfolge.
 */
export function aktualisiereBestaetigungen(
  def: Definition,
  bisher: string[],
  datenVorher: any,
  datenNachher: any,
  jetztBestaetigt: string[]
): string[] {
  const alt = new Set(bisher)
  const neu = new Set(jetztBestaetigt)
  const out: string[] = []
  for (const b of def.bereiche) {
    for (const a of b.abschnitte) {
      if (
        neu.has(a.id) ||
        (alt.has(a.id) &&
          abschnittsHash(a, datenVorher) === abschnittsHash(a, datenNachher))
      ) {
        out.push(a.id)
      }
    }
  }
  return out
}

/* ----------------------------------------------------------- DOCX-Daten -- */

function datumDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function ausgabe(felder: Feld[], q: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // Unsichere Keys duerfen nie in den Sandbox-Kontext von docx-templates
  // (`__code__` wuerde den auszufuehrenden Code ersetzen). Texte aus der
  // Definition (Labels, wertAn) werden hier nochmals XML-tauglich gemacht,
  // weil aeltere gespeicherte Definitionen ungefiltert sein koennen.
  const setze = (k: string, v: unknown) => {
    if (!istUnsichererKey(k)) {
      out[k] = typeof v === 'string' ? bereinigeText(v) : v
    }
  }
  for (const f of felder) {
    if (!hatDaten(f.typ) || !f.key) continue
    const v = eigen(q, f.key)
    switch (f.typ) {
      case 'checkbox':
        setze(f.key, v === true ? f.wertAn : f.wertAus)
        break
      case 'date':
        setze(f.key, typeof v === 'string' ? datumDe(v) : '')
        break
      case 'number':
        setze(f.key, zahlDe(v))
        break
      case 'select':
      case 'radio':
        setze(f.key, f.optionen.find((o) => o.key === v)?.label ?? '')
        for (const o of f.optionen) {
          setze(`${f.key}_${o.key}`, v === o.key ? f.wertAn : f.wertAus)
        }
        break
      case 'multiselect': {
        const an = (o: Option) => eigen(q, `${f.key}_${o.key}`) === true
        setze(
          f.key,
          f.optionen
            .filter(an)
            .map((o) => o.label)
            .join(', ')
        )
        for (const o of f.optionen) {
          setze(`${f.key}_${o.key}`, an(o) ? f.wertAn : f.wertAus)
        }
        break
      }
      case 'gruppe':
        setze(
          f.key,
          (Array.isArray(v) ? v : []).map((z) => ausgabe(f.felder, z))
        )
        break
      default:
        setze(f.key, typeof v === 'string' ? v : '')
    }
  }
  return out
}

export interface DocxMeta {
  kreis: string
  standVersion: number | null
  formularVersion: number
  /** TT.MM.JJJJ */
  datum: string
  entwurf: boolean
}

/** Daten fuer docx-templates: gleiche Schluessel, Ausgabewerte, flach. */
export function docxDaten(
  def: Definition,
  daten: any,
  meta: DocxMeta
): Record<string, unknown> {
  return {
    ...ausgabe(alleFelder(def), bereinigeDaten(def, daten)),
    meta_kreis: bereinigeText(String(meta.kreis ?? '')),
    meta_stand_version:
      meta.standVersion === null ? '' : String(meta.standVersion),
    meta_formular_version: String(meta.formularVersion),
    meta_datum: meta.datum,
    meta_entwurf: meta.entwurf ? 'ENTWURF' : ''
  }
}

/** Beispieldaten fuer das Test-PDF im Builder. */
export function beispielDaten(def: Definition): Daten {
  const fuelle = (felder: Feld[], nr: number): Daten => {
    const d: Daten = {}
    for (const f of felder) {
      if (!hatDaten(f.typ) || !f.key) continue
      switch (f.typ) {
        case 'text':
          d[f.key] = nr ? `${f.label} ${nr}` : f.label
          break
        case 'textarea':
          d[f.key] = `${f.label}\nZweite Zeile Beispieltext.`
          break
        case 'number':
          d[f.key] = 12 + nr
          break
        case 'date':
          d[f.key] = '2026-09-13'
          break
        case 'select':
        case 'radio':
          d[f.key] = f.optionen[nr % Math.max(1, f.optionen.length)]?.key ?? ''
          break
        case 'multiselect':
          f.optionen.forEach(
            (o, i) => (d[`${f.key}_${o.key}`] = i % 2 === nr % 2)
          )
          break
        case 'checkbox':
          d[f.key] = nr % 2 === 0
          break
        case 'gruppe':
          d[f.key] = [1, 2, 3].map((i) => fuelle(f.felder, i) as Zeile)
          break
      }
    }
    return d
  }
  return fuelle(alleFelder(def), 0)
}
