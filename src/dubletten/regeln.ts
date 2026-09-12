import { levMax, istZifferndreher } from './levenshtein'
import type { Grund, PersonNorm, Stufe } from './typen'

/**
 * Bewertung eines Personenpaares.
 *
 * Zwei Phasen, und das ist keine Mikrooptimierung: `bewerte()` laeuft fuer alle
 * 2,39 Mio Paare und darf deshalb NICHTS allozieren -- ein Grund-Objekt je Paar
 * waere Millionen kurzlebiger Objekte und damit reine GC-Arbeit. `begruende()`
 * laeuft nur fuer die paar Hundert Paare, die ueber der Schwelle liegen, und
 * baut dort die Texte.
 *
 * Damit beide nicht auseinanderlaufen koennen, teilen sie sich `pruefe()`: die
 * Bewertung ist die Summe genau der Befunde, die auch begruendet werden.
 */

/** Punktwerte an einer Stelle, damit Kalibrieren eine Zahl aendert, nicht Code. */
export const PUNKTE = {
  nameExact: 60,
  nameSwap: 55,
  nameSwapFuzzy: 45,
  vornameZweitname: 45,
  vornameTokenTausch: 45,
  vornameKurzform: 35,
  nameTippfehler1: 45,
  nameTippfehler2: 30,
  nurEinFeldGleich: 5,
  /** Rohe Schreibweise beider Namen identisch -> Unterschied liegt im gebDat. */
  nameIdentischBonus: 10,

  gebExact: 35,
  gebTagMonatTausch: 30,
  gebJahrTippfehler: 25,
  gebJahrZifferndreher: 25,
  gebTagZifferndreher: 20,
  gebTagNah: 15,
  /** Abzug: Jahre liegen weit auseinander, keine Dreher-Erklaerung. */
  gebUnklar: -10,

  emailGleich: 40,
  telefonGleich: 30,
  adresseGleich: 10,

  geschlechtUngleich: -20
} as const

/** Ab hier landet ein Paar in der Liste. */
export const SCHWELLE = 60

/**
 * Befund eines Vergleichs. Wird von `pruefe()` in ein uebergebenes Objekt
 * geschrieben statt zurueckgegeben -- so entsteht im heissen Pfad keine
 * Allokation (ein einziges Scratch-Objekt wird wiederverwendet).
 */
export interface Befund {
  score: number
  /** Code der greifenden Namensregel, '' wenn keine. */
  nameCode: string
  namePunkte: number
  /** Levenshtein-Distanzen, soweit berechnet (-1 = nicht berechnet). */
  levVor: number
  levNach: number
  nameIdentisch: boolean

  gebCode: string
  gebPunkte: number

  email: boolean
  telefon: boolean
  adresse: boolean
  geschlechtUngleich: boolean

  /** Mindestens eine echte Namensregel hat gegriffen. */
  hatNamenssignal: boolean
}

export function leererBefund(): Befund {
  return {
    score: 0,
    nameCode: '',
    namePunkte: 0,
    levVor: -1,
    levNach: -1,
    nameIdentisch: false,
    gebCode: '',
    gebPunkte: 0,
    email: false,
    telefon: false,
    adresse: false,
    geschlechtUngleich: false,
    hatNamenssignal: false
  }
}

/**
 * Erlaubte Tippfehler-Distanz fuer ein Feld.
 *
 * Kurze Namen brauchen ein engeres Budget: bei Distanz 2 waeren "Tim", "Tom",
 * "Tia", "Ute" und "Udo" wechselseitig Kandidaten, und die Liste haette mehr
 * Rauschen als Signal.
 */
function budget(len: number): number {
  return len < 5 ? 1 : 2
}

/**
 * Darf eine Abweichung im VORNAMEN als Tippfehler gelten?
 *
 * Hier liegt eine Asymmetrie, die teuer ist, wenn man sie uebersieht:
 * Geschwister und Zwillinge haben denselben Nachnamen und (bei Zwillingen)
 * dasselbe Geburtsdatum, unterscheiden sich also ausgerechnet im Vornamen --
 * und bei kurzen Vornamen ist dieser Unterschied oft nur ein Zeichen
 * ("Tim"/"Tom", "Lea"/"Leo", "Jan"/"Jon", "Mia"/"Mio"). Das sind verschiedene
 * Menschen, keine Verschreiber. Umgekehrt ist eine Abweichung im NACHNAMEN bei
 * gleichem Vornamen fast immer ein Schreibfehler, denn Geschwister teilen den
 * Nachnamen gerade.
 *
 * Deshalb wird der Vorname relativ zu seiner Laenge bewertet: ein geaendertes
 * Zeichen in einem dreibuchstabigen Namen ist ein Drittel des Namens und damit
 * zu wenig Beleg. "Sven"/"Swen" (4 Zeichen, Distanz 1) bleibt erlaubt,
 * "Katharina"/"Katarina" ebenso.
 *
 * Preis dieser Entscheidung: ein echter Verschreiber in einem sehr kurzen
 * Vornamen ("Jan"/"Jna") wird nicht mehr als Dublette vorgeschlagen. Das ist
 * bewusst in Kauf genommen -- eine uebersehene Dublette kostet einen
 * Doppeleintrag, ein faelschlich zusammengefuehrtes Zwillingspaar kostet einen
 * geloeschten Personensatz samt Anmeldungen.
 */
