import { queryP } from '../helpers/mysql'
import {
  Intern,
  normAdresse,
  normEmail,
  normName,
  normTelefon,
  tokens
} from './normalisieren'
import {
  begruende,
  istKandidat,
  leererBefund,
  pruefe,
  stufeFuer
} from './regeln'
import { paarKey } from './keine'
import type { Kandidat, PersonKurz, PersonNorm, PersonRoh } from './typen'

/**
 * Dubletten-Erkennung: vergleicht jede Person mit jeder anderen.
 *
 * Bewusst OHNE Blocking (Vorfilterung in Gruppen). Bei 2188 Personen sind das
 * 2.392.578 Paare; mit den gestaffelten Pruefungen in regeln.ts liegt ein Lauf
 * im Bereich einer Sekunde. Eine Bucket-Heuristik wuerde genau die Faelle
 * verlieren, um die es hier geht: vertauschte Namen sprengen jedes
 * Nachnamen-Bucket, ein Zahlendreher im Jahr jedes Geburtsdatums-Bucket.
 *
 * WO DER ANSATZ KIPPT: der Aufwand waechst quadratisch. 5.000 Personen sind
 * ~12,5 Mio Paare (noch vertretbar hinter dem Cache), 10.000 schon ~50 Mio
 * (~10-25 s). Ab etwa 15.000 Personen braucht es einen Vorfilter -- am besten
 * in SQL (Selfjoin ueber eMails/telefone plus Nachnamen-Gleichheit plus
 * Praefix-Bucket) mit Feinvergleich nur auf der Treffermenge. Bis dahin ist
 * genau das der Grund, warum es den Cache gibt: die Berechnung darf nicht bei
 * jedem Seitenaufruf laufen.
 */

/** Obergrenze der Ergebnisliste, damit ein kaputter Datenbestand nicht den Heap sprengt. */
export const MAX_PAARE = 2000

/** Nach so vielen Personen wird der Event-Loop freigegeben. */
const SCHEIBE = 64

export interface ErkennungsErgebnis {
  paare: Kandidat[]
  anzahlPersonen: number
  dauerMs: number
  abgeschnitten: boolean
}

interface Kontakte {
  mails: Map<number, Set<number>>
  tele: Map<number, Set<number>>
  adressen: Map<number, Set<number>>
  /** personID -> Klartextwerte, fuer die Anzeige in der Liste. */
  mailText: Map<number, string[]>
  telText: Map<number, string[]>
  adrText: Map<number, string>
}

/**
 * Laedt alles, was fuer die Erkennung gebraucht wird.
 *
 * `queryP` statt `query`: letzteres schreibt jedes Statement samt Werten auf
 * stdout, und hier gehen Namen, Geburtsdaten, Mailadressen und Telefonnummern
 * durch -- das haette im Container-Log weder Aufbewahrungsgrenze noch
 * Zugriffsschutz.
 *
 * gebDat kommt als DATE_FORMAT-String und nicht als Date: ein `Date` aus
 * MySQL wird von Node als lokale Zeit gelesen, obwohl der Server in UTC laeuft --
 * `toISOString()` verschiebt den Tag dann um eins. Bei einem Geburtsdatum ist
 * das genau die Art Fehler, die eine Dublette erzeugt statt sie zu finden.
 */
