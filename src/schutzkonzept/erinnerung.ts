import { queryP } from '../helpers/mysql'
import { FUSS, esc, sendePortalMail } from '../portal/mail'
import { isoSql, schutzkonzeptBaseUrl } from './config'
import {
  Definition,
  UEBERFAELLIG_MAX_WOCHEN,
  erinnerungsTermine,
  gueltigesIsoDatum,
  heuteISO,
  verschiebeDatum,
  type ErinnerungsTermin
} from './definition'
import { ladeDefinition } from './formular'

/**
 * Erinnerungs-Mails an Datumsfelder des Schutzkonzepts (feld.erinnerung).
 *
 * Grundlage ist je Kreis ausschliesslich der ZULETZT VEROEFFENTLICHTE Stand:
 * ein Draft ist eine Baustelle, an deren Termine niemand erinnert werden
 * will. Welche Felder ueberhaupt erinnern und wann, steht in der
 * Formulardefinition (definition.ts: erinnerungsTermine); hier steht, welche
 * Stufe heute dran ist, wer die Mail bekommt und dass sie nur einmal geht.
 *
 * Einmaligkeit: Tabelle skErinnerung, eine Zeile je (Stand, Feld, Zeile,
 * Datum, Stufe), geschrieben NACH dem Versand. Vorher wird je Kreis geprueft,
 * was schon protokolliert ist -- ueber alle Staende des Kreises, damit ein
 * neu veroeffentlichter Stand mit unveraendertem Datum die Mail nicht ein
 * zweites Mal ausloest. Der UNIQUE-Index faengt zusaetzlich zwei parallele
 * Laeufe ab (Job und Test-Route), innerhalb des Prozesses laufen sie ohnehin
 * nacheinander (siehe `kette`).
 *
 * Nichts hier wirft: jeder Kreis steckt in seinem eigenen try/catch, ein
 * kaputter Datensatz oder ein abgelehnter SMTP-Versand kostet nur diesen
 * Kreis, nicht den Lauf. Ein Lauf ist idempotent und darf beliebig oft
 * angestossen werden.
 */

/** Ein veroeffentlichter Stand, wie der Lauf ihn braucht. */
export interface ErinnerungsStand {
  standID: number
  ecKreisID: number
  /** ecKreis.bezeichnung */
  bezeichnung: string
  formularVersionID: number
  /** Geparste `daten` des Stands (flach). */
  daten: unknown
}

/** Fuer Tests: Staende, Definition und Versand lassen sich ersetzen. */
export interface ErinnerungsOptionen {
  /** Statt der veroeffentlichten Staende aus der DB. */
  staende?: ErinnerungsStand[]
  /** Statt der Definition der jeweiligen Formularversion (gilt fuer alle). */
  definition?: Definition
  /** Statt sendePortalMail. */
  sende?: (to: string, subject: string, html: string) => Promise<void>
}

/** Ein heute faelliger Punkt eines Stands. */
export interface FaelligerPunkt {
  termin: ErinnerungsTermin
  stufe: string
  /** Tage bis zum Datum (negativ = seit dem Datum). */
  tage: number
}

export interface LaufErgebnis {
  heute: string
  /** Geprueft: Kreise mit veroeffentlichtem Stand. */
  kreise: number
  /** Termine mit aktiver Erinnerung und gesetztem Datum. */
  termine: number
  /** Davon heute mit faelliger Stufe. */
  faellig: number
  /** Davon noch nicht protokolliert, also verschickt (bzw. versucht). */
  neu: number
  /** Zugestellte Mails (eine je Empfaenger und Kreis). */
  mails: number
  /** Kreise, bei denen etwas schiefging (Details im Log). */
  fehler: number
}

/* -------------------------------------------------------------- Stufen -- */

/** Ganze Tage von `von` bis `bis` (positiv, wenn `bis` spaeter liegt). */
function tageZwischen(von: string, bis: string): number {
  const utc = (iso: string) => {
    const [j, m, t] = iso.split('-').map(Number)
    return Date.UTC(j, m - 1, t)
  }
  return Math.round((utc(bis) - utc(von)) / 86_400_000)
}