function vornameDistanzErlaubt(distanz: number, len: number): boolean {
  if (distanz === 0) return true
  if (distanz === 1) return len >= 4
  if (distanz === 2) return len >= 7
  return false
}

/** Codes, die als echtes Namenssignal gelten. */
const NAMENSSIGNALE = new Set([
  'name.exact',
  'name.swap',
  'name.swapFuzzy',
  'vorname.zweitname',
  'vorname.tokenTausch',
  'vorname.kurzform',
  'name.tippfehler'
])

/** Ist b ein Praefix von a (oder umgekehrt), mit mindestens 3 Zeichen? */
function istKurzform(a: string, b: string): boolean {
  if (a === b) return false
  const [kurz, lang] = a.length < b.length ? [a, b] : [b, a]
  return kurz.length >= 3 && lang.startsWith(kurz)
}

/** Gleiche Token-Multimenge, aber andere Reihenfolge ("Maria Anna"/"Anna Maria"). */
function gleicheTokensAndereReihenfolge(a: PersonNorm, b: PersonNorm): boolean {
  if (a.vorTokens.length !== b.vorTokens.length) return false
  if (a.vorTokens.length < 2) return false
  if (a.vorNorm === b.vorNorm) return false
  for (let i = 0; i < a.vorTokenIds.length; i++) {
    if (a.vorTokenIds[i] !== b.vorTokenIds[i]) return false
  }
  return true
}

/** Ist ein Token-Set echte Teilmenge des anderen, bei gleichem Rufnamen? */
function istZweitnameVariante(a: PersonNorm, b: PersonNorm): boolean {
  if (a.vorTokens.length === b.vorTokens.length) return false
  if (a.vorHaupt !== b.vorHaupt) return false
  const [kurz, lang] =
    a.vorTokens.length < b.vorTokens.length
      ? [a.vorTokens, b.vorTokens]
      : [b.vorTokens, a.vorTokens]
  return kurz.every((t) => lang.includes(t))
}

/**
 * Vergleicht zwei Personen und schreibt den Befund in `out`.
 *
 * Die Reihenfolge der Pruefungen ist nach Kosten sortiert: Integer-Vergleiche
 * zuerst, Levenshtein erst, wenn keine billigere Regel schon gegriffen hat und
 * das Laengen-Gate es erlaubt.
 */
