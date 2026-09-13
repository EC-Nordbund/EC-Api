import type { PoolConnection } from 'promise-mysql'
import { queryP, withConnection } from '../helpers/mysql'
import { PortalFehler, badRequest, notFound } from '../portal/error'
import { isoSql } from './config'
import {
  Definition,
  aktualisiereBestaetigungen,
  bereinigeBestaetigt,
  bereinigeDaten,
  docxDaten,
  fehlendePflichtfelder,
  felderVonBereich,
  fortschritt,
  heuteISO,
  migriereDaten,
  regelVerstoesse,
  uebernimmWerte,
  unbestaetigteAbschnitte,
  type AbschnittRef,
  type Fehlend,
  type Verstoss
} from './definition'
import {
  aktuelleVersion,
  konflikt,
  ladeDefinition,
  listeVorlagen,
  ladeVorlageDatei,
  maxPaketBytes,
  passtInPaket,
  renderePdf
} from './formular'

/**
 * Staende eines EC-Kreises: der eine offene Draft und die veroeffentlichten
 * Fassungen.
 *
 * Grundregel: bearbeitet wird immer auf der NEUESTEN veroeffentlichten
 * Formularversion. Ein neuer Draft uebernimmt die Daten des letzten
 * veroeffentlichten Stands; ein Draft, der noch auf einer aelteren
 * Formularversion liegt, wird beim Oeffnen migriert. Alte Antworten gehen
 * dabei nie verloren -- sie stehen unveraendert im veroeffentlichten Stand.
 *
 * Neben den Antworten (`daten`, flach) fuehrt ein Draft die Liste der als
 * "geprueft" bestaetigten Abschnitte (`abschnitte_bestaetigt`). Sie haengt an
 * den Werten: aendert ein Speichern die Werte eines Abschnitts, ist seine
 * Bestaetigung weg (aktualisiereBestaetigungen). Ein neuer Draft uebernimmt
 * Antworten, aber keine Bestaetigungen -- jeder Stand wird neu gelesen.
 *
 * Veroeffentlichen hat drei Sperren, in dieser Reihenfolge: Pflichtfelder,
 * Feldregeln, Bestaetigungen (pruefeVeroeffentlichbar).
 */

export interface StandKurz {
  standID: number
  versionNr: number
  status: 'draft' | 'published'
  formularVersionID: number
  formularVersionNr: number
  fortschritt: number
  revision: number
  erstellt: string
  geaendert: string
  geaendertVon: string
  publishedAm: string | null
  publishedVon: string | null
}

export interface PdfInfo {
  pdfID: number
  vorlageID: number
  dateiname: string
  groesse: number
}

const KURZ_SQL = `
  SELECT s.standID, s.versionNr, s.status, s.formularVersionID, fv.versionNr AS formularVersionNr,
         s.fortschritt, s.revision, s.geaendert_von, s.published_von,
         ${isoSql('s.erstellt')} AS erstellt, ${isoSql('s.geaendert')} AS geaendert,
         ${isoSql('s.published_am')} AS publishedAm
    FROM skKreisStand s
    JOIN skFormularVersion fv ON fv.formularVersionID = s.formularVersionID`

/**
 * `portal:<id>` in einen lesbaren Namen uebersetzen. E-Mails bleiben, wie sie
 * sind -- das ist genau die Information, die man sehen will.
 */