async function lade(): Promise<{
  personen: PersonRoh[]
  kontakte: Kontakte
  ignoriert: Set<string>
}> {
  const personen = await queryP<PersonRoh>(
    `SELECT personID, vorname, nachname,
            DATE_FORMAT(gebDat, '%Y-%m-%d') AS gebDatISO,
            geschlecht, ecKreis, ecMitglied, erstellt
       FROM personen
      WHERE anonymisiert = 0`
  )

  const [mails, tele, adressen] = await Promise.all([
    queryP<{ personID: number; eMail: string }>(
      'SELECT personID, eMail FROM eMails'
    ),
    queryP<{ personID: number; telefon: string }>(
      'SELECT personID, telefon FROM telefone'
    ),
    queryP<{
      personID: number
      strasse: string
      plz: string
      ort: string
      isOld: number
    }>('SELECT personID, strasse, plz, ort, isOld FROM adressen')
  ])

  const keine = await queryP<{ personID_1: number; personID_2: number }>(
    'SELECT personID_1, personID_2 FROM keinedublikate'
  )

  // Jede Zeile durch paarKey(): die Tabelle existierte lange ohne schreibenden
  // Code und kann Altbestand in beliebiger Reihenfolge enthalten. Wer hier nur
  // `${p1}:${p2}` bildet, filtert verdrehte Zeilen nicht und schlaegt dem
  // Anwender ein Paar vor, das er schon abgelehnt hat.
  const ignoriert = new Set<string>()
  for (const z of keine) ignoriert.add(paarKey(z.personID_1, z.personID_2).key)

  const internMail = new Intern()
  const internTel = new Intern()
  const internAdr = new Intern()

  const k: Kontakte = {
    mails: new Map(),
    tele: new Map(),
    adressen: new Map(),
    mailText: new Map(),
    telText: new Map(),
    adrText: new Map()
  }

  for (const m of mails) {
    const norm = normEmail(m.eMail)
    if (!norm) continue
    eintragen(k.mails, m.personID, internMail.id(norm))
    const liste = k.mailText.get(m.personID) ?? []
    if (!liste.includes(m.eMail)) liste.push(m.eMail)
    k.mailText.set(m.personID, liste)
  }

  for (const t of tele) {
    const norm = normTelefon(t.telefon)
    if (!norm) continue
    eintragen(k.tele, t.personID, internTel.id(norm))
    const liste = k.telText.get(t.personID) ?? []
    if (!liste.includes(t.telefon)) liste.push(t.telefon)
    k.telText.set(t.personID, liste)
  }

  for (const a of adressen) {
    const norm = normAdresse(a.strasse, a.plz, a.ort)
    if (!norm) continue
    eintragen(k.adressen, a.personID, internAdr.id(norm))
    // Fuer die Anzeige die aktuelle Adresse bevorzugen.
    if (!k.adrText.has(a.personID) || a.isOld === 0) {
      k.adrText.set(a.personID, `${a.strasse}, ${a.plz} ${a.ort}`)
    }
  }

  return { personen, kontakte: k, ignoriert }
}

function eintragen(m: Map<number, Set<number>>, id: number, wert: number) {
  const s = m.get(id)
  if (s) s.add(wert)
  else m.set(id, new Set([wert]))
}

const LEER: Set<number> = new Set()

function vorbereiten(personen: PersonRoh[], kontakte: Kontakte): PersonNorm[] {
  const internVor = new Intern()
  const internNach = new Intern()
  const internToken = new Intern()

  return personen.map((p) => {
    const vorNorm = normName(p.vorname)
    const nachNorm = normName(p.nachname)
    const vorTokens = tokens(p.vorname)
    const [y, m, d] = p.gebDatISO.split('-').map((v) => parseInt(v, 10))

    return {
      personID: p.personID,
      roh: p,
      vorNorm,
      nachNorm,
      vorId: internVor.id(vorNorm),
      nachId: internNach.id(nachNorm),
      vorLen: vorNorm.length,
      nachLen: nachNorm.length,
      vorTokens,
      vorHaupt: vorTokens[0] ?? '',
      vorTokenIds: vorTokens
        .map((t) => internToken.id(t))
        .sort((a, b) => a - b),
      gebY: y || 0,
      gebM: m || 0,
      gebD: d || 0,
      mailIds: kontakte.mails.get(p.personID) ?? LEER,
      telIds: kontakte.tele.get(p.personID) ?? LEER,
      adrIds: kontakte.adressen.get(p.personID) ?? LEER,
      geschlecht: p.geschlecht
    }
  })
}

function kurz(p: PersonNorm, kontakte: Kontakte): PersonKurz {
  return {
    personID: p.personID,
    vorname: p.roh.vorname,
    nachname: p.roh.nachname,
    gebDat: p.roh.gebDatISO,
    geschlecht: p.geschlecht,
    ecKreis: p.roh.ecKreis,
    emails: kontakte.mailText.get(p.personID) ?? [],
    telefone: kontakte.telText.get(p.personID) ?? [],
    adresse: kontakte.adrText.get(p.personID) ?? null,
    erstellt: alsText(p.roh.erstellt)
  }
}

function alsText(v: Date | string | null): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

/**
 * Welcher Satz sollte bleiben? Nur ein Vorschlag -- entscheiden muss ein Mensch.
 *
 * Der wichtigste Punkt ist der erste: haengt an einem Satz ein Verwaltungs- oder
 * Portal-Zugang, muss dieser bleiben, sonst zeigt ein Login nach dem Merge auf
 * eine geloeschte Person.
 */