export function pruefe(a: PersonNorm, b: PersonNorm, out: Befund): void {
  out.score = 0
  out.nameCode = ''
  out.namePunkte = 0
  out.levVor = -1
  out.levNach = -1
  out.nameIdentisch = false
  out.gebCode = ''
  out.gebPunkte = 0
  out.email = false
  out.telefon = false
  out.adresse = false
  out.geschlechtUngleich = false
  out.hatNamenssignal = false

  /* ---------------------------------------------------------------- Name -- */
  // Nur die staerkste Namensregel zaehlt. Summieren wuerde denselben Sachverhalt
  // mehrfach bewerten ("Name gleich" UND "Nachname gleich").
  const vorGleich = a.vorId === b.vorId
  const nachGleich = a.nachId === b.nachId

  if (vorGleich && nachGleich) {
    out.nameCode = 'name.exact'
    out.namePunkte = PUNKTE.nameExact
  } else if (a.vorNorm === b.nachNorm && a.nachNorm === b.vorNorm) {
    out.nameCode = 'name.swap'
    out.namePunkte = PUNKTE.nameSwap
  } else if (nachGleich && istZweitnameVariante(a, b)) {
    out.nameCode = 'vorname.zweitname'
    out.namePunkte = PUNKTE.vornameZweitname
  } else if (nachGleich && gleicheTokensAndereReihenfolge(a, b)) {
    out.nameCode = 'vorname.tokenTausch'
    out.namePunkte = PUNKTE.vornameTokenTausch
  } else {
    // Ab hier kostet es Levenshtein. Erst das Laengen-Gate: passt keines der
    // beiden Felder ins Budget, kann keine Tippfehler-Regel mehr greifen.
    const budVor = budget(Math.min(a.vorLen, b.vorLen))
    const budNach = budget(Math.min(a.nachLen, b.nachLen))
    const vorMoeglich = Math.abs(a.vorLen - b.vorLen) <= budVor
    const nachMoeglich = Math.abs(a.nachLen - b.nachLen) <= budNach

    const dVor = vorGleich
      ? 0
      : vorMoeglich
        ? levMax(a.vorNorm, b.vorNorm, budVor)
        : budVor + 1
    const dNach = nachGleich
      ? 0
      : nachMoeglich
        ? levMax(a.nachNorm, b.nachNorm, budNach)
        : budNach + 1

    out.levVor = dVor
    out.levNach = dNach

    const summe = dVor + dNach
    const beideImBudget =
      dVor <= budVor &&
      dNach <= budNach &&
      // Strengere Schranke fuer den Vornamen, siehe vornameDistanzErlaubt():
      // sonst gelten Zwillinge als Dublette.
      vornameDistanzErlaubt(dVor, Math.min(a.vorLen, b.vorLen))

    if (beideImBudget && summe === 1) {
      out.nameCode = 'name.tippfehler'
      out.namePunkte = PUNKTE.nameTippfehler1
    } else if (beideImBudget && summe === 2) {
      out.nameCode = 'name.tippfehler'
      out.namePunkte = PUNKTE.nameTippfehler2
    } else if (
      // Vertauscht, aber mit Tippfehler auf einer Seite
      levMax(a.vorNorm, b.nachNorm, 1) <= 1 &&
      levMax(a.nachNorm, b.vorNorm, 1) <= 1
    ) {
      out.nameCode = 'name.swapFuzzy'
      out.namePunkte = PUNKTE.nameSwapFuzzy
    } else if (
      // Kurzform des Rufnamens, Nachname gleich oder fast gleich
      (nachGleich || dNach <= 1) &&
      istKurzform(a.vorHaupt, b.vorHaupt)
    ) {
      out.nameCode = 'vorname.kurzform'
      out.namePunkte = PUNKTE.vornameKurzform
    } else if (vorGleich || nachGleich) {
      out.nameCode = vorGleich ? 'vorname.gleich' : 'nachname.gleich'
      out.namePunkte = PUNKTE.nurEinFeldGleich
    }
  }

  out.hatNamenssignal = NAMENSSIGNALE.has(out.nameCode)
  out.score += out.namePunkte

  // Rohe Schreibweise beider Namen identisch: dann liegt der Unterschied
  // zwingend im Geburtsdatum -- genau das Muster, das eine erneute
  // Online-Anmeldung mit vertipptem Datum erzeugt.
  // Felder einzeln vergleichen statt einen verketteten String: mit Trennzeichen
  // waeren "Anna Maria"+"Lorenz" und "Anna"+"Maria Lorenz" identisch, und jedes
  // Trennzeichen laedt dazu ein, von einem Formatierer wegnormalisiert zu werden.
  if (
    out.nameCode === 'name.exact' &&
    a.roh.vorname === b.roh.vorname &&
    a.roh.nachname === b.roh.nachname
  ) {
    out.nameIdentisch = true
    out.score += PUNKTE.nameIdentischBonus
  }

  /* ------------------------------------------------------------- gebDat -- */
  if (a.gebY === b.gebY && a.gebM === b.gebM && a.gebD === b.gebD) {
    out.gebCode = 'gebDat.exact'
    out.gebPunkte = PUNKTE.gebExact
  } else if (
    a.gebY === b.gebY &&
    a.gebD === b.gebM &&
    a.gebM === b.gebD &&
    a.gebM !== a.gebD
  ) {
    out.gebCode = 'gebDat.tagMonatTausch'
    out.gebPunkte = PUNKTE.gebTagMonatTausch
  } else if (a.gebM === b.gebM && a.gebD === b.gebD) {
    const jA = String(a.gebY)
    const jB = String(b.gebY)
    if (istZifferndreher(jA, jB)) {
      out.gebCode = 'gebDat.jahrZifferndreher'
      out.gebPunkte = PUNKTE.gebJahrZifferndreher
    } else if (levMax(jA, jB, 1) <= 1) {
      out.gebCode = 'gebDat.jahrTippfehler'
      out.gebPunkte = PUNKTE.gebJahrTippfehler
    }
  } else if (a.gebY === b.gebY && a.gebM === b.gebM) {
    const tA = String(a.gebD).padStart(2, '0')
    const tB = String(b.gebD).padStart(2, '0')
    if (istZifferndreher(tA, tB)) {
      out.gebCode = 'gebDat.tagZifferndreher'
      out.gebPunkte = PUNKTE.gebTagZifferndreher
    } else if (Math.abs(a.gebD - b.gebD) <= 2) {
      out.gebCode = 'gebDat.tagNah'
      out.gebPunkte = PUNKTE.gebTagNah
    }
  }

  if (!out.gebCode && Math.abs(a.gebY - b.gebY) >= 2) {
    // Weit auseinanderliegende Jahre ohne Dreher-Erklaerung sprechen gegen eine
    // Dublette: das ist das Muster von Vater/Sohn und Namensvetter.
    out.gebCode = 'gebDat.unklar'
    out.gebPunkte = PUNKTE.gebUnklar
  }
  out.score += out.gebPunkte

  /* ------------------------------------------------------------ Kontakt -- */
  // Unabhaengige Evidenz, daher additiv. Die Sets sind klein (eine Person hat
  // selten mehr als drei Mailadressen), die Schnittmenge ist billig.
  out.email = schnittmenge(a.mailIds, b.mailIds)
  if (out.email) out.score += PUNKTE.emailGleich

  out.telefon = schnittmenge(a.telIds, b.telIds)
  if (out.telefon) out.score += PUNKTE.telefonGleich

  out.adresse = schnittmenge(a.adrIds, b.adrIds)
  if (out.adresse) out.score += PUNKTE.adresseGleich

  /* --------------------------------------------------------- Geschlecht -- */
  // Strafe, kein Veto: die Spalte ist oft falsch erfasst (bei Online-Anmeldungen
  // die haeufigste Fehleingabe ueberhaupt). Ein Veto wuerde echte Dubletten
  // verstecken.
  if (a.geschlecht !== b.geschlecht) {
    out.geschlechtUngleich = true
    out.score += PUNKTE.geschlechtUngleich
  }
}