/**
 * Welche Stufe ist heute fuer einen Termin dran?
 *
 * Jede Stufe hat ein Fenster; es gilt die Stufe mit dem spaetesten Beginn,
 * deren Fenster `heute` enthaelt:
 *  - 'vorher-<n>'        vom Datum minus n Tage bis zum Datum. Das Fenster
 *                        ist absichtlich so lang: wer das Datum erst 10 Tage
 *                        vorher eintraegt, bekommt die 30-Tage-Erinnerung
 *                        trotzdem (die Mail nennt die echten Tage).
 *  - 'tag'               am Datum und die sechs Tage danach, damit ein
 *                        verpasster Lauf (API stand) die Mail nachholt.
 *  - 'ueberfaellig-<w>'  je Woche nach dem Datum, ebenfalls sieben Tage lang,
 *                        hoechstens UEBERFAELLIG_MAX_WOCHEN.
 * Danach nichts mehr: ein Stand, der mit einem laengst vergangenen Datum
 * veroeffentlicht wird, loest keine Mail aus -- der Kreis hat dieses Datum
 * gerade selbst bestaetigt. Und weil nur die spaeteste Stufe gilt, bekommt
 * niemand fuer einen Termin drei Mails an einem Tag.
 *
 * Einzige Fassung der Stufenlogik: definition.ts liefert nur die Termine
 * (erinnerungsTermine), das Portal bekommt die heute faellige Stufe fertig
 * ueber anstehendeErinnerungen -- so zeigt kein Client etwas anderes an,
 * als der Job verschickt.
 */
export function faelligeStufe(
  t: ErinnerungsTermin,
  heute: string
): string | null {
  if (!gueltigesIsoDatum(heute) || !gueltigesIsoDatum(t.datumISO)) return null
  const d = t.datumISO
  const stufen: { stufe: string; von: string; bis: string }[] = []
  for (const tage of t.tageVorher) {
    if (!Number.isInteger(tage) || tage < 0) continue
    stufen.push(
      tage === 0
        ? { stufe: 'tag', von: d, bis: verschiebeDatum(d, 6, 'd') }
        : {
            stufe: `vorher-${tage}`,
            von: verschiebeDatum(d, -tage, 'd'),
            bis: d
          }
    )
  }
  if (t.ueberfaelligWoechentlich) {
    for (let w = 1; w <= UEBERFAELLIG_MAX_WOCHEN; w++) {
      stufen.push({
        stufe: `ueberfaellig-${w}`,
        von: verschiebeDatum(d, 7 * w, 'd'),
        bis: verschiebeDatum(d, 7 * w + 6, 'd')
      })
    }
  }
  let beste: (typeof stufen)[number] | null = null
  for (const s of stufen) {
    if (s.von <= heute && heute <= s.bis && (!beste || s.von > beste.von)) {
      beste = s
    }
  }
  return beste?.stufe ?? null
}

/** Alle heute faelligen Punkte eines Stands. */
export function faelligePunkte(
  def: Definition,
  daten: unknown,
  heute: string
): { termine: number; punkte: FaelligerPunkt[] } {
  const termine = erinnerungsTermine(def, daten)
  const punkte: FaelligerPunkt[] = []
  for (const termin of termine) {
    const stufe = faelligeStufe(termin, heute)
    if (!stufe) continue
    punkte.push({ termin, stufe, tage: tageZwischen(heute, termin.datumISO) })
  }
  return { termine: termine.length, punkte }
}

/* ---------------------------------------------------------------- Mail -- */

const datumDe = (iso: string): string => {
  const [j, m, t] = iso.split('-')
  return `${t}.${m}.${j}`
}

/** "in 30 Tagen", "heute", "seit 7 Tagen überfällig". */
export function wannText(tage: number): string {
  if (tage > 1) return `in ${tage} Tagen`
  if (tage === 1) return 'morgen'
  if (tage === 0) return 'heute'
  if (tage === -1) return 'seit gestern überfällig'
  return `seit ${-tage} Tagen überfällig`
}

const kreisLink = (ecKreisID: number): string =>
  `${schutzkonzeptBaseUrl()}/#/kreis/${ecKreisID}/uebersicht`

/**
 * Betreff und Text einer Erinnerung: ein Kreis, alle heute faelligen Punkte.
 * Verwalter bekommen denselben Text plus den Hinweis, warum sie ihn bekommen.
 */
