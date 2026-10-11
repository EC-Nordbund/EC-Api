import { existsSync } from 'fs'
import { join, resolve } from 'path'
import QRCode from 'qrcode'
import { queryP } from '../helpers/mysql'

/**
 * Katalog der Dateivorlagen.
 *
 * Welche Vorlagen es gibt, wo sie gezogen werden und welche Daten hinein-
 * gesetzt werden, entscheidet der Code -- deshalb steht das hier und nicht
 * in der Datenbank. Die Datenbank (dateiVorlage, sql/datei-vorlagen.sql)
 * haelt nur Datei und Historie; die Pflegemaske in EC-Verwaltung zeigt die
 * Liste aus diesem Katalog und den Stand je Eintrag.
 *
 * Fallback: Fehlt der DB-Eintrag, liest der Store die Datei aus dem
 * Dateisystem -- so verhaelt sich die API nach dem Deploy genau wie vorher,
 * bis die Dateien uebernommen sind. Zwei Klassen:
 *
 *   auslieferung -- die Datei liegt im Git und damit im Image; dauerhaftes
 *                   Sicherheitsnetz, ein DB-Eintrag laesst sich wieder darauf
 *                   zuruecksetzen.
 *   container    -- die Datei liegt nur auf dem Prod-Server (nicht im Git);
 *                   Uebergangsnetz, bis "uebernehmen" sie in die DB geholt hat.
 *                   Nach dem naechsten Deploy ohne die Datei ist sie weg.
 *
 * Die Beispieldaten sind zugleich die Spezifikation der Platzhalter: die
 * Pruefung beim Upload gleicht die Vorlage gegen sie ab, die Probe-Ausgabe
 * fuellt sie damit. Wer im Code ein Feld ergaenzt, ergaenzt es hier mit.
 */

export type Art = 'docx' | 'xlsx' | 'pdf' | 'md'
export type FallbackKlasse = 'auslieferung' | 'container'

export interface Gruppe {
  schluessel: string
  name: string
}

export const GRUPPEN: Gruppe[] = [
  { schluessel: 'brief', name: 'Bestätigungsbriefe' },
  { schluessel: 'fz', name: 'Führungszeugnis' },
  { schluessel: 'tnliste', name: 'TN-Listen (Portal und Verwaltung)' },
  { schluessel: 'kreis', name: 'EC-Kreise' },
  { schluessel: 'mail', name: 'Anmelde-Mails' },
  { schluessel: 'christival', name: 'Sonstiges' }
]

export const MIME: Record<Art, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  md: 'text/markdown'
}

export type Beispiel =
  | Record<string, unknown>
  | (() => Record<string, unknown> | Promise<Record<string, unknown>>)

export interface KatalogEintrag {
  schluessel: string
  gruppe: string
  name: string
  beschreibung: string
  /** Wo im Code die Vorlage gezogen wird -- fuer die Pflegemaske. */
  verwendung: string
  art: Art
  /** Daten fuer Pruefung und Probe; bei pdf/md nicht vorhanden. */
  beispiel?: Beispiel
  /** Delimiter der docx-templates-Befehle, Standard `+++`. */
  delimiter?: string | [string, string]
  fallback: { pfad: string; klasse: FallbackKlasse } | null
  /** Gesetzt bei Mitgliedern einer Familie (z. B. brief.sicherungsschein). */
  familie?: string
}

/** Zulaessige Schluessel: Gruppe, Punkt, dann Teile aus Buchstaben/Ziffern/Bindestrich. */
export const SCHLUESSEL_RE = /^[a-z0-9]+(\.[a-zA-Z0-9-]+)+$/

/** Datei relativ zum Arbeitsverzeichnis -- wie die bisherigen readFile('./…'). */
const cwd = (p: string) => resolve(p)

/* ------------------------------------------------------- Beispieldaten -- */

const heute = () =>
  new Date().toISOString().split('T')[0].split('-').reverse().join('.')