function schnittmenge(a: Set<number>, b: Set<number>): boolean {
  if (a.size === 0 || b.size === 0) return false
  const [klein, gross] = a.size <= b.size ? [a, b] : [b, a]
  for (const v of klein) if (gross.has(v)) return true
  return false
}

/**
 * Kommt das Paar in die Liste?
 *
 * Zwei Bedingungen, und die zweite ist der eigentliche Rauschfilter: ohne
 * Namenssignal kaemen Geschwister (gleicher Nachname, gleiche Adresse, gleiches
 * Familientelefon) und ganze Familien an einer gemeinsamen Mailadresse in die
 * Liste. Eine Mail-Gleichheit allein reicht deshalb bewusst nicht.
 */
export function istKandidat(b: Befund): boolean {
  return b.score >= SCHWELLE && b.hatNamenssignal
}

export function stufeFuer(score: number): Stufe {
  if (score >= 90) return 'hoch'
  if (score >= 70) return 'mittel'
  return 'niedrig'
}

/**
 * Baut die Begruendungstexte. Laeuft nur fuer Paare ueber der Schwelle.
 *
 * Die Texte nennen die konkreten Werte: die Sachbearbeiterin soll sehen, WARUM
 * ein Paar vorgeschlagen wird, und nicht nur eine Punktzahl.
 */
