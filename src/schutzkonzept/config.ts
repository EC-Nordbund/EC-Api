import { queryP } from '../helpers/mysql'
import { PortalFehler } from '../portal/error'

/**
 * Konstanten und Startup-Guard des Schutzkonzept-Moduls.
 *
 * Das Ausfuell-System ist ein dritter, oeffentlich erreichbarer Auth-Kanal
 * (neben Verwaltung und Portal). Er meldet sich nicht mit Passwort an,
 * sondern mit einem Code per Mail an eine der Schutzkonzept-E-Mails eines
 * EC-Kreises.
 */

/** Basis-URL des Ausfuell-Systems (Links in Mails, Uebergabe aus dem Portal). */
export const schutzkonzeptBaseUrl = (): string =>
  process.env.SCHUTZKONZEPT_BASE_URL || 'https://schutzkonzept.ec-nordbund.de'

/**
 * Login-Code: sechs Ziffern, 15 Minuten gueltig.
 *
 * Abwaegung Aussperren gegen Raten (beides ohne Anmeldung ausloesbar):
 *  - Eine neue Anforderung entwertet aeltere Codes NICHT. Kreis-Adressen
 *    werden geteilt, Mails kommen verzoegert (Greylisting); sonst schloesse
 *    jede Anforderung -- auch eine fremde -- die anderen aus. Es gelten die
 *    neuesten CODE_MAX_OFFEN unbenutzten Codes.
 *  - Anforderungen je Adresse: CODE_MAX_PRO_STUNDE_JE_IP von einer IP,
 *    CODE_MAX_PRO_STUNDE insgesamt (gegen Mail-Bombing). Wer allein von
 *    einer IP anfordert, sperrt die Adresse also nicht mehr fuer andere.
 *  - Falsche Codes zaehlen je Adresse ueber alle Codes (skLoginFehlversuch),
 *    nicht je Code: sonst gaebe jeder neu angeforderte Code wieder frische
 *    Versuche. Je IP FEHLVERSUCHE_JE_IP, insgesamt FEHLVERSUCHE_GESAMT in
 *    FEHLVERSUCHE_FENSTER_STUNDEN. Rate-Chance damit hoechstens
 *    FEHLVERSUCHE_GESAMT x CODE_MAX_OFFEN / 10^6 je Adresse und Tag.
 *    Aussperren per Fehlversuch braucht mindestens
 *    FEHLVERSUCHE_GESAMT / FEHLVERSUCHE_JE_IP verschiedene IPs und landet
 *    als 'login.gesperrt' in skAudit.
 */
export const CODE_STELLEN = 6
export const CODE_GUELTIG_MINUTEN = 15
export const CODE_MAX_OFFEN = 5
export const CODE_MAX_PRO_STUNDE = 10
export const CODE_MAX_PRO_STUNDE_JE_IP = 4
export const FEHLVERSUCHE_GESAMT = 20
export const FEHLVERSUCHE_JE_IP = 8
export const FEHLVERSUCHE_FENSTER_STUNDEN = 24

/** Uebergabe-Token Portal -> Ausfuell-System. */
export const UEBERGABE_GUELTIG_MINUTEN = 5

/** JWT-Laufzeiten. Ueber das Portal geoeffnete Sitzungen sind kuerzer. */
export const TOKEN_LAUFZEIT_EMAIL = '12h'
export const TOKEN_LAUFZEIT_PORTAL = '2h'

/**
 * DOCX-Vorlagen: Obergrenze je Datei.
 *
 * Das Rahmen-Schutzkonzept wiegt mit eingebetteten Schriften schon gut 10 MB.
 * Achtung: der MySQL-Treiber schickt Binaerdaten hex-kodiert, ein Upload
 * braucht also max_allowed_packet > 2 x Dateigroesse (siehe
 * pruefePaketgroesse in formular.ts und schutzkonzept-schema.sql).
 */