/** Datenobjekt aus helpers/bestMail.ts (createBriefFromData). */
const BEISPIEL_BRIEF = (): Record<string, unknown> => ({
  heute: heute(),
  anmeldeID: 'PROBE-0001',
  person: {
    vorname: 'Maria',
    nachname: 'Beispiel',
    gebDat: '14.05.2011',
    geschlecht: 'w',
    volljaehrig: false
  },
  adresse: { strasse: 'Musterweg 1', plz: '24103', ort: 'Kiel' },
  name: 'Sommerfreizeit Probe',
  begin: '01.07.2027',
  ende: '10.07.2027',
  jahr: '2027',
  ort: 'Kropp',
  anzahlung: '50,00',
  restzahlung: '250,00',
  restzahlungsdatum: '10.06.2027',
  vegetarisch: 'Nein',
  lebensmittelAllergien: 'Keine',
  fahrgemeinschaften: 'Ja',
  bemerkungen: 'Probe-Ausgabe aus der Verwaltung',
  gesundheitsinformationen: 'Keine',
  schwimmen: 'Ja',
  sichEntfernen: 'Ja',
  klettern: 'Ja',
  bootfahren: 'Ja'
})

/** Datenobjekt aus helpers/fz.ts (createFZ). */
const BEISPIEL_FZ_ANTRAG = (): Record<string, unknown> => ({
  vorname: 'Maria',
  nachname: 'Beispiel',
  gebDat: '14.05.1995',
  strasse: 'Musterweg 1',
  plz: '24103',
  ort: 'Kiel',
  geschlecht: 'w',
  date: heute()
})

/** Daten aus fzList.ts (createFZAll); Datumsfelder sind dort Date-Objekte. */
const BEISPIEL_FZ_LISTE = (): Record<string, unknown> => {
  const zeile = (
    personID: number,
    vorname: string,
    nachname: string,
    bezeichnung: string
  ) => ({
    personID,
    vorname,
    nachname,
    gebDat: new Date('1995-05-14'),
    bezeichnung,
    gesehenVon: 'Doro Demo',
    gesehenAm: new Date('2026-06-01'),
    gueltigBis: new Date('2031-06-01'),
    gueltig: true,
    fzVon: new Date('2026-05-20'),
    erzeugt_durch: 'demo',
    erzeugt: new Date('2026-05-01')
  })
  return {
    heute: new Date(),
    row: [
      zeile(1, 'Maria', 'Beispiel', 'EC Musterstadt'),
      zeile(2, 'Max', 'Muster', 'EC Musterstadt'),
      zeile(3, 'Erika', 'Probe', 'EC Beispielhausen')
    ]
  }
}

/**
 * Struktur wie die Antwort von /portal/veranstaltung/:id/tnliste (felder=voll)
 * bzw. TN_LIST_QUERY in EC-Verwaltung/src/tnList.ts, inklusive der Felder,
 * die der Client vor dem Fuellen ergaenzt (id, empty, m, w, older27, betreuer,
 * vOrtLocation). Gemeinsam fuer alle fuenf TN-Listen.
 */
const BEISPIEL_TNLISTE = (): Record<string, unknown> => {
  const anmeldung = (
    id: number,
    vorname: string,
    nachname: string,
    geschlecht: 'm' | 'w',
    gebDat: string,
    position: number
  ) => {
    const [j, m, t] = gebDat.split('-')
    return {
      id,
      anmeldeID: `PROBE-${1000 + id}`,
      position,
      person: {
        vorname,
        nachname,
        geschlecht,
        gebDat: { input: gebDat, german: `${t}.${m}.${j}` }
      },
      adresse: { strasse: 'Musterweg 1', plz: '24103', ort: 'Kiel' },
      telefon: { telefon: '0431 123456' },
      email: { eMail: 'probe@example.org' },
      bemerkungen: 'Probe',
      gesundheitsinformationen: 'Keine',
      lebensmittelAllergien: 'Keine',
      vegetarisch: 'Nein',
      radfahren: 'Ja',
      schwimmen: 'Ja',
      fahrgemeinschaften: 'Ja',
      klettern: 'Ja',
      sichEntfernen: 'Ja',
      bootFahren: 'Ja',
      wartelistenPlatz: 0,
      anmeldeZeitpunkt: {
        german: '01.03.2027',
        day: 1,
        month: 3,
        year: 2027
      },
      extra_json: '{}',
      empty: '',
      m: geschlecht === 'm' ? 'X' : '',
      w: geschlecht === 'w' ? 'X' : '',
      older27: position > 1 ? 'X' : '',
      betreuer: position > 1 ? 'X' : ''
    }
  }
  return {
    veranstaltungsID: 1,
    bezeichnung: 'Sommerfreizeit Probe',
    kurzBezeichnung: 'SF-Probe',
    begin: { german: '01.07.2027', input: '2027-07-01' },
    ende: { german: '10.07.2027', input: '2027-07-10' },
    hauptleiter: {
      person: { personID: 1, vorname: 'Doro', nachname: 'Demo' }
    },
    minTNAlter: 9,
    maxTNAlter: 13,
    anzahlPlaetze: 40,
    anzahlPlaetzeW: 20,
    anzahlPlaetzeM: 20,
    preisNormal: 300,
    preisLastMinute: 330,
    preisFruehbucher: 270,
    fruehbucherBis: { german: '01.04.2027' },
    lastMinuteAb: { german: '15.06.2027' },
    kannVorortBezahltWerden: false,
    hatGWarteliste: false,
    veranstaltungsort: {
      bezeichnung: 'Freizeitheim Probe',
      strasse: 'Am Wald 3',
      plz: '24848',
      ort: 'Kropp',
      land: 'Deutschland'
    },
    vOrtLocation: '24848 Kropp (Deutschland)',
    anmeldungen: [
      anmeldung(0, 'Maria', 'Beispiel', 'w', '2016-05-14', 1),
      anmeldung(1, 'Max', 'Muster', 'm', '2015-11-02', 1),
      anmeldung(2, 'Erika', 'Probe', 'w', '1995-01-20', 2)
    ]
  }
}