export function begruende(a: PersonNorm, b: PersonNorm, bef: Befund): Grund[] {
  const g: Grund[] = []
  const nameA = `${a.roh.vorname} ${a.roh.nachname}`
  const nameB = `${b.roh.vorname} ${b.roh.nachname}`

  switch (bef.nameCode) {
    case 'name.exact':
      g.push({
        code: 'name.exact',
        text: bef.nameIdentisch
          ? `Name identisch geschrieben: ${nameA}`
          : `Name stimmt überein (Schreibweise abweichend: ${nameA} / ${nameB})`,
        punkte: bef.namePunkte,
        feld: 'name'
      })
      break
    case 'name.swap':
      g.push({
        code: 'name.swap',
        text: `Vor- und Nachname sind vertauscht: ${nameA} / ${nameB}`,
        punkte: bef.namePunkte,
        feld: 'name'
      })
      break
    case 'name.swapFuzzy':
      g.push({
        code: 'name.swapFuzzy',
        text: `Vor- und Nachname vertauscht, mit Abweichung: ${nameA} / ${nameB}`,
        punkte: bef.namePunkte,
        feld: 'name'
      })
      break
    case 'vorname.zweitname':
      g.push({
        code: 'vorname.zweitname',
        text: `Zweitname einmal weggelassen: „${a.roh.vorname}" / „${b.roh.vorname}"`,
        punkte: bef.namePunkte,
        feld: 'vorname'
      })
      break
    case 'vorname.tokenTausch':
      g.push({
        code: 'vorname.tokenTausch',
        text: `Vornamen in anderer Reihenfolge: „${a.roh.vorname}" / „${b.roh.vorname}"`,
        punkte: bef.namePunkte,
        feld: 'vorname'
      })
      break
    case 'vorname.kurzform':
      g.push({
        code: 'vorname.kurzform',
        text: `Kurzform des Vornamens: „${a.roh.vorname}" / „${b.roh.vorname}"`,
        punkte: bef.namePunkte,
        feld: 'vorname'
      })
      break
    case 'name.tippfehler': {
      const teile: string[] = []
      if (bef.levVor > 0) {
        teile.push(
          `Vorname um ${bef.levVor} Zeichen (${a.roh.vorname} / ${b.roh.vorname})`
        )
      }
      if (bef.levNach > 0) {
        teile.push(
          `Nachname um ${bef.levNach} Zeichen (${a.roh.nachname} / ${b.roh.nachname})`
        )
      }
      g.push({
        code: 'name.tippfehler',
        text: `Abweichung ${teile.join(', ')}`,
        punkte: bef.namePunkte,
        feld: bef.levNach > 0 ? 'nachname' : 'vorname'
      })
      break
    }
    case 'vorname.gleich':
      g.push({
        code: 'vorname.gleich',
        text: `Nur der Vorname stimmt überein (${a.roh.vorname})`,
        punkte: bef.namePunkte,
        feld: 'vorname'
      })
      break
    case 'nachname.gleich':
      g.push({
        code: 'nachname.gleich',
        text: `Nur der Nachname stimmt überein (${a.roh.nachname})`,
        punkte: bef.namePunkte,
        feld: 'nachname'
      })
      break
  }

  if (bef.nameIdentisch) {
    g.push({
      code: 'name.identisch',
      text: 'Beide Namen sind zeichengleich geschrieben – der Unterschied liegt im Geburtsdatum',
      punkte: PUNKTE.nameIdentischBonus,
      feld: 'name'
    })
  }

  const gA = a.roh.gebDatISO
  const gB = b.roh.gebDatISO
  const gebTexte: Record<string, string> = {
    'gebDat.exact': `Geburtsdatum identisch (${deutsch(gA)})`,
    'gebDat.tagMonatTausch': `Tag und Monat vertauscht (${deutsch(gA)} / ${deutsch(gB)})`,
    'gebDat.jahrTippfehler': `Geburtsjahr um eine Ziffer abweichend (${a.gebY} / ${b.gebY})`,
    'gebDat.jahrZifferndreher': `Zahlendreher im Geburtsjahr (${a.gebY} / ${b.gebY})`,
    'gebDat.tagZifferndreher': `Zahlendreher im Tag (${deutsch(gA)} / ${deutsch(gB)})`,
    'gebDat.tagNah': `Geburtstag um wenige Tage abweichend (${deutsch(gA)} / ${deutsch(gB)})`,
    'gebDat.unklar': `Geburtsdaten liegen weit auseinander (${deutsch(gA)} / ${deutsch(gB)})`
  }
  if (bef.gebCode) {
    g.push({
      code: bef.gebCode,
      text: gebTexte[bef.gebCode] ?? bef.gebCode,
      punkte: bef.gebPunkte,
      feld: 'gebDat'
    })
  }

  if (bef.email) {
    g.push({
      code: 'email.gleich',
      text: 'Gleiche E-Mail-Adresse hinterlegt',
      punkte: PUNKTE.emailGleich,
      feld: 'email'
    })
  }
  if (bef.telefon) {
    g.push({
      code: 'telefon.gleich',
      text: 'Gleiche Telefonnummer hinterlegt',
      punkte: PUNKTE.telefonGleich,
      feld: 'telefon'
    })
  }
  if (bef.adresse) {
    g.push({
      code: 'adresse.gleich',
      text: 'Gleiche Adresse hinterlegt (schwaches Signal – Familien teilen eine Adresse)',
      punkte: PUNKTE.adresseGleich,
      feld: 'adresse'
    })
  }
  if (bef.geschlechtUngleich) {
    g.push({
      code: 'geschlecht.ungleich',
      text: `Geschlecht unterschiedlich erfasst (${a.geschlecht} / ${b.geschlecht})`,
      punkte: PUNKTE.geschlechtUngleich,
      feld: 'geschlecht'
    })
  }

  return g
}

function deutsch(iso: string): string {
  const t = iso.split('-')
  return t.length === 3 ? `${t[2]}.${t[1]}.${t[0]}` : iso
}
