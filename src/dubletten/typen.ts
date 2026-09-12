/** Gemeinsame Typen der Dubletten-Erkennung. */

/** Eine Person, wie sie aus der Datenbank kommt. */
export interface PersonRoh {
  personID: number
  vorname: string
  nachname: string
  /** Bereits als 'YYYY-MM-DD' formatiert (DATE_FORMAT, nicht toISOString). */
  gebDatISO: string
  geschlecht: 'm' | 'w'
  ecKreis: number | null
  ecMitglied: number
  erstellt: Date | string | null
}

/**
 * Vorbereitete Person fuer den Paar-Vergleich.
 *
 * Alles, was im heissen Pfad gebraucht wird, liegt hier schon als Zahl vor --
 * bei 2,39 Mio Paaren ist der Unterschied zwischen Integer- und
 * String-Vergleich deutlich, und Normalisieren pro Paar waere sinnlose
 * Wiederholung.
 */
export interface PersonNorm {
  personID: number
  roh: PersonRoh

  vorNorm: string
  nachNorm: string
  vorId: number
  nachId: number
  vorLen: number
  nachLen: number

  /** Vornamen-Tokens ("anna maria" -> ["anna","maria"]). */
  vorTokens: string[]
  /** Erstes Vornamen-Token = Rufname. */
  vorHaupt: string
  /** Sortierte Token-IDs, fuer den Reihenfolge-unabhaengigen Vergleich. */
  vorTokenIds: number[]

  gebY: number
  gebM: number
  gebD: number

  mailIds: Set<number>
  telIds: Set<number>
  adrIds: Set<number>

  geschlecht: 'm' | 'w'
}

/** Ein Grund, warum ein Paar vorgeschlagen wird (oder schlechter bewertet ist). */
export interface Grund {
  /** Maschinenlesbar und stabil, z. B. 'name.tippfehler'. */
  code: string
  /** Klartext mit den konkreten Werten, fuer die Oberflaeche. */
  text: string
  /** Beitrag zum Score, auch negativ. */
  punkte: number
  feld?:
    | 'vorname'
    | 'nachname'
    | 'name'
    | 'gebDat'
    | 'email'
    | 'telefon'
    | 'adresse'
    | 'geschlecht'
}

export type Stufe = 'hoch' | 'mittel' | 'niedrig'

/** Kurzform einer Person fuer die Listenanzeige. */
export interface PersonKurz {
  personID: number
  vorname: string
  nachname: string
  gebDat: string
  geschlecht: 'm' | 'w'
  ecKreis: number | null
  emails: string[]
  telefone: string[]
  adresse: string | null
  erstellt: string | null
}

/** Ein Kandidatenpaar, wie die API es ausliefert. */
export interface Kandidat {
  /** Immer die kleinere der beiden IDs. */
  personID_1: number
  /** Immer die groessere der beiden IDs. */
  personID_2: number
  score: number
  stufe: Stufe
  gruende: Grund[]
  /** Vorschlag, welcher Satz bleiben sollte (kein Automatismus). */
  vorschlagBehalten: number
  begruendungBehalten: string
  person_1: PersonKurz
  person_2: PersonKurz
}