/** Daten aus portal/qr.ts (erzeugeQrBlatt) -- der QR-Code wird echt erzeugt. */
const BEISPIEL_QR = async (): Promise<Record<string, unknown>> => {
  const url = 'https://www.ec-nordbund.de/anmeldung/ma/probe'
  const png = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 600
  })
  return {
    jahr: String(new Date().getFullYear() + 5),
    kreis: 'EC Musterstadt',
    anmeldeUrl: url,
    qr: {
      width: 9.9,
      height: 9.9,
      data: png.toString('base64'),
      extension: '.png'
    }
  }
}

/* ------------------------------------------------------------ Katalog -- */

const tnliste = (name: string, label: string): KatalogEintrag => ({
  schluessel: `tnliste.${name}`,
  gruppe: 'tnliste',
  name: `TN-Liste ${label}`,
  beschreibung: `Leeres Formular „${label}", das Portal und Verwaltung mit den Anmeldungen einer Veranstaltung füllen.`,
  verwendung:
    'Portal: TN-Listen der Freizeitleitung; Verwaltung: Veranstaltung → TN-Liste generieren',
  art: 'xlsx',
  beispiel: BEISPIEL_TNLISTE,
  fallback: { pfad: cwd(`./templates/${name}.xlsx`), klasse: 'auslieferung' }
})

const mailtext = (
  schluessel: string,
  datei: string,
  name: string,
  beschreibung: string
): KatalogEintrag => ({
  schluessel,
  gruppe: 'mail',
  name,
  beschreibung,
  verwendung: 'Bestätigungsmail der Website-Anmeldung (nuxt/mailContent.ts)',
  art: 'md',
  fallback: { pfad: cwd(`./${datei}`), klasse: 'auslieferung' }
})

/** Anzeigenamen der TN-Listen -- bisher templates/list.json. */
export const TNLISTEN: { name: string; label: string }[] = [
  { name: 'kueche', label: 'Küche' },
  { name: 'leiter', label: 'Leiter' },
  { name: 'mitarbeiter', label: 'Mitarbeiter' },
  { name: 'zuschuesse', label: 'Zuschüsse' },
  { name: 'spezialMA', label: 'Spezial MA Tag' }
]

