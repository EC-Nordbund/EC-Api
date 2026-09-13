import { createHash } from 'crypto'
import type { PoolConnection } from 'promise-mysql'
import worker from 'comlink:../workers/generation'
import { queryP, withConnection } from '../helpers/mysql'
import { PortalFehler, badRequest, notFound } from '../portal/error'
import {
  DOCX_MIME,
  MAX_VORLAGE_BYTES,
  RENDER_MAX_PARALLEL,
  RENDER_MAX_WARTEND,
  RENDER_WARTEZEIT_MS,
  isoSql
} from './config'
import {
  Definition,
  beispielDaten,
  docxDaten,
  normalisiereDefinition,
  pruefeDefinition,
  type Pruefung
} from './definition'
import {
  type Befehl,
  befehlsFehlerText,
  extrahiereKeys,
  pruefeBefehle,
  VORLAGE_UNZULAESSIG
} from './platzhalter'

/**
 * Versionen des Schutzkonzept-Formulars.
 *
 * Lebenszyklus: neue Version (Kopie der letzten veroeffentlichten, inklusive
 * Vorlagen) -> Draft bearbeiten -> veroeffentlichen -> eingefroren.
 * Hoechstens ein Draft zur Zeit (UNIQUE auf draft_lock), veroeffentlichte
 * Zeilen schuetzen Trigger in der DB.
 */

export const konflikt = () =>
  new PortalFehler(
    'CONFLICT',
    'Jemand anderes hat zwischenzeitlich gespeichert. Bitte neu laden.',
    409
  )

const nurDraft = () =>
  new PortalFehler(
    'PUBLISHED',
    'Diese Version ist veröffentlicht und kann nicht mehr geändert werden.',
    409
  )

export interface VersionKopf {
  formularVersionID: number
  versionNr: number
  status: 'draft' | 'published'
  notiz: string
  revision: number
  erstellt: string
  erstelltVon: string
  geaendert: string
  publishedAm: string | null
  publishedVon: string | null
  anzahlVorlagen: number
  anzahlStaende: number
}

const KOPF_SQL = `
  SELECT v.formularVersionID, v.versionNr, v.status, v.notiz, v.revision,
         ${isoSql('v.erstellt')} AS erstellt, ${isoSql('v.geaendert')} AS geaendert,
         ${isoSql('v.published_am')} AS publishedAm,
         CONCAT(pe.vorname, ' ', pe.nachname) AS erstelltVon,
         CONCAT(pp.vorname, ' ', pp.nachname) AS publishedVon,
         (SELECT COUNT(*) FROM skVorlage x WHERE x.formularVersionID = v.formularVersionID) AS anzahlVorlagen,
         (SELECT COUNT(*) FROM skKreisStand s WHERE s.formularVersionID = v.formularVersionID) AS anzahlStaende
    FROM skFormularVersion v
    LEFT JOIN portalUser ue ON ue.portalUserID = v.erstellt_von
    LEFT JOIN personen pe ON pe.personID = ue.personID
    LEFT JOIN portalUser up ON up.portalUserID = v.published_von
    LEFT JOIN personen pp ON pp.personID = up.personID`

const kopf = (r: any): VersionKopf => ({
  formularVersionID: r.formularVersionID,
  versionNr: r.versionNr,
  status: r.status,
  notiz: r.notiz,
  revision: r.revision,
  erstellt: r.erstellt,
  erstelltVon: r.erstelltVon ?? '',
  geaendert: r.geaendert,
  publishedAm: r.publishedAm,
  publishedVon: r.publishedVon,
  anzahlVorlagen: Number(r.anzahlVorlagen),
  anzahlStaende: Number(r.anzahlStaende)
})

export async function listeVersionen(): Promise<VersionKopf[]> {
  const rows = await queryP(`${KOPF_SQL} ORDER BY v.versionNr DESC`)
  return rows.map(kopf)
}

/** Neueste veroeffentlichte Version (nur Kopf + Definition). */
export async function aktuelleVersion(): Promise<{
  formularVersionID: number
  versionNr: number
  definition: Definition
} | null> {
  const rows = await queryP<any>(
    `SELECT formularVersionID, versionNr, definition FROM skFormularVersion
      WHERE status = 'published' ORDER BY versionNr DESC LIMIT 1`
  )
  if (rows.length === 0) return null
  return {
    formularVersionID: rows[0].formularVersionID,
    versionNr: rows[0].versionNr,
    definition: normalisiereDefinition(JSON.parse(rows[0].definition))
  }
}