export const MAX_VORLAGE_BYTES = 20 * 1024 * 1024
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/**
 * Vorlagen mit Makros (.docm). Kleingeschrieben, obwohl die IANA-Form
 * "macroEnabled" heisst: Browser liefern File.type immer klein, und type-is
 * (body-parser) schreibt nur den Typ der Anfrage klein, nicht die erwartete
 * Liste -- mit grossem E passte der Upload nie.
 */
export const DOCM_MIME = 'application/vnd.ms-word.document.macroenabled.12'

/**
 * PDF-Erzeugung: hoechstens so viele gleichzeitig, weitere warten (siehe
 * mitRenderSlot in formular.ts). Ein Render einer 10-MB-Vorlage belegt gut
 * 100 MB im API-Prozess.
 */
export const RENDER_MAX_PARALLEL = 2
export const RENDER_MAX_WARTEND = 20
export const RENDER_WARTEZEIT_MS = 60_000

/** Tabellen, ohne die das Modul nicht laeuft. */
const TABELLEN = [
  'skKreisEmail',
  'skFormularVersion',
  'skVorlage',
  'skKreisStand',
  'skKreisPdf',
  'skLoginCode',
  'skLoginFehlversuch',
  'skAudit',
  'skKreisZaehler', // Stand-Nummern je Kreis, monoton (stand.ts naechsteVersionNr)
  'skFormularZaehler', // Formularversions-Nummern, monoton (formular.ts)
  'skErinnerung' // Erinnerungs-Protokoll (erinnerung.ts)
]
/** So viele `sk%`-Trigger legt schutzkonzept-schema.sql an. */
const TRIGGER_ERWARTET = 10
/** Ein fehlendes Schema wird nach dieser Zeit erneut geprueft. */
const SCHEMA_NEUPRUEFUNG_MS = 30_000

/**
 * Nur der Erfolg wird dauerhaft gemerkt. "Fehlt" gilt 30 Sekunden -- danach
 * wird neu geprueft, damit ein nachtraeglich eingespieltes SQL ohne
 * API-Neustart wirkt. Andere DB-Fehler (Verbindung weg, Pool voll) werden gar
 * nicht gemerkt: sie sagen nichts ueber das Schema.
 */
let schemaOK = false
let schemaFehltSeit = 0
let schemaPruefung: Promise<boolean> | null = null

/**
 * Bewusst ueber SHOW-Befehle statt information_schema: auf dem Prod-Server hat
 * selbst root@'%' dort keinen Zugriff (ERROR 1044 beim Einspielen der
 * Selbstkontrolle). SHOW TABLES/COLUMNS/TRIGGERS braucht nur die Rechte an den
 * Tabellen selbst.
 */
async function pruefeSchemaJetzt(): Promise<boolean> {
  try {
    const tabellen = await queryP<Record<string, string>>(
      "SHOW TABLES LIKE 'sk%'"
    )
    const vorhanden = new Set(tabellen.map((r) => String(Object.values(r)[0])))
    const spalte = async (tabelle: string, name: string) =>
      vorhanden.has(tabelle) || tabelle === 'portalUser'
        ? (await queryP(`SHOW COLUMNS FROM \`${tabelle}\` LIKE ?`, [name]))
            .length === 1
        : false
    const spalten = [
      await spalte('portalUser', 'is_schutzkonzept_verwalter'),
      await spalte('skLoginCode', 'token_gen'),
      await spalte('skKreisStand', 'abschnitte_bestaetigt')
    ].filter(Boolean).length
    // Fehlen die Trigger (z. B. Import am fehlenden TRIGGER/SUPER-Recht
    // abgebrochen), liefe alles scheinbar -- nur ohne die von der DB
    // erzwungene Unveraenderlichkeit. Dann lieber gar nicht.
    const trigger = (await queryP<{ Trigger: string }>('SHOW TRIGGERS')).filter(
      (t) => String(t.Trigger).startsWith('sk')
    ).length
    const fehlt: string[] = []
    const fehlendeTabellen = TABELLEN.filter((t) => !vorhanden.has(t))
    if (fehlendeTabellen.length > 0) {
      fehlt.push(`Tabellen (${fehlendeTabellen.join(', ')})`)
    }
    if (spalten !== 3) fehlt.push('Spalten')
    if (trigger < TRIGGER_ERWARTET) {
      fehlt.push(`Trigger (${trigger} von ${TRIGGER_ERWARTET})`)
    }
    if (fehlt.length === 0) {
      schemaOK = true
      return true
    }
    schemaFehltSeit = Date.now()
    console.error(
      `[schutzkonzept] DB-Schema unvollständig (${fehlt.join(', ')}) -- sql/schutzkonzept-schema.sql einspielen`
    )
    return false
  } catch (err) {
    console.error('[schutzkonzept] Schema-Prüfung fehlgeschlagen:', err)
    return false
  }
}