export const KATALOG: KatalogEintrag[] = [
  ...[1, 2, 3, 4, 5].map((id): KatalogEintrag => ({
    schluessel: `brief.bestaetigung.${id}`,
    gruppe: 'brief',
    name: `Bestätigungsbrief ${id}`,
    beschreibung: `Buchungsbestätigung für Veranstaltungen mit Brief-Vorlage ${id} (Feld „Brief" der Veranstaltung). Wird mit den Anmeldedaten gefüllt, als PDF gerendert und mit Teilnahmebedingungen und Sicherungsschein verschickt.`,
    verwendung: 'Bestätigungsbrief je Anmeldung (helpers/bestMail.ts)',
    art: 'docx',
    beispiel: BEISPIEL_BRIEF,
    fallback: { pfad: cwd(`./best-brief-${id}.docx`), klasse: 'container' }
  })),
  {
    schluessel: 'brief.tn-bedingungen',
    gruppe: 'brief',
    name: 'Teilnahmebedingungen',
    beschreibung:
      'Anhang „TeilnahmeBedingungen.pdf" jeder Buchungsbestätigung.',
    verwendung: 'Bestätigungsbrief je Anmeldung (helpers/bestMail.ts)',
    art: 'pdf',
    fallback: { pfad: cwd('./tnBedingungen.pdf'), klasse: 'container' }
  },
  {
    schluessel: 'fz.antrag',
    gruppe: 'fz',
    name: 'Antrag Führungszeugnis',
    beschreibung:
      'Vordruck für die Meldebehörde; wird mit den Personendaten gefüllt und als „fzAntrag.pdf" per Mail verschickt.',
    verwendung: 'FZ-Antrag per Mail (helpers/fz.ts), auch aus dem Portal',
    art: 'docx',
    beispiel: BEISPIEL_FZ_ANTRAG,
    fallback: { pfad: cwd('./fz.docx'), klasse: 'container' }
  },
  {
    schluessel: 'fz.liste-alle',
    gruppe: 'fz',
    name: 'FZ-Gesamtliste (Excel)',
    beschreibung:
      'Übersicht aller Personen mit Führungszeugnis oder Antrag; wird gefüllt und per Mail verschickt.',
    verwendung: 'GET /v6/fz/all (fzList.ts)',
    art: 'xlsx',
    beispiel: BEISPIEL_FZ_LISTE,
    fallback: { pfad: cwd('./all.xlsx'), klasse: 'auslieferung' }
  },
  ...TNLISTEN.map((t) => tnliste(t.name, t.label)),
  {
    schluessel: 'kreis.qr-mitarbeitererfassung',
    gruppe: 'kreis',
    name: 'QR-Aushang Mitarbeitererfassung',
    beschreibung:
      'Blatt mit QR-Code, über den sich Mitarbeitende eines EC-Kreises auf der Website eintragen. Die FZ-Verantwortlichen erzeugen es im Portal.',
    verwendung: 'Portal: EC-Kreis → QR-Aushang (portal/qr.ts)',
    art: 'docx',
    beispiel: BEISPIEL_QR,
    fallback: {
      pfad: cwd('./templates/qr-mitarbeitererfassung.docx'),
      klasse: 'auslieferung'
    }
  },
  mailtext(
    'mail.dsgvo.teilnehmer',
    'teilnehmer.md',
    'Datenschutzhinweise Teilnehmer',
    'Abschnitt „Datenschutz" in der Bestätigungsmail einer Teilnehmer-Anmeldung.'
  ),
  mailtext(
    'mail.dsgvo.mitarbeiter',
    'mitarbeiter.md',
    'Datenschutzhinweise Mitarbeiter (Freizeit)',
    'Abschnitt „Datenschutz" in der Bestätigungsmail einer Mitarbeiter-Anmeldung zu einer Freizeit.'
  ),
  mailtext(
    'mail.dsgvo.mitglieder',
    'mitglieder.md',
    'Datenschutzhinweise Mitarbeiter (EC-Kreis)',
    'Abschnitt „Datenschutz" in der Bestätigungsmail einer Mitarbeiter-Erfassung im EC-Kreis.'
  ),
  mailtext(
    'mail.kontakt',
    'kontakt.md',
    'Fußzeile der Anmelde-Mails',
    'Kontakt und Impressum am Ende jeder Bestätigungsmail.'
  ),
  {
    schluessel: 'christival.einverstaendnis',
    gruppe: 'christival',
    name: 'Einverständniserklärung Christival',
    beschreibung:
      'Anhang für minderjährige Teilnehmende der Christival-Anmeldung.',
    verwendung: 'Website-Anmeldung Christival (nuxt/index.ts)',
    art: 'pdf',
    // __dirname ist im Bundle das dist-Verzeichnis -- wie bisher in nuxt/index.ts.
    fallback: {
      pfad: join(__dirname, 'Einverstaendniserklaerung.pdf'),
      klasse: 'auslieferung'
    }
  }
]

/* ------------------------------------------------------------ Familien -- */

export interface Familie {
  schluessel: string
  gruppe: string
  name: string
  art: Art
  /** Erkennt Mitglieder und liefert den Parameter (z. B. das Jahr). */
  muster: RegExp
  eintrag(parameter: string): KatalogEintrag
  /** Parameter, die es geben sollte (Jahre mit Veranstaltungen). */
  erwartet(): Promise<string[]>
  /** Vorschlaege zum Anlegen (aktuelles und naechstes Jahr, plus erwartete). */
  vorschlaege(): Promise<string[]>
  /** Parameter, fuer die eine Fallback-Datei existiert. */
  imDateisystem(): string[]
}