export async function ladeDefinition(
  formularVersionID: number
): Promise<{ versionNr: number; status: string; definition: Definition }> {
  const rows = await queryP<any>(
    'SELECT versionNr, status, definition FROM skFormularVersion WHERE formularVersionID = ?',
    [formularVersionID]
  )
  if (rows.length !== 1) throw notFound('Formularversion nicht gefunden.')
  return {
    versionNr: rows[0].versionNr,
    status: rows[0].status,
    definition: normalisiereDefinition(JSON.parse(rows[0].definition))
  }
}

export interface VorlageInfo {
  vorlageID: number
  bezeichnung: string
  dateiname: string
  sortierung: number
  groesse: number
  sha256: string
  platzhalter: string[]
  erstellt: string
}

const VORLAGEN_SQL = `
  SELECT vorlageID, bezeichnung, dateiname, sortierung, groesse, sha256, platzhalter,
         ${isoSql('erstellt')} AS erstellt
    FROM skVorlage WHERE formularVersionID = ?
   ORDER BY sortierung, vorlageID`

const vorlageInfo = (r: any): VorlageInfo => ({
  ...r,
  platzhalter: JSON.parse(r.platzhalter)
})

export async function listeVorlagen(
  formularVersionID: number
): Promise<VorlageInfo[]> {
  const rows = await queryP<any>(VORLAGEN_SQL, [formularVersionID])
  return rows.map(vorlageInfo)
}

/**
 * Sperrt die Versionszeile bis zum Ende der Transaktion und stellt sicher,
 * dass sie noch ein Draft ist.
 *
 * Jeder Schreibpfad einer Formularversion (Veroeffentlichen, Verwerfen,
 * Vorlagen) laeuft ueber diese Sperre. Nur so ist "veroeffentlicht =
 * eingefroren" auch fuer ueberlappende Anfragen wahr: Die Trigger auf
 * skVorlage pruefen den Status mit einem nicht sperrenden Lesen und sehen ein
 * noch nicht committetes Publish als 'draft'.
 */
async function sperreDraft(
  conn: PoolConnection,
  formularVersionID: number
): Promise<{ revision: number; definition: string }> {
  const rows: any[] = await conn.query(
    `SELECT status, revision, definition FROM skFormularVersion
      WHERE formularVersionID = ? FOR UPDATE`,
    [formularVersionID]
  )
  if (rows.length !== 1) throw notFound('Formularversion nicht gefunden.')
  if (rows[0].status !== 'draft') throw nurDraft()
  return { revision: rows[0].revision, definition: rows[0].definition }
}

/**
 * Optionale Revision (Query-Parameter) -- fehlt sie, wird nicht verglichen,
 * damit aeltere Clients weiter funktionieren.
 */
function optionaleRevision(roh: unknown): number | null {
  if (roh === undefined || roh === null || roh === '') return null
  const revision = Number(roh)
  if (!Number.isInteger(revision))
    throw badRequest('INVALID_INPUT', 'revision ist ungültig.')
  return revision
}

async function pruefung(
  def: Definition,
  vorlagen: VorlageInfo[]
): Promise<Pruefung> {
  return pruefeDefinition(
    def,
    vorlagen.map((v) => ({ vorlage: v.bezeichnung, keys: v.platzhalter }))
  )
}

export async function ladeVersion(formularVersionID: number) {
  const rows = await queryP<any>(`${KOPF_SQL} WHERE v.formularVersionID = ?`, [
    formularVersionID
  ])
  if (rows.length !== 1) throw notFound('Formularversion nicht gefunden.')
  const { definition } = await ladeDefinition(formularVersionID)
  const vorlagen = await listeVorlagen(formularVersionID)
  return {
    version: { ...kopf(rows[0]), definition },
    vorlagen,
    pruefung: await pruefung(definition, vorlagen)
  }
}

/**
 * Neue Version als Draft: Kopie der neuesten veroeffentlichten Version samt
 * Vorlagen. Gibt es noch keine, startet sie leer.
 */