function vorschlag(
  a: PersonNorm,
  b: PersonNorm,
  zugaenge: Set<number>,
  gewicht: Map<number, number>
): { id: number; text: string } {
  const zA = zugaenge.has(a.personID)
  const zB = zugaenge.has(b.personID)
  if (zA !== zB) {
    const sieger = zA ? a : b
    return {
      id: sieger.personID,
      text: `Datensatz ${sieger.personID} hat einen Zugang (Verwaltung oder Portal) – der muss bestehen bleiben.`
    }
  }

  const gA = gewicht.get(a.personID) ?? 0
  const gB = gewicht.get(b.personID) ?? 0
  if (gA !== gB) {
    const sieger = gA > gB ? a : b
    return {
      id: sieger.personID,
      text: `Datensatz ${sieger.personID} hat mehr verknüpfte Daten (${Math.max(gA, gB)} gegenüber ${Math.min(gA, gB)}).`
    }
  }

  const eA = a.roh.erstellt ? new Date(a.roh.erstellt).getTime() : Infinity
  const eB = b.roh.erstellt ? new Date(b.roh.erstellt).getTime() : Infinity
  if (eA !== eB) {
    const sieger = eA < eB ? a : b
    return {
      id: sieger.personID,
      text: `Datensatz ${sieger.personID} ist der ältere der beiden.`
    }
  }

  const sieger = a.personID < b.personID ? a : b
  return {
    id: sieger.personID,
    text: `Kein Unterschied erkennbar – Vorschlag ist die kleinere ID (${sieger.personID}).`
  }
}

/**
 * Zaehlt je Person, wie viele Datensaetze auf sie verweisen. Eine Query pro
 * Tabelle mit GROUP BY statt einer pro Person -- bei 2188 Personen waere
 * letzteres das klassische N+1.
 */
async function ladeGewichte(): Promise<{
  gewicht: Map<number, number>
  zugaenge: Set<number>
}> {
  const gewicht = new Map<number, number>()
  const addiere = (rows: Array<{ personID: number; n: number }>) => {
    for (const r of rows) {
      gewicht.set(r.personID, (gewicht.get(r.personID) ?? 0) + Number(r.n))
    }
  }

  const tabellen = [
    'anmeldungen',
    'adressen',
    'eMails',
    'telefone',
    'fz',
    'fzAntrag',
    'juleica',
    'tagsPersonen',
    'akPerson'
  ]
  for (const t of tabellen) {
    addiere(
      await queryP<{ personID: number; n: number }>(
        `SELECT personID, COUNT(*) n FROM \`${t}\` GROUP BY personID`
      )
    )
  }

  const zugaenge = new Set<number>()
  for (const r of await queryP<{ person_id: number }>(
    'SELECT DISTINCT person_id FROM users'
  )) {
    zugaenge.add(r.person_id)
  }
  // portalUser kommt erst mit sql/portal-schema.sql; fehlt die Tabelle, ist das
  // kein Fehler, sondern nur ein Signal weniger fuer den Vorschlag.
  try {
    for (const r of await queryP<{ personID: number }>(
      'SELECT DISTINCT personID FROM portalUser'
    )) {
      zugaenge.add(r.personID)
    }
  } catch {
    /* Tabelle nicht vorhanden -- Vorschlag faellt auf die naechste Regel zurueck */
  }

  return { gewicht, zugaenge }
}

/**
 * Fuehrt einen vollstaendigen Erkennungslauf durch.
 */
export async function erkenne(): Promise<ErkennungsErgebnis> {
  const start = Date.now()
  const { personen, kontakte, ignoriert } = await lade()
  const { gewicht, zugaenge } = await ladeGewichte()
  const liste = vorbereiten(personen, kontakte)

  const treffer: Array<{ a: PersonNorm; b: PersonNorm; score: number }> = []
  const befund = leererBefund()
  let abgeschnitten = false

  for (let i = 0; i < liste.length; i++) {
    const a = liste[i]
    for (let j = i + 1; j < liste.length; j++) {
      const b = liste[j]
      pruefe(a, b, befund)
      if (!istKandidat(befund)) continue
      if (ignoriert.has(paarKey(a.personID, b.personID).key)) continue

      treffer.push({ a, b, score: befund.score })
      if (treffer.length > MAX_PAARE * 2) {
        // Nicht weiterlaufen lassen: bei einem kaputten Import (etwa 1000 Mal
        // derselbe Name) waere die Liste ohnehin unbrauchbar, und sie wuerde
        // Speicher und Antwort sprengen.
        abgeschnitten = true
        break
      }
    }
    if (abgeschnitten) break

    // Der Prozess bedient gleichzeitig GraphQL, Portal und die Nuxt-Routen.
    // Ein durchgehender Loop ueber eine Sekunde wuerde all das blockieren,
    // deshalb in Scheiben mit Rueckgabe an den Event-Loop.
    if (i % SCHEIBE === SCHEIBE - 1) {
      await new Promise((r) => setImmediate(r))
    }
  }

  treffer.sort((x, y) => y.score - x.score || x.a.personID - y.a.personID)
  const begrenzt = treffer.slice(0, MAX_PAARE)
  if (treffer.length > MAX_PAARE) abgeschnitten = true

  // Begruendungen erst jetzt: fuer die paar Hundert Treffer statt fuer 2,4 Mio
  // Vergleiche.
  const paare: Kandidat[] = begrenzt.map(({ a, b }) => {
    pruefe(a, b, befund)
    const gruende = begruende(a, b, befund)
    const score = befund.score
    const { klein, gross } = paarKey(a.personID, b.personID)
    const ersteIstKlein = a.personID === klein
    const p1 = ersteIstKlein ? a : b
    const p2 = ersteIstKlein ? b : a
    const v = vorschlag(a, b, zugaenge, gewicht)

    return {
      personID_1: klein,
      personID_2: gross,
      score,
      stufe: stufeFuer(score),
      gruende,
      vorschlagBehalten: v.id,
      begruendungBehalten: v.text,
      person_1: kurz(p1, kontakte),
      person_2: kurz(p2, kontakte)
    }
  })

  return {
    paare,
    anzahlPersonen: personen.length,
    dauerMs: Date.now() - start,
    abgeschnitten
  }
}