/**
 * Jahre mit kuenftigen oder laufenden Veranstaltungen. Fuer jedes davon muss
 * ein Sicherungsschein da sein, sonst scheitert der Briefversand.
 */
async function veranstaltungsjahre(): Promise<string[]> {
  try {
    const rows = await queryP<{ jahr: number }>(
      `SELECT DISTINCT YEAR(begin) AS jahr FROM veranstaltungen
        WHERE begin >= CURDATE() - INTERVAL 1 MONTH ORDER BY jahr`
    )
    return rows.map((r) => String(r.jahr))
  } catch {
    return []
  }
}

const SICHERUNGSSCHEIN: Familie = {
  schluessel: 'brief.sicherungsschein',
  gruppe: 'brief',
  name: 'Sicherungsschein',
  art: 'pdf',
  muster: /^brief\.sicherungsschein\.(\d{4})$/,
  eintrag: (jahr) => ({
    schluessel: `brief.sicherungsschein.${jahr}`,
    gruppe: 'brief',
    name: `Sicherungsschein ${jahr}`,
    beschreibung: `Gesetzlich vorgeschriebener Sicherungsschein für Veranstaltungen, die ${jahr} beginnen. Anhang „Sicherungsschein.pdf" jeder Buchungsbestätigung; ohne ihn geht kein Brief für dieses Jahr raus.`,
    verwendung: 'Bestätigungsbrief je Anmeldung (helpers/bestMail.ts)',
    art: 'pdf',
    fallback: {
      pfad: cwd(`./sicherungsschein_${jahr}.pdf`),
      klasse: 'container'
    },
    familie: 'brief.sicherungsschein'
  }),
  erwartet: veranstaltungsjahre,
  async vorschlaege() {
    const jetzt = new Date().getFullYear()
    const jahre = new Set([String(jetzt), String(jetzt + 1)])
    for (const j of await veranstaltungsjahre()) jahre.add(j)
    return [...jahre].sort()
  },
  imDateisystem() {
    const jahre: string[] = []
    const jetzt = new Date().getFullYear()
    // Kein Verzeichnis-Scan: die Jahre, die realistisch vorkommen, reichen.
    for (let j = jetzt - 2; j <= jetzt + 3; j++) {
      if (existsSync(cwd(`./sicherungsschein_${j}.pdf`))) jahre.push(String(j))
    }
    return jahre
  }
}

export const FAMILIEN: Familie[] = [SICHERUNGSSCHEIN]

/* ------------------------------------------------------------ Zugriff -- */

const festeEintraege = new Map(KATALOG.map((e) => [e.schluessel, e]))

/** Eintrag zu einem Schluessel -- fest aus dem Katalog oder Familienmitglied; sonst null. */
export function findeEintrag(schluessel: string): KatalogEintrag | null {
  if (!SCHLUESSEL_RE.test(schluessel)) return null
  const fest = festeEintraege.get(schluessel)
  if (fest) return fest
  for (const f of FAMILIEN) {
    const m = f.muster.exec(schluessel)
    if (m) return f.eintrag(m[1])
  }
  return null
}

/** Beispieldaten aufloesen (Funktion oder Objekt). */
export async function ladeBeispiel(
  eintrag: KatalogEintrag
): Promise<Record<string, unknown> | null> {
  if (!eintrag.beispiel) return null
  return typeof eintrag.beispiel === 'function'
    ? eintrag.beispiel()
    : eintrag.beispiel
}

/**
 * Pfade aller Blaetter eines Beispielobjekts, fuer die Anzeige in der
 * Pflegemaske: `person.vorname`, `anmeldungen[].person.nachname`.
 */
export function platzhalterPfade(
  wert: unknown,
  praefix = '',
  aus: string[] = []
): string[] {
  if (Array.isArray(wert)) {
    if (wert.length) platzhalterPfade(wert[0], `${praefix}[]`, aus)
    else aus.push(praefix)
    return aus
  }
  if (wert && typeof wert === 'object' && !(wert instanceof Date)) {
    // Bild-Objekte fuer IMAGE (width/height/data/extension) sind ein Platzhalter.
    if ('data' in wert && 'extension' in wert && 'width' in wert) {
      aus.push(`${praefix} (IMAGE)`)
      return aus
    }
    for (const [k, v] of Object.entries(wert)) {
      platzhalterPfade(v, praefix ? `${praefix}.${k}` : k, aus)
    }
    return aus
  }
  aus.push(praefix)
  return aus
}