export async function neueVersion(
  portalUserID: number,
  notiz: unknown
): Promise<number> {
  try {
    return await withConnection(async (conn) => {
      // Sperrend lesen: Ein nicht sperrendes SELECT liest aus dem Snapshot und
      // saehe einen gerade committeten Publish noch als Draft -- die neue
      // Version wuerde dann still auf der Vorvorversion aufsetzen. FOR UPDATE
      // wartet auf ein laufendes Publish und liest danach den aktuellen Stand.
      const basis: any[] = await conn.query(
        `SELECT formularVersionID, versionNr, definition FROM skFormularVersion
          WHERE status = 'published' ORDER BY versionNr DESC LIMIT 1 FOR UPDATE`
      )
      // Offener Draft? Frueher ergab sich das aus MAX(versionNr) = Basis + 1;
      // mit dem monotonen Zaehler stimmt diese Rechnung nach einem Verwerfen
      // nicht mehr, deshalb direkt nachsehen (sperrend, wie die Basis). Der
      // UNIQUE auf draft_lock faengt es auch ab, siehe catch unten.
      const offen: any[] = await conn.query(
        "SELECT formularVersionID FROM skFormularVersion WHERE status = 'draft' FOR UPDATE"
      )
      if (offen.length > 0) throw draftVorhanden()
      const nr = await naechsteFormularVersionNr(conn)
      const r: any = await conn.query(
        `INSERT INTO skFormularVersion
           (versionNr, status, definition, notiz, basiert_auf_versionID, erstellt_von)
         VALUES (?, 'draft', ?, ?, ?, ?)`,
        [
          nr,
          basis[0]?.definition ?? JSON.stringify({ bereiche: [] }),
          typeof notiz === 'string' ? notiz.slice(0, 1000) : '',
          basis[0]?.formularVersionID ?? null,
          portalUserID
        ]
      )
      if (basis[0]) {
        await conn.query(
          `INSERT INTO skVorlage
             (formularVersionID, bezeichnung, dateiname, sortierung, inhalt, sha256, groesse, platzhalter)
           SELECT ?, bezeichnung, dateiname, sortierung, inhalt, sha256, groesse, platzhalter
             FROM skVorlage WHERE formularVersionID = ?`,
          [r.insertId, basis[0].formularVersionID]
        )
      }
      return r.insertId as number
    })
  } catch (err: any) {
    // Deadlock: zwei gleichzeitige "Neue Version"-Klicks; einer gewinnt. Der
    // Zaehlerschritt des Verlierers geht mit dem Rollback zurueck.
    if (err?.code === 'ER_DUP_ENTRY' || err?.code === 'ER_LOCK_DEADLOCK') {
      throw draftVorhanden()
    }
    throw err
  }
}

/**
 * Naechste Formularversions-Nummer, monoton auch ueber verworfene
 * (geloeschte) Drafts hinweg -- ein blosses MAX(versionNr)+1 vergaebe die
 * Nummer eines verworfenen Drafts neu, und die stand schon in Test-PDFs
 * (meta_formular_version). Gleiches Muster wie naechsteVersionNr in stand.ts:
 * der Zaehler wird in der Transaktion des INSERT hochgezaehlt (die
 * Zaehlerzeile ist bis zum Commit gesperrt); fehlt die Zeile, startet sie
 * bei MAX(versionNr).
 */
async function naechsteFormularVersionNr(
  conn: PoolConnection
): Promise<number> {
  const [{ m }]: { m: number }[] = await conn.query(
    'SELECT COALESCE(MAX(versionNr), 0) AS m FROM skFormularVersion'
  )
  await conn.query(
    `INSERT INTO skFormularZaehler (id, letzte_versionNr) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE
         letzte_versionNr = GREATEST(letzte_versionNr + 1, VALUES(letzte_versionNr))`,
    [Number(m) + 1]
  )
  const [{ nr }]: { nr: number }[] = await conn.query(
    'SELECT letzte_versionNr AS nr FROM skFormularZaehler WHERE id = 1'
  )
  return Number(nr)
}

const draftVorhanden = () =>
  new PortalFehler(
    'DRAFT_EXISTS',
    'Es gibt bereits eine Version in Bearbeitung.',
    409
  )