async function pruefeSchema(): Promise<boolean> {
  if (schemaOK) return true
  if (Date.now() - schemaFehltSeit < SCHEMA_NEUPRUEFUNG_MS) return false
  // Parallele Requests teilen sich eine Pruefung.
  schemaPruefung ??= pruefeSchemaJetzt().finally(() => {
    schemaPruefung = null
  })
  return schemaPruefung
}

const deaktiviert = () =>
  new PortalFehler(
    'DISABLED',
    'Das Schutzkonzept-System ist derzeit nicht verfügbar.',
    503
  )

/**
 * Schema-Pruefung nur noch als Hinweis im Log, nie als Sperre.
 *
 * Die Sperre (503, solange Tabellen/Trigger fehlen) hat in Prod das ganze
 * Modul abgeschaltet, obwohl das Schema komplett eingespielt war: SHOW
 * TRIGGERS zeigt dem API-Benutzer ohne TRIGGER-Recht keine Trigger, und
 * information_schema war ihm ganz verwehrt. Ein fehlendes Schema faellt
 * ohnehin sofort auf (jede Route liefert dann 500 mit "Unknown table" im
 * Log); die Pruefung hier meldet es nur frueher und lesbarer.
 */
export async function requireSchutzkonzeptSchema(): Promise<void> {
  void pruefeSchema()
}

/**
 * Schema und eigenes Secret -- fuer die /schutzkonzept/*-Routen.
 *
 * Das Secret muss sich von beiden anderen unterscheiden: mit JWT_SECRET waere
 * ein Schutzkonzept-Login ein Verwaltungszugang, mit PORTAL_JWT_SECRET ein
 * Portal-Zugang (issuer/audience sind nur die zweite Sicherung).
 */
export async function requireSchutzkonzeptAktiv(): Promise<void> {
  await requireSchutzkonzeptSchema()
  const s = process.env.SCHUTZKONZEPT_JWT_SECRET
  if (!s) {
    console.error('[schutzkonzept] SCHUTZKONZEPT_JWT_SECRET ist nicht gesetzt')
    throw deaktiviert()
  }
  if (s === process.env.JWT_SECRET || s === process.env.PORTAL_JWT_SECRET) {
    console.error(
      '[schutzkonzept] SCHUTZKONZEPT_JWT_SECRET ist identisch mit JWT_SECRET oder PORTAL_JWT_SECRET'
    )
    throw deaktiviert()
  }
}

/**
 * Zeitstempel als ISO-UTC direkt aus SQL.
 *
 * Die DB laeuft in UTC, Node in Ortszeit: promise-mysql liest TIMESTAMP als
 * Ortszeit und laege im Sommer zwei Stunden daneben. Formatiert in SQL gibt
 * es diese Falle nicht.
 */
export const isoSql = (spalte: string): string =>
  `DATE_FORMAT(${spalte}, '%Y-%m-%dT%H:%i:%sZ')`