async function namen(werte: (string | null)[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      werte
        .filter((w): w is string => !!w && w.startsWith('portal:'))
        .map((w) => Number(w.slice(7)))
        .filter((n) => Number.isInteger(n))
    )
  ]
  const m = new Map<string, string>()
  if (ids.length === 0) return m
  const rows = await queryP<{
    portalUserID: number
    vorname: string
    nachname: string
  }>(
    `SELECT pu.portalUserID, p.vorname, p.nachname
       FROM portalUser pu JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const r of rows) {
    m.set(`portal:${r.portalUserID}`, `${r.vorname} ${r.nachname} (Verwaltung)`)
  }
  return m
}

async function kurz(rows: any[]): Promise<StandKurz[]> {
  const n = await namen(rows.flatMap((r) => [r.geaendert_von, r.published_von]))
  const lesbar = (w: string | null) => (w ? (n.get(w) ?? w) : null)
  return rows.map((r) => ({
    standID: r.standID,
    versionNr: r.versionNr,
    status: r.status,
    formularVersionID: r.formularVersionID,
    formularVersionNr: r.formularVersionNr,
    fortschritt: r.fortschritt,
    revision: r.revision,
    erstellt: r.erstellt,
    geaendert: r.geaendert,
    geaendertVon: lesbar(r.geaendert_von) ?? '',
    publishedAm: r.publishedAm,
    publishedVon: lesbar(r.published_von)
  }))
}

async function pdfsZu(standIDs: number[]): Promise<Map<number, PdfInfo[]>> {
  const m = new Map<number, PdfInfo[]>()
  if (standIDs.length === 0) return m
  const rows = await queryP<any>(
    `SELECT p.pdfID, p.standID, p.vorlageID, p.dateiname, p.groesse
       FROM skKreisPdf p
       JOIN skVorlage v ON v.vorlageID = p.vorlageID
      WHERE p.standID IN (${standIDs.map(() => '?').join(',')})
      ORDER BY v.sortierung, p.pdfID`,
    standIDs
  )
  for (const r of rows) {
    const liste = m.get(r.standID) ?? []
    liste.push({
      pdfID: r.pdfID,
      vorlageID: r.vorlageID,
      dateiname: r.dateiname,
      groesse: r.groesse
    })
    m.set(r.standID, liste)
  }
  return m
}

async function kreisName(ecKreisID: number): Promise<string> {
  const rows = await queryP<{ bezeichnung: string }>(
    'SELECT bezeichnung FROM ecKreis WHERE ecKreisID = ?',
    [ecKreisID]
  )
  if (rows.length !== 1) throw notFound('EC-Kreis nicht gefunden.')
  return rows[0].bezeichnung
}

/** Uebersicht eines Kreises: Draft, Historie mit PDFs, aktuelle Formularversion. */
export async function kreisUebersicht(ecKreisID: number) {
  const bezeichnung = await kreisName(ecKreisID)
  const aktuell = await aktuelleVersion()
  const staende = await kurz(
    await queryP(
      `${KURZ_SQL} WHERE s.ecKreisID = ? ORDER BY s.versionNr DESC`,
      [ecKreisID]
    )
  )
  const draft = staende.find((s) => s.status === 'draft') ?? null
  const historie = staende.filter((s) => s.status === 'published')
  const pdfs = await pdfsZu(historie.map((s) => s.standID))

  return {
    kreis: { ecKreisID, bezeichnung },
    aktuelleFormularVersion: aktuell
      ? {
          formularVersionID: aktuell.formularVersionID,
          versionNr: aktuell.versionNr
        }
      : null,
    draft: draft
      ? {
          ...draft,
          veraltet:
            !!aktuell && draft.formularVersionID !== aktuell.formularVersionID
        }
      : null,
    historie: historie.map((s) => ({
      ...s,
      veraltet: !!aktuell && s.formularVersionID !== aktuell.formularVersionID,
      pdfs: pdfs.get(s.standID) ?? []
    }))
  }
}

/** Uebersicht aller Kreise fuer den Verwalter. */
export async function alleKreise() {
  const aktuell = await aktuelleVersion()
  const kreise = await queryP<any>(
    `SELECT ec.ecKreisID, ec.bezeichnung,
            (SELECT COUNT(*) FROM skKreisEmail ke WHERE ke.ecKreisID = ec.ecKreisID) AS anzahlEmails
       FROM ecKreis ec ORDER BY ec.bezeichnung`
  )
  const staende = await kurz(
    await queryP(
      `${KURZ_SQL}
        WHERE s.status = 'draft'
           OR s.standID IN (SELECT MAX(x.standID) FROM skKreisStand x
                             WHERE x.status = 'published' GROUP BY x.ecKreisID)`
    )
  )
  const kreisVon = new Map<number, number>()
  for (const r of await queryP<{ standID: number; ecKreisID: number }>(
    'SELECT standID, ecKreisID FROM skKreisStand'
  )) {
    kreisVon.set(r.standID, r.ecKreisID)
  }

  return {
    aktuelleFormularVersion: aktuell
      ? {
          formularVersionID: aktuell.formularVersionID,
          versionNr: aktuell.versionNr
        }
      : null,
    kreise: kreise.map((k) => {
      const eigene = staende.filter(
        (s) => kreisVon.get(s.standID) === k.ecKreisID
      )
      const draft = eigene.find((s) => s.status === 'draft') ?? null
      const veroeffentlicht =
        eigene.find((s) => s.status === 'published') ?? null
      return {
        ecKreisID: k.ecKreisID,
        bezeichnung: k.bezeichnung,
        anzahlEmails: Number(k.anzahlEmails),
        draft,
        veroeffentlicht,
        veraltet:
          !!aktuell &&
          !!veroeffentlicht &&
          veroeffentlicht.formularVersionID !== aktuell.formularVersionID
      }
    })
  }
}

interface StandRow {
  standID: number
  ecKreisID: number
  formularVersionID: number
  versionNr: number
  status: 'draft' | 'published'
  daten: string
  bereiche_gespeichert: string
  /** JSON: Liste bestaetigter Abschnitt-IDs, siehe Kopfkommentar. */
  abschnitte_bestaetigt: string
  revision: number
}

async function ladeStandRow(
  ecKreisID: number,
  standID: number
): Promise<StandRow> {
  const rows = await queryP<StandRow>(
    `SELECT standID, ecKreisID, formularVersionID, versionNr, status, daten,
            bereiche_gespeichert, abschnitte_bestaetigt, revision
       FROM skKreisStand WHERE standID = ? AND ecKreisID = ?`,
    [standID, ecKreisID]
  )
  if (rows.length !== 1) throw notFound('Stand nicht gefunden.')
  return rows[0]
}

/**
 * Bestaetigte Abschnitte einer Zeile -- nur IDs, die es in dieser
 * Formularversion gibt (nach Migration oder Builder-Umbau koennen alte
 * stehen bleiben).
 */
const bestaetigtVon = (definition: Definition, row: StandRow): string[] =>
  bereinigeBestaetigt(definition, JSON.parse(row.abschnitte_bestaetigt))

/** Was dem Veroeffentlichen noch im Weg steht -- fuer Editor und Abschluss. */
export interface Pruefstand {
  /** JJJJ-MM-TT in Europe/Berlin; der Client rechnet Regeln damit nach. */
  heute: string
  fehlend: Fehlend[]
  verstoesse: Verstoss[]
  unbestaetigt: AbschnittRef[]
}

export function pruefstand(
  definition: Definition,
  daten: any,
  bestaetigt: string[],
  heute = heuteISO()
): Pruefstand {
  return {
    heute,
    fehlend: fehlendePflichtfelder(definition, daten),
    verstoesse: regelVerstoesse(definition, daten, heute),
    unbestaetigt: unbestaetigteAbschnitte(definition, bestaetigt)
  }
}

/**
 * Die drei Sperren vor dem Veroeffentlichen. Wirft je einen eigenen Code,
 * damit der Abschluss-Schritt die passende Liste zeigt; die Reihenfolge ist
 * die des Ausfuellens (erst ausfuellen, dann richtig, dann geprueft).
 */
export function pruefeVeroeffentlichbar(
  definition: Definition,
  daten: any,
  bestaetigt: string[],
  heute = heuteISO()
): void {
  const p = pruefstand(definition, daten, bestaetigt, heute)
  if (p.fehlend.length > 0) {
    throw new PortalFehler(
      'REQUIRED_MISSING',
      `Es fehlen noch ${p.fehlend.length} Pflichtangaben.`,
      400,
      { fehlend: p.fehlend }
    )
  }
  if (p.verstoesse.length > 0) {
    throw new PortalFehler(
      'RULES_VIOLATED',
      `${p.verstoesse.length} Angaben liegen außerhalb des erlaubten Bereichs.`,
      400,
      { verstoesse: p.verstoesse }
    )
  }
  if (p.unbestaetigt.length > 0) {
    throw new PortalFehler(
      'SECTIONS_UNCONFIRMED',
      `${p.unbestaetigt.length} Abschnitte sind noch nicht als geprüft bestätigt.`,
      400,
      { unbestaetigt: p.unbestaetigt }
    )
  }
}

/** Vollstaendiger Stand mit Definition -- fuer Anzeige und Editor. */
export async function ladeStand(ecKreisID: number, standID: number) {
  const row = await ladeStandRow(ecKreisID, standID)
  const [k] = await kurz(
    await queryP(`${KURZ_SQL} WHERE s.standID = ?`, [standID])
  )
  const { definition } = await ladeDefinition(row.formularVersionID)
  const daten = bereinigeDaten(definition, JSON.parse(row.daten))
  const bestaetigt = bestaetigtVon(definition, row)
  const pdfs = await pdfsZu([standID])
  return {
    kreis: { ecKreisID, bezeichnung: await kreisName(ecKreisID) },
    stand: {
      ...k,
      daten,
      bereicheGespeichert: JSON.parse(row.bereiche_gespeichert) as string[],
      abschnitteBestaetigt: bestaetigt
    },
    definition,
    vorlagen: (await listeVorlagen(row.formularVersionID)).map((v) => ({
      vorlageID: v.vorlageID,
      bezeichnung: v.bezeichnung
    })),
    pdfs: pdfs.get(standID) ?? [],
    ...pruefstand(definition, daten, bestaetigt)
  }
}

/**
 * Naechste Stand-Nummer des Kreises, monoton -- auch ueber verworfene
 * (geloeschte) Drafts hinweg. Ein blosses MAX(versionNr)+1 vergaebe die
 * Nummer eines verworfenen Drafts neu, und die stand schon in
 * Entwurfs-PDFs, die der Kreis herumgeschickt hat.
 *
 * Der Zaehler wird in der Transaktion des INSERT hochgezaehlt; das
 * INSERT ... ON DUPLICATE KEY UPDATE sperrt die Zaehlerzeile bis zum Commit,
 * zwei gleichzeitige Oeffnen-Klicks stehen also hintereinander an. Fehlt die
 * Zeile noch (Installation vor dem Zaehler), startet sie bei MAX(versionNr);
 * GREATEST haelt beides zusammen, falls die Zeile einmal hinter den Staenden
 * zurueckliegt.
 */
async function naechsteVersionNr(
  conn: PoolConnection,
  ecKreisID: number
): Promise<number> {
  // Bewusst zwei Statements statt INSERT ... SELECT: das wuerde die Staende
  // des Kreises mit Shared-Locks belegen, und zwei gleichzeitige
  // Oeffnen-Klicks liefen in einen Deadlock statt in das saubere
  // ER_DUP_ENTRY am draft_lock. Der Snapshot-Wert reicht: er dient nur als
  // Startwert, wenn es die Zaehlerzeile noch nicht gibt.
  const [{ m }]: { m: number }[] = await conn.query(
    'SELECT COALESCE(MAX(versionNr), 0) AS m FROM skKreisStand WHERE ecKreisID = ?',
    [ecKreisID]
  )
  await conn.query(
    `INSERT INTO skKreisZaehler (ecKreisID, letzte_versionNr) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         letzte_versionNr = GREATEST(letzte_versionNr + 1, VALUES(letzte_versionNr))`,
    [ecKreisID, Number(m) + 1]
  )
  const [{ nr }]: { nr: number }[] = await conn.query(
    'SELECT letzte_versionNr AS nr FROM skKreisZaehler WHERE ecKreisID = ?',
    [ecKreisID]
  )
  return Number(nr)
}

async function draftID(ecKreisID: number): Promise<number | null> {
  const rows = await queryP<{ standID: number }>(
    "SELECT standID FROM skKreisStand WHERE ecKreisID = ? AND status = 'draft'",
    [ecKreisID]
  )
  return rows[0]?.standID ?? null
}

const keinFormular = () =>
  new PortalFehler(
    'NO_FORM',
    'Es ist noch keine Formularversion veröffentlicht.',
    409
  )

/**
 * Draft oeffnen: anlegen, falls keiner existiert, und auf die neueste
 * Formularversion heben. Idempotent -- der Editor ruft das bei jedem Oeffnen.
 */
export async function oeffneDraft(ecKreisID: number, akteur: string) {
  await kreisName(ecKreisID)
  // Idempotent auch bei Gleichzeitigkeit: Zwei Tabs migrieren denselben
  // veralteten Draft, oder der Draft wird zwischen Anlegen und Lesen
  // veroeffentlicht. Der Verlierer liest dann einfach neu, statt 409 zu
  // melden -- der Editor koennte sonst gar nicht oeffnen.
  for (let versuch = 0; versuch < 3; versuch++) {
    const r = await oeffneDraftVersuch(ecKreisID, akteur)
    if (r !== null) return r
  }
  throw konflikt()
}

/** Ein Durchlauf von oeffneDraft; null = verloren gegen eine parallele Aenderung. */
async function oeffneDraftVersuch(ecKreisID: number, akteur: string) {
  const aktuell = await aktuelleVersion()
  if (!aktuell) throw keinFormular()

  // `as`, damit TypeScript die Zuweisung im Transaktions-Callback nicht
  // wegoptimiert (Narrowing auf null).
  let migriert = null as { vonVersionNr: number; nachVersionNr: number } | null
  const vorhanden = await draftID(ecKreisID)

  if (vorhanden === null) {
    try {
      await withConnection(async (conn) => {
        const basis: StandRow[] = await conn.query(
          `SELECT standID, formularVersionID, daten, bereiche_gespeichert FROM skKreisStand
            WHERE ecKreisID = ? AND status = 'published'
            ORDER BY versionNr DESC LIMIT 1`,
          [ecKreisID]
        )
        let daten = {}
        let gespeichert: string[] = []
        if (basis[0]) {
          const alt = await ladeDefinition(basis[0].formularVersionID)
          daten = migriereDaten(
            alt.definition,
            aktuell.definition,
            JSON.parse(basis[0].daten)
          )
          if (basis[0].formularVersionID !== aktuell.formularVersionID) {
            migriert = {
              vonVersionNr: alt.versionNr,
              nachVersionNr: aktuell.versionNr
            }
          }
          gespeichert = aktuell.definition.bereiche.map((b) => b.id)
          // Neue Bereiche einer neuen Formularversion sind noch nicht gesehen.
          if (migriert) {
            const alteIds = new Set(alt.definition.bereiche.map((b) => b.id))
            gespeichert = gespeichert.filter((id) => alteIds.has(id))
          }
        }
        const nr = await naechsteVersionNr(conn, ecKreisID)
        // abschnitte_bestaetigt = '[]': Antworten werden uebernommen,
        // Bestaetigungen nicht -- ein neuer Stand wird komplett neu gelesen.
        await conn.query(
          `INSERT INTO skKreisStand
             (ecKreisID, formularVersionID, versionNr, status, daten, fortschritt,
              bereiche_gespeichert, abschnitte_bestaetigt, basiert_auf_standID,
              erstellt_von, geaendert_von)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, '[]', ?, ?, ?)`,
          [
            ecKreisID,
            aktuell.formularVersionID,
            nr,
            JSON.stringify(daten),
            fortschritt(aktuell.definition, daten),
            JSON.stringify(gespeichert),
            basis[0]?.standID ?? null,
            akteur,
            akteur
          ]
        )
      })
    } catch (err: any) {
      // Zwei gleichzeitige Oeffnen-Klicks: der zweite verliert am UNIQUE auf
      // draft_lock (oder InnoDB opfert ihn als Deadlock-Verlierer) und nimmt
      // im naechsten Durchlauf den Draft des ersten (der ggf. noch migriert
      // werden muss). Der Rollback nimmt seinen Zaehlerschritt zurueck.
      if (err?.code !== 'ER_DUP_ENTRY' && err?.code !== 'ER_LOCK_DEADLOCK') {
        throw err
      }
      return null
    }
  } else {
    let row: StandRow
    try {
      row = await ladeStandRow(ecKreisID, vorhanden)
    } catch (err) {
      // Zwischen draftID() und hier verworfen oder veroeffentlicht.
      if (err instanceof PortalFehler && err.code === 'NOT_FOUND') return null
      throw err
    }
    if (row.status !== 'draft') return null
    if (row.formularVersionID !== aktuell.formularVersionID) {
      const alt = await ladeDefinition(row.formularVersionID)
      const alteDaten = bereinigeDaten(alt.definition, JSON.parse(row.daten))
      const daten = migriereDaten(alt.definition, aktuell.definition, alteDaten)
      const neueIds = new Set(aktuell.definition.bereiche.map((b) => b.id))
      const alteIds = new Set(alt.definition.bereiche.map((b) => b.id))
      const gespeichert = (
        JSON.parse(row.bereiche_gespeichert) as string[]
      ).filter((id) => neueIds.has(id) && alteIds.has(id))
      // Bestaetigungen ueberleben die Migration nur fuer Abschnitte, die es
      // noch gibt UND deren Werte unveraendert sind: Ein umgebautes Feld
      // (neuer Key, geaenderter Typ, weggefallen) aendert den Hash, und der
      // Abschnitt muss neu gelesen werden. Neue Abschnitte sind ohnehin
      // unbestaetigt.
      const bestaetigt = aktualisiereBestaetigungen(
        aktuell.definition,
        bestaetigtVon(aktuell.definition, row),
        alteDaten,
        daten,
        []
      )
      const r: any = await queryP(
        `UPDATE skKreisStand
            SET formularVersionID = ?, daten = ?, fortschritt = ?, bereiche_gespeichert = ?,
                abschnitte_bestaetigt = ?,
                revision = revision + 1, geaendert = NOW(), geaendert_von = ?
          WHERE standID = ? AND status = 'draft' AND revision = ?`,
        [
          aktuell.formularVersionID,
          JSON.stringify(daten),
          fortschritt(aktuell.definition, daten),
          JSON.stringify(gespeichert),
          JSON.stringify(bestaetigt),
          akteur,
          row.standID,
          row.revision
        ]
      )
      // Jemand anderes hat zwischenzeitlich gespeichert oder migriert.
      if (!r || r.affectedRows !== 1) return null
      migriert = {
        vonVersionNr: alt.versionNr,
        nachVersionNr: aktuell.versionNr
      }
    }
  }

  const id = await draftID(ecKreisID)
  if (id === null) return null
  try {
    return { ...(await ladeStand(ecKreisID, id)), migriert }
  } catch (err) {
    if (err instanceof PortalFehler && err.code === 'NOT_FOUND') return null
    throw err
  }
}

async function ladeDraftFuerAenderung(
  ecKreisID: number,
  revisionRoh: unknown
): Promise<{ row: StandRow; definition: Definition; revision: number }> {
  const revision = Number(revisionRoh)
  if (!Number.isInteger(revision))
    throw badRequest('INVALID_INPUT', 'revision fehlt.')
  const id = await draftID(ecKreisID)
  if (id === null) {
    throw new PortalFehler(
      'NO_DRAFT',
      'Es gibt keinen Stand in Bearbeitung.',
      409
    )
  }
  const row = await ladeStandRow(ecKreisID, id)
  if (row.revision !== revision) throw konflikt()
  const aktuell = await aktuelleVersion()
  if (!aktuell || aktuell.formularVersionID !== row.formularVersionID) {
    throw formularVeraltet()
  }
  return { row, definition: aktuell.definition, revision }
}

const formularVeraltet = () =>
  new PortalFehler(
    'FORM_OUTDATED',
    'Inzwischen gibt es eine neue Formularversion. Bitte die Seite neu laden – deine Angaben werden übernommen.',
    409
  )

/**
 * Speichern beim Klick auf "Weiter": nur die Felder eines Bereichs.
 *
 * Body: { revision, werte, bestaetigt?: string[] }. `bestaetigt` sind die
 * Abschnitt-IDs, deren Button "Geprueft und bestaetigt" gedrueckt ist -- nur
 * Abschnitte DIESES Bereichs zaehlen, fremde IDs werden ignoriert. Fehlt das
 * Feld, gilt []: Abschnitte, deren Werte sich mit diesem Speichern aendern,
 * verlieren ihre Bestaetigung, unveraenderte behalten sie.
 */
export async function speichereBereich(
  ecKreisID: number,
  bereichId: string,
  body: any,
  akteur: string
) {
  const { row, definition, revision } = await ladeDraftFuerAenderung(
    ecKreisID,
    body?.revision
  )
  const bereich = definition.bereiche.find((b) => b.id === bereichId)
  if (!bereich) throw notFound('Bereich nicht gefunden.')

  const datenVorher = bereinigeDaten(definition, JSON.parse(row.daten))
  // Kopie: uebernimmWerte schreibt in sein Ziel, und datenVorher wird gleich
  // noch fuer den Vorher/Nachher-Vergleich der Bestaetigungen gebraucht.
  const daten = uebernimmWerte(felderVonBereich(bereich), body?.werte, {
    ...datenVorher
  })
  const gespeichert = new Set<string>(JSON.parse(row.bereiche_gespeichert))
  gespeichert.add(bereichId)
  const prozent = fortschritt(definition, daten)
  const eigene = new Set(bereich.abschnitte.map((a) => a.id))
  const gesendet = Array.isArray(body?.bestaetigt)
    ? new Set(
        bereinigeBestaetigt(definition, body.bestaetigt).filter((id) =>
          eigene.has(id)
        )
      )
    : null
  let bestaetigt = aktualisiereBestaetigungen(
    definition,
    bestaetigtVon(definition, row),
    datenVorher,
    daten,
    gesendet ? [...gesendet] : []
  )
  // Schickt der Client die Liste mit, ist sie fuer DIESEN Bereich die
  // Wahrheit: ein Abschnitt, der nicht drinsteht, verliert seine Bestaetigung
  // auch bei unveraenderten Werten ("Bestaetigung zuruecknehmen"). Ohne Liste
  // (aeltere Clients) gilt allein die Wert-Aenderung.
  if (gesendet) {
    bestaetigt = bestaetigt.filter((id) => !eigene.has(id) || gesendet.has(id))
  }

  const r: any = await queryP(
    `UPDATE skKreisStand
        SET daten = ?, fortschritt = ?, bereiche_gespeichert = ?, abschnitte_bestaetigt = ?,
            revision = revision + 1, geaendert = NOW(), geaendert_von = ?
      WHERE standID = ? AND status = 'draft' AND revision = ?`,
    [
      JSON.stringify(daten),
      prozent,
      JSON.stringify([...gespeichert]),
      JSON.stringify(bestaetigt),
      akteur,
      row.standID,
      revision
    ]
  )
  if (!r || r.affectedRows !== 1) throw konflikt()

  return {
    revision: revision + 1,
    fortschritt: prozent,
    bereicheGespeichert: [...gespeichert],
    abschnitteBestaetigt: bestaetigt,
    ...pruefstand(definition, daten, bestaetigt)
  }
}

/**
 * Draft loeschen. Seine Nummer wird nicht neu vergeben (skKreisZaehler,
 * siehe naechsteVersionNr) -- der naechste Draft heisst "Stand n+1".
 */
export async function verwirfDraft(
  ecKreisID: number,
  revisionRoh: unknown
): Promise<void> {
  const { row, revision } = await ladeDraftFuerAenderungOhneVersion(
    ecKreisID,
    revisionRoh
  )
  const r: any = await queryP(
    "DELETE FROM skKreisStand WHERE standID = ? AND status = 'draft' AND revision = ?",
    [row.standID, revision]
  )
  if (!r || r.affectedRows !== 1) throw konflikt()
}

/** Verwerfen geht auch mit veralteter Formularversion. */
async function ladeDraftFuerAenderungOhneVersion(
  ecKreisID: number,
  revisionRoh: unknown
) {
  const revision = Number(revisionRoh)
  if (!Number.isInteger(revision))
    throw badRequest('INVALID_INPUT', 'revision fehlt.')
  const id = await draftID(ecKreisID)
  if (id === null) {
    throw new PortalFehler(
      'NO_DRAFT',
      'Es gibt keinen Stand in Bearbeitung.',
      409
    )
  }
  const row = await ladeStandRow(ecKreisID, id)
  if (row.revision !== revision) throw konflikt()
  return { row, revision }
}

const heuteDe = () => {
  // Datum des Veroeffentlichens in deutscher Ortszeit, unabhaengig von der
  // Zeitzone des Servers.
  return new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })
}

/** Vorschau-PDF des Drafts fuer eine Vorlage (nicht gespeichert). */
export async function vorschauPdf(ecKreisID: number, vorlageID: number) {
  const id = await draftID(ecKreisID)
  if (id === null) {
    throw new PortalFehler(
      'NO_DRAFT',
      'Es gibt keinen Stand in Bearbeitung.',
      409
    )
  }
  const row = await ladeStandRow(ecKreisID, id)
  const { definition, versionNr } = await ladeDefinition(row.formularVersionID)
  const v = await ladeVorlageDatei(vorlageID)
  if (v.formularVersionID !== row.formularVersionID)
    throw notFound('Vorlage nicht gefunden.')
  const kreis = await kreisName(ecKreisID)
  const pdf = await renderePdf(
    v.inhalt,
    docxDaten(definition, JSON.parse(row.daten), {
      kreis,
      standVersion: row.versionNr,
      formularVersion: versionNr,
      datum: heuteDe(),
      entwurf: true
    })
  )
  return { pdf, dateiname: `ENTWURF ${v.bezeichnung} ${kreis}.pdf` }
}

/**
 * Veroeffentlichen: Pflichtfelder, Regeln und Bestaetigungen pruefen, alle
 * PDFs erzeugen, dann in einer Transaktion PDFs speichern und den Stand
 * einfrieren.
 *
 * Die PDFs entstehen VOR der Transaktion (Gotenberg braucht Sekunden, die
 * Zeile soll nicht so lange gesperrt sein). Die Revision stellt sicher, dass
 * genau die gerenderten Daten veroeffentlicht werden -- hat jemand
 * zwischendurch gespeichert, gibt es 409 und nichts ist passiert.
 */
export async function veroeffentlicheDraft(
  ecKreisID: number,
  revisionRoh: unknown,
  akteur: string
): Promise<{ standID: number }> {
  const { row, definition, revision } = await ladeDraftFuerAenderung(
    ecKreisID,
    revisionRoh
  )
  const daten = bereinigeDaten(definition, JSON.parse(row.daten))
  // Die Bestaetigungen aus genau dieser Revision: hat jemand seit dem
  // Bestaetigen gespeichert, passt die Revision nicht mehr (409 oben), und
  // was das Speichern an Bestaetigungen zurueckgesetzt hat, gilt hier.
  pruefeVeroeffentlichbar(definition, daten, bestaetigtVon(definition, row))

  const { versionNr } = await ladeDefinition(row.formularVersionID)
  const kreis = await kreisName(ecKreisID)
  const vorlagen = await listeVorlagen(row.formularVersionID)
  // Zweite Absicherung zur Formular-Pruefung: Ein Stand ohne ein einziges
  // PDF waere wertlos und liesse sich nicht mehr korrigieren.
  if (vorlagen.length === 0) {
    throw new PortalFehler(
      'NO_TEMPLATES',
      'Für die aktuelle Formularversion sind keine Vorlagen hinterlegt. Bitte die Schutzkonzept-Verwaltung informieren.',
      500
    )
  }
  const pdfs: { vorlageID: number; dateiname: string; pdf: Buffer }[] = []
  for (const v of vorlagen) {
    const datei = await ladeVorlageDatei(v.vorlageID)
    pdfs.push({
      vorlageID: v.vorlageID,
      dateiname:
        `${v.bezeichnung} ${kreis} (Stand ${row.versionNr}).pdf`.replace(
          /[\\/"]/g,
          '_'
        ),
      pdf: await renderePdf(
        datei.inhalt,
        docxDaten(definition, daten, {
          kreis,
          standVersion: row.versionNr,
          formularVersion: versionNr,
          datum: heuteDe(),
          entwurf: false
        })
      )
    })
  }

  // Vor der Transaktion: Ein zu grosses PDF liesse den INSERT mit
  // ER_NET_PACKET_TOO_LARGE scheitern (MariaDB trennt dabei die Verbindung),
  // der Kreis saehe nur "Unerwarteter Fehler" und rendert bei jedem Versuch
  // erneut. Beheben kann das nur die Verwaltung.
  const maxPaket = await maxPaketBytes()
  for (const p of pdfs) {
    if (!passtInPaket(p.pdf.length, maxPaket)) {
      console.error(
        `[schutzkonzept] PDF zu gross fuer max_allowed_packet: ${p.pdf.length} Bytes, Grenze ${maxPaket}, vorlageID ${p.vorlageID}`
      )
      throw new PortalFehler(
        'TOO_LARGE',
        `Das PDF „${p.dateiname}“ ist mit ${(p.pdf.length / 1024 / 1024).toFixed(1)} MB zu groß für die Datenbank und kann nicht gespeichert werden. Bitte die Schutzkonzept-Verwaltung informieren (Vorlage verkleinern oder max_allowed_packet erhöhen). Deine Angaben bleiben erhalten.`,
        500
      )
    }
  }

  await withConnection(async (conn) => {
    const gesperrt: { revision: number; status: string }[] = await conn.query(
      'SELECT revision, status FROM skKreisStand WHERE standID = ? FOR UPDATE',
      [row.standID]
    )
    if (gesperrt[0]?.status !== 'draft' || gesperrt[0].revision !== revision) {
      throw konflikt()
    }
    // Die Formularversion kann waehrend des Renderns veroeffentlicht worden
    // sein (ladeDraftFuerAenderung prueft nur davor). Sperrend lesen, damit
    // ein gerade laufendes Formular-Publish abgewartet wird. Rollback
    // verwirft die PDFs, der Draft bleibt und wird beim Neuladen migriert.
    const neueste: { formularVersionID: number }[] = await conn.query(
      `SELECT formularVersionID FROM skFormularVersion
        WHERE status = 'published' ORDER BY versionNr DESC LIMIT 1 LOCK IN SHARE MODE`
    )
    if (neueste[0]?.formularVersionID !== row.formularVersionID) {
      throw formularVeraltet()
    }
    for (const p of pdfs) {
      await conn.query(
        'INSERT INTO skKreisPdf (standID, vorlageID, dateiname, inhalt, groesse) VALUES (?,?,?,?,?)',
        [row.standID, p.vorlageID, p.dateiname, p.pdf, p.pdf.length]
      )
    }
    await conn.query(
      `UPDATE skKreisStand
          SET status = 'published', daten = ?, fortschritt = ?, published_am = NOW(),
              published_von = ?, revision = revision + 1
        WHERE standID = ? AND status = 'draft' AND revision = ?`,
      [
        JSON.stringify(daten),
        fortschritt(definition, daten),
        akteur,
        row.standID,
        revision
      ]
    )
  })
  return { standID: row.standID }
}

export async function ladePdf(
  pdfID: number,
  ecKreisID: number | null
): Promise<{ inhalt: Buffer; dateiname: string }> {
  const rows = await queryP<any>(
    `SELECT p.inhalt, p.dateiname, s.ecKreisID
       FROM skKreisPdf p JOIN skKreisStand s ON s.standID = p.standID
      WHERE p.pdfID = ?`,
    [pdfID]
  )
  // Fremder Kreis -> 404 statt 403: verraet nicht, dass es die ID gibt.
  if (
    rows.length !== 1 ||
    (ecKreisID !== null && rows[0].ecKreisID !== ecKreisID)
  ) {
    throw notFound('PDF nicht gefunden.')
  }
  return { inhalt: rows[0].inhalt, dateiname: rows[0].dateiname }
}