/** Definition eines Drafts speichern (optimistische Sperre ueber revision). */
export async function speichereVersion(
  formularVersionID: number,
  body: any
): Promise<{ revision: number; pruefung: Pruefung; definition: Definition }> {
  const revision = Number(body?.revision)
  if (!Number.isInteger(revision))
    throw badRequest('INVALID_INPUT', 'revision fehlt.')
  const definition = normalisiereDefinition(body?.definition)

  const { status } = await ladeDefinition(formularVersionID)
  if (status !== 'draft') throw nurDraft()

  const r: any = await queryP(
    `UPDATE skFormularVersion
        SET definition = ?, notiz = ?, revision = revision + 1, geaendert = NOW()
      WHERE formularVersionID = ? AND status = 'draft' AND revision = ?`,
    [
      JSON.stringify(definition),
      typeof body?.notiz === 'string' ? body.notiz.slice(0, 1000) : '',
      formularVersionID,
      revision
    ]
  )
  if (!r || r.affectedRows !== 1) throw konflikt()
  return {
    revision: revision + 1,
    definition,
    pruefung: await pruefung(definition, await listeVorlagen(formularVersionID))
  }
}

/**
 * Veroeffentlichen. Pruefung und Statuswechsel laufen in EINER Transaktion
 * unter der Sperre der Versionszeile: Vorlagen-Aenderungen und Verwerfen
 * warten, bis das Publish committet ist (und scheitern dann an nurDraft).
 * Geprueft wird damit genau der Satz Vorlagen, der eingefroren wird.
 */
export async function veroeffentlicheVersion(
  formularVersionID: number,
  revisionRoh: unknown,
  portalUserID: number
): Promise<void> {
  const revision = Number(revisionRoh)
  if (!Number.isInteger(revision))
    throw badRequest('INVALID_INPUT', 'revision fehlt.')

  await withConnection(async (conn) => {
    const zeile = await sperreDraft(conn, formularVersionID)
    if (zeile.revision !== revision) throw konflikt()
    const definition = normalisiereDefinition(JSON.parse(zeile.definition))
    // LOCK IN SHARE MODE liest den aktuellen Stand statt des Snapshots.
    const vorlagen = (
      (await conn.query(`${VORLAGEN_SQL} LOCK IN SHARE MODE`, [
        formularVersionID
      ])) as any[]
    ).map(vorlageInfo)
    const p = await pruefung(definition, vorlagen)
    if (vorlagen.length === 0) {
      p.fehler.push({ text: 'Mindestens eine DOCX-Vorlage hochladen.' })
    }
    if (p.fehler.length > 0) {
      throw new PortalFehler(
        'VALIDATION',
        'Die Version hat noch Fehler und kann nicht veröffentlicht werden.',
        400,
        p
      )
    }
    const r: any = await conn.query(
      `UPDATE skFormularVersion
          SET status = 'published', published_am = NOW(), published_von = ?,
              revision = revision + 1
        WHERE formularVersionID = ? AND status = 'draft' AND revision = ?`,
      [portalUserID, formularVersionID, revision]
    )
    if (!r || r.affectedRows !== 1) throw konflikt()
  })
}

/**
 * Draft samt Vorlagen loeschen.
 *
 * `revisionRoh` (Query-Parameter `revision`) ist optional: Schickt der Client
 * sie mit, wird ein Draft, den inzwischen jemand gespeichert hat, nicht
 * geloescht (409), statt dessen Arbeit still zu vernichten.
 *
 * Die Nummer des verworfenen Drafts wird nicht neu vergeben
 * (skFormularZaehler, siehe naechsteFormularVersionNr).
 */
export async function verwirfVersion(
  formularVersionID: number,
  revisionRoh?: unknown
): Promise<void> {
  const revision = optionaleRevision(revisionRoh)
  await withConnection(async (conn) => {
    // Erst die Versionszeile sperren, dann loeschen: Ohne Sperre konnte ein
    // gleichzeitiges Publish die Vorlagen noch sehen, veroeffentlichen, und
    // das DELETE hier loeschte danach die Vorlagen einer veroeffentlichten
    // Version.
    const zeile = await sperreDraft(conn, formularVersionID)
    if (revision !== null && zeile.revision !== revision) throw konflikt()
    const [{ n }]: any[] = await conn.query(
      'SELECT COUNT(*) AS n FROM skKreisStand WHERE formularVersionID = ?',
      [formularVersionID]
    )
    if (Number(n) > 0) throw nurDraft() // kann ein Draft nie haben, nur zur Sicherheit
    await conn.query('DELETE FROM skVorlage WHERE formularVersionID = ?', [
      formularVersionID
    ])
    const r: any = await conn.query(
      "DELETE FROM skFormularVersion WHERE formularVersionID = ? AND status = 'draft'",
      [formularVersionID]
    )
    // Rollback (und damit auch der Vorlagen), falls die Zeile doch weg ist.
    if (!r || r.affectedRows !== 1) throw konflikt()
  })
}