export function erinnerungsMail(
  kreis: string,
  punkte: FaelligerPunkt[],
  link: string,
  anVerwalter: boolean
): { subject: string; html: string } {
  const ueberfaellig = punkte.filter((p) => p.tage < 0).length
  const n = punkte.length
  const subject =
    ueberfaellig > 0
      ? `[Schutzkonzept] ${ueberfaellig === 1 ? 'Ein Termin ist' : `${ueberfaellig} Termine sind`} überfällig – ${kreis}`
      : `[Schutzkonzept] ${n === 1 ? 'Ein Termin steht an' : `${n} Termine stehen an`} – ${kreis}`
  const zeilen = [...punkte]
    .sort((a, b) => a.tage - b.tage)
    .map(
      (p) =>
        `  <tr><td>${esc(p.termin.label)}</td><td>${datumDe(p.termin.datumISO)}</td><td>${p.tage < 0 ? '<strong>' : ''}${wannText(p.tage)}${p.tage < 0 ? '</strong>' : ''}</td></tr>`
    )
    .join('\n')
  const html = `<p>Hallo,</p>
<p>im Schutzkonzept von <strong>${esc(kreis)}</strong> ${n === 1 ? 'steht ein Termin an' : `stehen ${n} Termine an`}:</p>
<table cellpadding="4">
  <tr><th align="left">Was</th><th align="left">Datum</th><th align="left">Fällig</th></tr>
${zeilen}
</table>
<p>Zum Schutzkonzept: <a href="${esc(link)}">${esc(link)}</a></p>
<p>Wenn ein Punkt erledigt ist, tragt bitte das neue Datum ein und
veröffentlicht den Stand – dann hört die Erinnerung dazu auf. Überfällige
Termine werden noch bis zu ${UEBERFAELLIG_MAX_WOCHEN} Wochen lang wöchentlich erinnert.</p>
${
  anVerwalter
    ? `<p>Du bekommst diese Mail als Schutzkonzept-Verwalter/in, weil mindestens
ein Termin dieses Kreises überfällig ist.</p>
`
    : ''
}${FUSS}`
  return { subject, html }
}

/* ------------------------------------------------------------- Der Lauf -- */

interface ProtokollRow {
  feld_key: string
  zeile: number
  datum: string
  stufe: string
}

const protokollKey = (
  feldKey: string,
  zeile: number,
  datum: string,
  stufe: string
): string => `${feldKey}|${zeile}|${datum}|${stufe}`

/** -1 statt undefined: NULL taugt nicht fuer den UNIQUE-Index. */
const zeileVon = (t: ErinnerungsTermin): number => t.zeile ?? -1

/** Je Kreis der zuletzt veroeffentlichte Stand. */
async function ladeVeroeffentlichteStaende(): Promise<ErinnerungsStand[]> {
  const rows = await queryP<{
    standID: number
    ecKreisID: number
    bezeichnung: string
    formularVersionID: number
    daten: string
  }>(
    `SELECT s.standID, s.ecKreisID, ec.bezeichnung, s.formularVersionID, s.daten
       FROM skKreisStand s
       JOIN ecKreis ec ON ec.ecKreisID = s.ecKreisID
      WHERE s.status = 'published'
        AND s.versionNr = (SELECT MAX(x.versionNr) FROM skKreisStand x
                            WHERE x.ecKreisID = s.ecKreisID AND x.status = 'published')
      ORDER BY s.ecKreisID`
  )
  const out: ErinnerungsStand[] = []
  for (const r of rows) {
    let daten: unknown = {}
    try {
      daten = JSON.parse(r.daten)
    } catch {
      // Kaputtes JSON in einem veroeffentlichten Stand kann eigentlich nicht
      // vorkommen (bereinigeDaten beim Publish); dann eben keine Termine.
      console.error(
        `[schutzkonzept] Erinnerung: daten von stand:${r.standID} sind kein JSON`
      )
    }
    out.push({ ...r, daten })
  }
  return out
}

async function kreisEmails(ecKreisID: number): Promise<string[]> {
  const rows = await queryP<{ email: string }>(
    'SELECT email FROM skKreisEmail WHERE ecKreisID = ? ORDER BY email',
    [ecKreisID]
  )
  return rows.map((r) => r.email)
}

/** Aktive Portal-Zugaenge mit Verwalter-Flag -- bei Ueberfaelligkeit dazu. */
async function verwalterEmails(): Promise<string[]> {
  const rows = await queryP<{ email: string }>(
    `SELECT email FROM portalUser
      WHERE is_schutzkonzept_verwalter = 1 AND aktiv = 1 ORDER BY email`
  )
  return rows.map((r) => r.email)
}