/**
 * Bewertet genau ein Paar, frisch aus der Datenbank.
 *
 * Absichtlich nicht aus dem Cache und absichtlich ohne Schwellenpruefung: das
 * ist auch das Werkzeug, mit dem man nachsieht, WARUM ein Paar gerade nicht
 * vorgeschlagen wird.
 */
export async function bewertePaar(
  idA: number,
  idB: number
): Promise<{
  score: number
  stufe: ReturnType<typeof stufeFuer>
  gruende: ReturnType<typeof begruende>
  imVorschlag: boolean
  vorschlagBehalten: number
  begruendungBehalten: string
} | null> {
  const personen = await queryP<PersonRoh>(
    `SELECT personID, vorname, nachname,
            DATE_FORMAT(gebDat, '%Y-%m-%d') AS gebDatISO,
            geschlecht, ecKreis, ecMitglied, erstellt
       FROM personen
      WHERE personID IN (?, ?) AND anonymisiert = 0`,
    [idA, idB]
  )
  if (personen.length !== 2) return null

  const { kontakte } = await ladeKontakteFuer([idA, idB])
  const liste = vorbereiten(personen, kontakte)
  const a = liste.find((p) => p.personID === idA)!
  const b = liste.find((p) => p.personID === idB)!

  const befund = leererBefund()
  pruefe(a, b, befund)
  const { gewicht, zugaenge } = await ladeGewichte()
  const v = vorschlag(a, b, zugaenge, gewicht)

  return {
    score: befund.score,
    stufe: stufeFuer(befund.score),
    gruende: begruende(a, b, befund),
    imVorschlag: istKandidat(befund),
    vorschlagBehalten: v.id,
    begruendungBehalten: v.text
  }
}

/** Kontakte nur fuer zwei Personen -- fuer die Paar-Ansicht. */
async function ladeKontakteFuer(
  ids: number[]
): Promise<{ kontakte: Kontakte }> {
  const [mails, tele, adressen] = await Promise.all([
    queryP<{ personID: number; eMail: string }>(
      'SELECT personID, eMail FROM eMails WHERE personID IN (?, ?)',
      ids
    ),
    queryP<{ personID: number; telefon: string }>(
      'SELECT personID, telefon FROM telefone WHERE personID IN (?, ?)',
      ids
    ),
    queryP<{
      personID: number
      strasse: string
      plz: string
      ort: string
      isOld: number
    }>(
      'SELECT personID, strasse, plz, ort, isOld FROM adressen WHERE personID IN (?, ?)',
      ids
    )
  ])

  const internMail = new Intern()
  const internTel = new Intern()
  const internAdr = new Intern()
  const k: Kontakte = {
    mails: new Map(),
    tele: new Map(),
    adressen: new Map(),
    mailText: new Map(),
    telText: new Map(),
    adrText: new Map()
  }

  for (const m of mails) {
    const norm = normEmail(m.eMail)
    if (!norm) continue
    eintragen(k.mails, m.personID, internMail.id(norm))
    const l = k.mailText.get(m.personID) ?? []
    if (!l.includes(m.eMail)) l.push(m.eMail)
    k.mailText.set(m.personID, l)
  }
  for (const t of tele) {
    const norm = normTelefon(t.telefon)
    if (!norm) continue
    eintragen(k.tele, t.personID, internTel.id(norm))
    const l = k.telText.get(t.personID) ?? []
    if (!l.includes(t.telefon)) l.push(t.telefon)
    k.telText.set(t.personID, l)
  }
  for (const a of adressen) {
    const norm = normAdresse(a.strasse, a.plz, a.ort)
    if (!norm) continue
    eintragen(k.adressen, a.personID, internAdr.id(norm))
    if (!k.adrText.has(a.personID) || a.isOld === 0) {
      k.adrText.set(a.personID, `${a.strasse}, ${a.plz} ${a.ort}`)
    }
  }

  return { kontakte: k }
}