/* ------------------------------------------------------------- Vorlagen -- */

function pruefeDocx(inhalt: unknown): Buffer {
  if (!Buffer.isBuffer(inhalt) || inhalt.length === 0) {
    throw badRequest(
      'INVALID_INPUT',
      `Bitte eine DOCX-Datei senden (Content-Type ${DOCX_MIME}).`
    )
  }
  if (inhalt.length > MAX_VORLAGE_BYTES) {
    throw badRequest(
      'TOO_LARGE',
      `Die Datei ist größer als ${MAX_VORLAGE_BYTES / 1024 / 1024} MB.`
    )
  }
  // DOCX (und DOCM) ist ein ZIP: "PK\x03\x04"
  if (inhalt.length < 4 || inhalt.readUInt32LE(0) !== 0x04034b50) {
    throw badRequest('INVALID_INPUT', 'Das ist keine DOCX-Datei.')
  }
  return inhalt
}

/** max_allowed_packet der Pool-Verbindungen (Session-Wert) in Bytes. */
export async function maxPaketBytes(): Promise<number> {
  const [{ p }] = await queryP<{ p: number }>(
    'SELECT @@max_allowed_packet AS p'
  )
  return Number(p)
}

/** Hex-Kodierung im Treiber: doppelte Groesse plus Luft fuer das Statement. */
export const passtInPaket = (bytes: number, maxPaket: number): boolean =>
  bytes * 2 + 64 * 1024 <= maxPaket

/**
 * Passt die Datei durch max_allowed_packet?
 *
 * Ohne diese Pruefung bricht der INSERT mit einem nichtssagenden
 * "Got a packet bigger than ..." ab und der Verwalter bekommt nur "Unerwarteter
 * Fehler". Der Treiber kodiert Binaerdaten als Hex -- doppelte Groesse plus
 * etwas Luft fuer das Statement.
 */
async function pruefePaketgroesse(bytes: number): Promise<void> {
  const p = await maxPaketBytes()
  if (!passtInPaket(bytes, p)) {
    throw badRequest(
      'TOO_LARGE',
      `Die Datei ist für die Datenbank zu groß (max_allowed_packet ${Math.round(
        Number(p) / 1024 / 1024
      )} MB). Bitte Vorlage verkleinern (z. B. eingebettete Schriften entfernen) oder max_allowed_packet erhöhen.`
    )
  }
}

/**
 * Befehle der Vorlage lesen, gegen die Whitelist pruefen und die
 * Variablennamen liefern (Abgleich mit dem Formular im Builder).
 *
 * Die Pruefung ist keine Formsache: jeder Platzhalter laeuft beim Rendern als
 * JavaScript im API-Prozess, siehe platzhalter.ts. Eine Vorlage mit EXEC oder
 * einem beliebigen Funktionsaufruf wird deshalb hier schon abgelehnt.
 */
async function platzhalterVon(inhalt: Buffer): Promise<string[]> {
  let befehle: Befehl[]
  try {
    // Entpacken und Parsen einer 10-MB-DOCX kostet so viel Speicher wie ein
    // Render -- deshalb durch dieselbe Drossel.
    befehle = await mitRenderSlot(() =>
      worker.schutzkonzeptBefehle(new Uint8Array(inhalt))
    )
  } catch (err: any) {
    if (err instanceof PortalFehler) throw err
    throw badRequest(
      'TEMPLATE_INVALID',
      `Die Vorlage ist fehlerhaft: ${String(err?.message ?? err).slice(0, 300)}`
    )
  }
  const unzulaessig = pruefeBefehle(befehle)
  if (unzulaessig.length > 0) {
    throw badRequest('TEMPLATE_INVALID', befehlsFehlerText(unzulaessig))
  }
  return extrahiereKeys(befehle)
}