/** Ein Kreis: faellige Punkte bestimmen, Mails schicken, protokollieren. */
async function kreisErinnern(
  s: ErinnerungsStand,
  def: Definition,
  heute: string,
  verwalter: () => Promise<string[]>,
  sende: NonNullable<ErinnerungsOptionen['sende']>,
  ergebnis: LaufErgebnis
): Promise<void> {
  const { termine, punkte } = faelligePunkte(def, s.daten, heute)
  ergebnis.termine += termine
  ergebnis.faellig += punkte.length
  if (punkte.length === 0) return

  const schon = new Set(
    (
      await queryP<ProtokollRow>(
        `SELECT feld_key, zeile, DATE_FORMAT(datum, '%Y-%m-%d') AS datum, stufe
           FROM skErinnerung WHERE ecKreisID = ?`,
        [s.ecKreisID]
      )
    ).map((r) => protokollKey(r.feld_key, r.zeile, r.datum, r.stufe))
  )
  const neu = punkte.filter(
    (p) =>
      !schon.has(
        protokollKey(
          p.termin.feldKey,
          zeileVon(p.termin),
          p.termin.datumISO,
          p.stufe
        )
      )
  )
  if (neu.length === 0) return
  ergebnis.neu += neu.length

  // Empfaenger: die Schutzkonzept-Adressen des Kreises; ist etwas
  // ueberfaellig, zusaetzlich die Verwalter (die Kreis-Adressen zuerst, ohne
  // Doppelte -- ein Verwalter kann auch Kreis-Adresse sein).
  const ueberfaellig = neu.some((p) => p.tage < 0)
  const anKreis = await kreisEmails(s.ecKreisID)
  const anVerwalter = ueberfaellig
    ? (await verwalter()).filter((e) => !anKreis.includes(e))
    : []
  if (anKreis.length + anVerwalter.length === 0) {
    // Ohne Adresse kein Protokoll: sobald die Verwaltung eine eintraegt,
    // geht die Mail beim naechsten Lauf raus.
    console.warn(
      `[schutzkonzept] Erinnerung kreis:${s.ecKreisID}: ${neu.length} Punkte faellig, aber keine Schutzkonzept-E-Mail hinterlegt`
    )
    return
  }

  const link = kreisLink(s.ecKreisID)
  let zugestellt = 0
  let abgelehnt = 0
  for (const [liste, alsVerwalter] of [
    [anKreis, false],
    [anVerwalter, true]
  ] as const) {
    if (liste.length === 0) continue
    const { subject, html } = erinnerungsMail(
      s.bezeichnung,
      neu,
      link,
      alsVerwalter
    )
    for (const to of liste) {
      try {
        await sende(to, subject, html)
        zugestellt++
      } catch (err) {
        // Nur die Zustellung an diese eine Adresse -- die anderen bekommen
        // ihre Mail trotzdem. Adresse nicht ins Log.
        abgelehnt++
        console.error(
          `[schutzkonzept] Erinnerung kreis:${s.ecKreisID}: Versand an eine Adresse fehlgeschlagen:`,
          err
        )
      }
    }
  }
  ergebnis.mails += zugestellt
  if (abgelehnt > 0) ergebnis.fehler++
  if (zugestellt === 0) return // nichts angekommen, morgen erneut

  // Protokoll NACH dem Versand -- INSERT IGNORE, falls ein paralleler Lauf
  // (zweiter Prozess) schneller war.
  for (const p of neu) {
    await queryP(
      `INSERT IGNORE INTO skErinnerung
         (standID, ecKreisID, feld_key, zeile, datum, stufe, empfaenger)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        s.standID,
        s.ecKreisID,
        p.termin.feldKey,
        zeileVon(p.termin),
        p.termin.datumISO,
        p.stufe,
        zugestellt
      ]
    )
  }
  // Log ohne Adressen und Inhalte: Kennungen reichen zum Nachvollziehen.
  console.log(
    `[schutzkonzept] Erinnerung kreis:${s.ecKreisID} stand:${s.standID} ${heute}: ${neu
      .map(
        (p) =>
          `${p.termin.feldKey}${p.termin.zeile ? `#${p.termin.zeile}` : ''}=${p.stufe}`
      )
      .join(
        ', '
      )} -> ${zugestellt} Mails${abgelehnt ? `, ${abgelehnt} abgelehnt` : ''}`
  )
}

/** Laeufe im Prozess nacheinander: Job und Test-Route sollen sich nicht ueberholen. */
let kette: Promise<unknown> = Promise.resolve()

/**
 * Ein Lauf: fuer jeden Kreis den zuletzt veroeffentlichten Stand pruefen und
 * die heute faelligen Erinnerungen verschicken. Wirft nie; Fehler stehen im
 * Log und im Ergebnis. `heute` ist fuer Tests ueberschreibbar (JJJJ-MM-TT),
 * die Optionen ebenso -- ohne sie kommt alles aus der DB und geht ueber SMTP.
 */
export function erinnerungenVerschicken(
  heute: string = heuteISO(),
  optionen: ErinnerungsOptionen = {}
): Promise<LaufErgebnis> {
  const lauf = kette.then(() => lauf_(heute, optionen))
  kette = lauf.catch(() => undefined)
  return lauf
}

async function lauf_(
  heute: string,
  optionen: ErinnerungsOptionen
): Promise<LaufErgebnis> {
  const ergebnis: LaufErgebnis = {
    heute,
    kreise: 0,
    termine: 0,
    faellig: 0,
    neu: 0,
    mails: 0,
    fehler: 0
  }
  if (!gueltigesIsoDatum(heute)) {
    console.error(`[schutzkonzept] Erinnerungslauf: ungueltiges Datum ${heute}`)
    ergebnis.fehler++
    return ergebnis
  }
  const sende =
    optionen.sende ??
    ((to: string, subject: string, html: string) =>
      // Kein Geheimnis in der Mail, also nichts zu schwaerzen.
      sendePortalMail(to, subject, html, ''))

  let staende: ErinnerungsStand[]
  try {
    staende = optionen.staende ?? (await ladeVeroeffentlichteStaende())
  } catch (err) {
    console.error('[schutzkonzept] Erinnerungslauf: Staende nicht ladbar:', err)
    ergebnis.fehler++
    return ergebnis
  }

  // Definitionen je Formularversion nur einmal laden (alle Kreise teilen
  // sich meist eine), Verwalter nur, wenn wirklich etwas ueberfaellig ist.
  const definitionen = new Map<number, Definition>()
  let verwalterListe: string[] | null = null
  const verwalter = async () => (verwalterListe ??= await verwalterEmails())

  for (const s of staende) {
    ergebnis.kreise++
    try {
      let def = optionen.definition ?? definitionen.get(s.formularVersionID)
      if (!def) {
        def = (await ladeDefinition(s.formularVersionID)).definition
        definitionen.set(s.formularVersionID, def)
      }
      await kreisErinnern(s, def, heute, verwalter, sende, ergebnis)
    } catch (err) {
      ergebnis.fehler++
      console.error(
        `[schutzkonzept] Erinnerung kreis:${s.ecKreisID} stand:${s.standID} fehlgeschlagen:`,
        err
      )
    }
  }
  return ergebnis
}

/* ---------------------------------------------------- Portal: Anzeige -- */

/**
 * Anstehende Termine eines Kreises (aus dem zuletzt veroeffentlichten
 * Stand) und das Erinnerungs-Protokoll -- fuer das Kreisdetail im Portal.
 */
export async function anstehendeErinnerungen(
  ecKreisID: number,
  heute: string = heuteISO()
) {
  const staende = await queryP<{
    standID: number
    versionNr: number
    formularVersionID: number
    daten: string
  }>(
    `SELECT standID, versionNr, formularVersionID, daten FROM skKreisStand
      WHERE ecKreisID = ? AND status = 'published'
      ORDER BY versionNr DESC LIMIT 1`,
    [ecKreisID]
  )
  const protokoll = (
    await queryP<any>(
      `SELECT erinnerungID, standID, feld_key, zeile,
              DATE_FORMAT(datum, '%Y-%m-%d') AS datum, stufe, empfaenger,
              ${isoSql('gesendet')} AS gesendet
         FROM skErinnerung WHERE ecKreisID = ?
        ORDER BY gesendet DESC, erinnerungID DESC LIMIT 100`,
      [ecKreisID]
    )
  ).map((r) => ({
    erinnerungID: r.erinnerungID,
    standID: r.standID,
    feldKey: r.feld_key,
    zeile: r.zeile === -1 ? null : r.zeile,
    datum: r.datum,
    stufe: r.stufe,
    empfaenger: r.empfaenger,
    gesendet: r.gesendet
  }))
  const s = staende[0]
  if (!s) return { heute, stand: null, termine: [], protokoll }

  const { definition } = await ladeDefinition(s.formularVersionID)
  let daten: unknown = {}
  try {
    daten = JSON.parse(s.daten)
  } catch {
    /* keine Termine */
  }
  const gesendet = new Set(
    protokoll.map((p) =>
      protokollKey(p.feldKey, p.zeile ?? -1, p.datum, p.stufe)
    )
  )
  const termine = erinnerungsTermine(definition, daten)
    .map((t) => {
      const stufe = faelligeStufe(t, heute)
      return {
        feldKey: t.feldKey,
        zeile: t.zeile ?? null,
        bereichId: t.bereichId,
        abschnittId: t.abschnittId,
        feldId: t.feldId,
        label: t.label,
        datum: t.datumISO,
        tage: tageZwischen(heute, t.datumISO),
        ueberfaellig: t.datumISO < heute,
        /** Heute faellige Stufe (null = keine) ... */
        stufe,
        /** ... und ob sie schon verschickt wurde. */
        gesendet:
          !!stufe &&
          gesendet.has(protokollKey(t.feldKey, zeileVon(t), t.datumISO, stufe))
      }
    })
    .sort((a, b) => a.tage - b.tage)
  return {
    heute,
    stand: { standID: s.standID, versionNr: s.versionNr },
    termine,
    protokoll
  }
}

/* ------------------------------------------------------------- Der Job -- */

/** Pruefintervall; verschickt wird je Kalendertag hoechstens einmal. */
const INTERVALL_MS = 60 * 60 * 1000
/** Erster Lauf kurz nach dem Start (Neustart am Vormittag verschiebt nichts). */
const ERSTER_LAUF_MS = 2 * 60 * 1000
/** Nicht vor dieser Stunde (Europe/Berlin): keine Mails um drei Uhr nachts. */
const FRUEHESTE_STUNDE = 6

/** Stunde in deutscher Ortszeit, 0..23. */
function stundeBerlin(jetzt: Date = new Date()): number {
  const teile = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(jetzt)
  return Number(teile.find((p) => p.type === 'hour')?.value ?? 0)
}

let schemaDa = false

/** Ohne die Protokolltabelle laeuft nichts -- sonst ginge jede Mail taeglich. */
async function schemaVorhanden(): Promise<boolean> {
  if (schemaDa) return true
  const [{ n }] = await queryP<{ n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'skErinnerung'`
  )
  schemaDa = Number(n) === 1
  return schemaDa
}

/**
 * Taeglicher Job: stuendlich nachsehen, aber je Kalendertag (Europe/Berlin)
 * nur einmal laufen, fruehestens um FRUEHESTE_STUNDE. setInterval statt Cron,
 * weil die API ohnehin dauerhaft laeuft; ein verpasster Tag holt sich ueber
 * die Stufen-Fenster (faelligeStufe) selbst nach. Fehlt die Tabelle
 * skErinnerung, passiert still nichts -- das Modul ist dann noch nicht
 * eingerichtet (config.ts meldet fehlende Tabellen ohnehin).
 */
export function starteErinnerungsJob(): void {
  let zuletzt = ''
  const tick = async () => {
    const heute = heuteISO()
    if (heute === zuletzt || stundeBerlin() < FRUEHESTE_STUNDE) return
    if (!(await schemaVorhanden())) return
    zuletzt = heute
    const r = await erinnerungenVerschicken(heute)
    if (r.faellig || r.fehler) {
      console.log(
        `[schutzkonzept] Erinnerungslauf ${r.heute}: ${r.kreise} Kreise, ${r.termine} Termine, ${r.faellig} faellig, ${r.neu} neu, ${r.mails} Mails, ${r.fehler} Fehler`
      )
    }
    // Ein Lauf mit Fehlern (z. B. DB kurz weg) darf es in der naechsten
    // Stunde noch einmal versuchen; das Protokoll verhindert Doppeltes.
    if (r.fehler) zuletzt = ''
  }
  const sicher = () =>
    tick().catch((err) => {
      zuletzt = ''
      console.error('[schutzkonzept] Erinnerungslauf fehlgeschlagen:', err)
    })
  // unref: die Timer halten den Prozess nicht am Leben (Tests, sauberes Ende).
  setTimeout(sicher, ERSTER_LAUF_MS).unref()
  setInterval(sicher, INTERVALL_MS).unref()
}