function dateiname(roh: unknown): string {
  let n = 'vorlage.docx'
  try {
    if (typeof roh === 'string' && roh) n = decodeURIComponent(roh)
  } catch {
    /* Header nicht dekodierbar -> Standardname */
  }
  n = n.replace(/[\\/\r\n"]/g, '_').slice(0, 200)
  return /\.(docx|docm)$/i.test(n) ? n : `${n}.docx`
}

async function assertDraft(formularVersionID: number): Promise<void> {
  const { status } = await ladeDefinition(formularVersionID)
  if (status !== 'draft') throw nurDraft()
}

export async function ladeVorlageHoch(
  formularVersionID: number,
  inhaltRoh: unknown,
  dateinameRoh: unknown,
  bezeichnungRoh: unknown
): Promise<number> {
  await assertDraft(formularVersionID)
  const inhalt = pruefeDocx(inhaltRoh)
  await pruefePaketgroesse(inhalt.length)
  const platzhalter = await platzhalterVon(inhalt)
  const name = dateiname(dateinameRoh)
  let bezeichnung = name.replace(/\.(docx|docm)$/i, '')
  try {
    if (typeof bezeichnungRoh === 'string' && bezeichnungRoh) {
      bezeichnung = decodeURIComponent(bezeichnungRoh).slice(0, 200)
    }
  } catch {
    /* Standard behalten */
  }
  // assertDraft oben ist nur der schnelle Abbruch vor der Worker-Rechnung.
  // Verbindlich ist die Sperre hier: In den Sekunden dazwischen kann die
  // Version verworfen oder veroeffentlicht worden sein.
  return await withConnection(async (conn) => {
    await sperreDraft(conn, formularVersionID)
    const r: any = await conn.query(
      `INSERT INTO skVorlage
         (formularVersionID, bezeichnung, dateiname, sortierung, inhalt, sha256, groesse, platzhalter)
       SELECT ?, ?, ?, COALESCE(MAX(sortierung), 0) + 1, ?, ?, ?, ?
         FROM skVorlage WHERE formularVersionID = ?`,
      [
        formularVersionID,
        bezeichnung,
        name,
        inhalt,
        createHash('sha256').update(inhalt).digest('hex'),
        inhalt.length,
        JSON.stringify(platzhalter),
        formularVersionID
      ]
    )
    return r.insertId as number
  })
}

export async function ersetzeVorlage(
  formularVersionID: number,
  vorlageID: number,
  inhaltRoh: unknown,
  dateinameRoh: unknown
): Promise<void> {
  await assertDraft(formularVersionID)
  const inhalt = pruefeDocx(inhaltRoh)
  await pruefePaketgroesse(inhalt.length)
  const platzhalter = await platzhalterVon(inhalt)
  await withConnection(async (conn) => {
    await sperreDraft(conn, formularVersionID) // siehe ladeVorlageHoch
    const r: any = await conn.query(
      `UPDATE skVorlage SET inhalt = ?, dateiname = ?, sha256 = ?, groesse = ?, platzhalter = ?
        WHERE vorlageID = ? AND formularVersionID = ?`,
      [
        inhalt,
        dateiname(dateinameRoh),
        createHash('sha256').update(inhalt).digest('hex'),
        inhalt.length,
        JSON.stringify(platzhalter),
        vorlageID,
        formularVersionID
      ]
    )
    if (!r || r.affectedRows !== 1) throw notFound('Vorlage nicht gefunden.')
  })
}

export async function aendereVorlage(
  formularVersionID: number,
  vorlageID: number,
  body: any
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body?.bezeichnung === 'string' && body.bezeichnung.trim()) {
    sets.push('bezeichnung = ?')
    params.push(body.bezeichnung.trim().slice(0, 200))
  }
  if (Number.isInteger(body?.sortierung)) {
    sets.push('sortierung = ?')
    params.push(body.sortierung)
  }
  await withConnection(async (conn) => {
    // Sperre auch ohne Aenderung: Ein veroeffentlichter Draft soll 409
    // liefern, nicht still "OK".
    await sperreDraft(conn, formularVersionID)
    if (sets.length === 0) return
    const r: any = await conn.query(
      `UPDATE skVorlage SET ${sets.join(', ')} WHERE vorlageID = ? AND formularVersionID = ?`,
      [...params, vorlageID, formularVersionID]
    )
    if (!r || r.affectedRows !== 1) throw notFound('Vorlage nicht gefunden.')
  })
}

export async function loescheVorlage(
  formularVersionID: number,
  vorlageID: number
): Promise<void> {
  await withConnection(async (conn) => {
    await sperreDraft(conn, formularVersionID)
    const r: any = await conn.query(
      'DELETE FROM skVorlage WHERE vorlageID = ? AND formularVersionID = ?',
      [vorlageID, formularVersionID]
    )
    if (!r || r.affectedRows !== 1) throw notFound('Vorlage nicht gefunden.')
  })
}

export async function ladeVorlageDatei(vorlageID: number): Promise<{
  inhalt: Buffer
  dateiname: string
  formularVersionID: number
  bezeichnung: string
}> {
  const rows = await queryP<any>(
    'SELECT inhalt, dateiname, formularVersionID, bezeichnung FROM skVorlage WHERE vorlageID = ?',
    [vorlageID]
  )
  if (rows.length !== 1) throw notFound('Vorlage nicht gefunden.')
  return rows[0]
}

/** Test-PDF einer Vorlage mit Beispieldaten (nichts wird gespeichert). */
export async function testPdf(
  formularVersionID: number,
  vorlageID: number
): Promise<{ pdf: Buffer; dateiname: string }> {
  const { definition, versionNr } = await ladeDefinition(formularVersionID)
  const v = await ladeVorlageDatei(vorlageID)
  if (v.formularVersionID !== formularVersionID)
    throw notFound('Vorlage nicht gefunden.')
  const pdf = await renderePdf(
    v.inhalt,
    docxDaten(definition, beispielDaten(definition), {
      kreis: 'EC Beispielkreis',
      standVersion: 1,
      formularVersion: versionNr,
      datum: new Date().toLocaleDateString('de-DE'),
      entwurf: true
    })
  )
  return { pdf, dateiname: `TEST ${v.bezeichnung}.pdf` }
}

/* ------------------------------------------------------ Render-Drossel -- */

/*
 * Der Worker laeuft im selben Prozess wie Verwaltung, Portal und Anmeldung.
 * Eine DOCX mit eingebetteten Schriften (Rahmen-Schutzkonzept ~10 MB) belegt
 * je Render gut 100 MB; per Vorschau-Klick liessen sich beliebig viele
 * parallel ausloesen und die ganze API in den OOM-Killer treiben. Deshalb
 * hoechstens RENDER_MAX_PARALLEL gleichzeitig, weitere warten der Reihe nach
 * -- aber nicht endlos und nicht unbegrenzt viele (503 mit klarer Meldung).
 */
let renderLaufend = 0
const renderWartend: (() => void)[] = []

const ausgelastet = () =>
  new PortalFehler(
    'BUSY',
    'Gerade werden sehr viele PDFs erzeugt. Bitte in einer Minute erneut versuchen.',
    503
  )

export async function mitRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (renderLaufend < RENDER_MAX_PARALLEL) {
    renderLaufend++
  } else {
    if (renderWartend.length >= RENDER_MAX_WARTEND) throw ausgelastet()
    // Der frei werdende Slot wird direkt uebergeben (renderLaufend bleibt
    // gleich), damit sich kein neuer Aufruf vordraengeln kann.
    await new Promise<void>((resolve, reject) => {
      const weiter = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const i = renderWartend.indexOf(weiter)
        if (i >= 0) renderWartend.splice(i, 1)
        reject(ausgelastet())
      }, RENDER_WARTEZEIT_MS)
      renderWartend.push(weiter)
    })
  }
  try {
    return await fn()
  } finally {
    const naechster = renderWartend.shift()
    if (naechster) naechster()
    else renderLaufend--
  }
}

/**
 * Vorlage zu PDF rendern. Der Worker prueft die Befehle unmittelbar vor dem
 * Rendern noch einmal -- das deckt Vorlagen ab, die vor der Einfuehrung der
 * Pruefung hochgeladen wurden und in der DB liegen.
 */
export async function renderePdf(
  vorlage: Buffer,
  daten: Record<string, unknown>
): Promise<Buffer> {
  try {
    return Buffer.from(
      await mitRenderSlot<ArrayBufferLike>(() =>
        worker.schutzkonzeptPdf(new Uint8Array(vorlage), daten)
      )
    )
  } catch (err: any) {
    if (err instanceof PortalFehler) throw err
    const text = String(err?.message ?? err)
    if (text.includes(VORLAGE_UNZULAESSIG)) {
      throw badRequest(
        'TEMPLATE_INVALID',
        text.slice(
          text.indexOf(VORLAGE_UNZULAESSIG) + VORLAGE_UNZULAESSIG.length
        )
      )
    }
    console.error('[schutzkonzept] PDF-Erzeugung fehlgeschlagen:', err)
    throw new PortalFehler(
      'PDF_FAILED',
      'Das PDF konnte nicht erzeugt werden. Bitte später erneut versuchen.',
      502
    )
  }
}
