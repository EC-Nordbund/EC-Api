import { Request } from 'express'
import { queryP } from '../helpers/mysql'
import {
  PORTAL_POSITIONEN,
  SCOPE_NACHLAUF_MONATE,
  SCOPE_VORLAUF_MONATE,
  portalStatus,
  schemaGeprueft,
  setSchemaOK,
  umfangFuerPosition,
  type Umfang
} from './config'
import { PortalFehler, forbidden, unauthorized } from './error'
import { checkPortalToken, tokenAusHeader } from './token'

/**
 * Wer darf was sehen.
 *
 * Zwei Quellen von Zustaendigkeit:
 *  - Ortsverantwortliche: ecKreis.fz_verantwortlicher_personID zeigt auf die
 *    Person. Wird in EC-Verwaltung gepflegt.
 *  - Freizeitleitung: ergibt sich ohne jede Pflege aus anmeldungen.position
 *    (5 = Leitung, 6 = Hauptleitung) der jeweiligen Veranstaltung.
 *
 * Der Scope wird bei JEDEM Request frisch aus der DB gelesen und bewusst nicht
 * in den Token gebacken: Anmeldungen aendern sich taeglich, und ein zwoelf
 * Stunden alter Token darf weder entzogene Rechte weitertragen noch neue zu
 * spaet gewaehren. Kosten sind zwei kleine, indizierte Abfragen.
 */
export interface ScopeKreis {
  ecKreisID: number
  bezeichnung: string
  needsFZ: boolean
}

export interface ScopeVeranstaltung {
  veranstaltungsID: number
  bezeichnung: string
  kurzBezeichnung: string
  begin: Date
  ende: Date | null
  position: number
  /**
   * 'voll' fuer Leitung und Hauptleitung, 'kueche' fuer die Kuechenleitung.
   * Steuert, ob der Fuehrungszeugnis-Teil und die uebrigen Listen ueberhaupt
   * erreichbar sind.
   */
  umfang: Umfang
}

export interface PortalScope {
  portalUserID: number
  personID: number
  vorname: string
  nachname: string
  email: string
  superuser: boolean
  kreise: ScopeKreis[]
  veranstaltungen: ScopeVeranstaltung[]
}

/**
 * Einmalige Schema-Pruefung beim ersten Portal-Request.
 *
 * Faengt den Fall "API deployt, zz-portal-schema.sql vergessen" ab: statt
 * kryptischer SQL-Fehler in jeder Route gibt es dann ein klares 503.
 */
async function pruefeSchema(): Promise<void> {
  if (schemaGeprueft()) return
  try {
    await queryP('SELECT 1 FROM portalUser LIMIT 1')
    await queryP('SELECT fz_verantwortlicher_personID FROM ecKreis LIMIT 1')
    setSchemaOK(true)
  } catch {
    setSchemaOK(false)
  }
}

/** Wirft 503, solange Secret oder Schema fehlen. */
export async function requirePortalAktiv(): Promise<void> {
  await pruefeSchema()
  const status = portalStatus()
  if (!status.ok) {
    console.error('[portal] deaktiviert:', status.grund)
    throw new PortalFehler(
      'DISABLED',
      'Das Portal ist derzeit nicht verfügbar.',
      503
    )
  }
}

interface UserRow {
  portalUserID: number
  personID: number
  is_superuser: number
  email: string
  token_gen: number
  vorname: string
  nachname: string
}

/**
 * Token pruefen, Konto laden, Scope aufloesen.
 *
 * Aufrufkonvention wie checkAuth(req) im Rest der API -- eine Zeile am Anfang
 * jeder Route.
 */
export async function requirePortal(req: Request): Promise<PortalScope> {
  await requirePortalAktiv()

  const token = tokenAusHeader(req.headers.authorization)

  let payload
  try {
    payload = await checkPortalToken(token)
  } catch {
    throw unauthorized('Anmeldung abgelaufen oder ungültig.')
  }

  const rows = await queryP<UserRow>(
    `SELECT pu.portalUserID, pu.personID, pu.is_superuser, pu.email,
            pu.token_gen, p.vorname, p.nachname
       FROM portalUser pu
       JOIN personen p ON p.personID = pu.personID
      WHERE pu.portalUserID = ? AND pu.aktiv = 1 AND p.anonymisiert = 0`,
    [payload.pu]
  )
  if (rows.length !== 1) {
    throw unauthorized('Zugang nicht mehr gültig.')
  }
  const u = rows[0]

  // Ein Passwortwechsel beendet alle laufenden Sitzungen. Ohne das bliebe ein
  // gestohlener Token nach dem Zuruecksetzen bis zu zwoelf Stunden nutzbar --
  // also genau in dem Moment wertlos, in dem man ihn entwerten will.
  // Exakter Zaehlervergleich statt Zeitstempel, siehe PortalPayload.g.
  if ((payload.g ?? -1) !== u.token_gen) {
    throw unauthorized('Bitte melde dich erneut an.')
  }

  const superuser = u.is_superuser === 1

  return {
    portalUserID: u.portalUserID,
    personID: u.personID,
    vorname: u.vorname,
    nachname: u.nachname,
    email: u.email,
    superuser,
    kreise: await ladeKreise(u.personID, superuser),
    veranstaltungen: await ladeVeranstaltungen(u.personID, superuser)
  }
}

async function ladeKreise(
  personID: number,
  superuser: boolean
): Promise<ScopeKreis[]> {
  const rows = await queryP<{
    ecKreisID: number
    bezeichnung: string
    needsFZ: number
  }>(
    superuser
      ? 'SELECT ecKreisID, bezeichnung, needsFZ FROM ecKreis ORDER BY bezeichnung'
      : `SELECT ecKreisID, bezeichnung, needsFZ FROM ecKreis
          WHERE fz_verantwortlicher_personID = ? ORDER BY bezeichnung`,
    superuser ? [] : [personID]
  )
  return rows.map((r) => ({ ...r, needsFZ: r.needsFZ === 1 }))
}

/**
 * Veranstaltungen im Zeitfenster.
 *
 * Das Fenster ist keine Kosmetik: ohne es haette jemand, der 2014 einmal
 * Hauptleitung war, bis heute Zugriff auf die Gesundheitsdaten der damaligen
 * Teilnehmenden. Der Nachlauf reicht aus, um ein nach der Freizeit
 * nachgereichtes Fuehrungszeugnis noch einzutragen.
 */
async function ladeVeranstaltungen(
  personID: number,
  superuser: boolean
): Promise<ScopeVeranstaltung[]> {
  const fenster = `COALESCE(v.ende, v.\`begin\`) >= CURDATE() - INTERVAL ? MONTH
                   AND v.\`begin\` <= CURDATE() + INTERVAL ? MONTH`

  if (superuser) {
    const rows = await queryP<Omit<ScopeVeranstaltung, 'umfang'>>(
      `SELECT v.veranstaltungsID, v.bezeichnung, v.kurzBezeichnung,
              v.\`begin\` AS \`begin\`, v.ende, 6 AS position
         FROM veranstaltungen v
        WHERE ${fenster}
        ORDER BY v.\`begin\``,
      [SCOPE_NACHLAUF_MONATE, SCOPE_VORLAUF_MONATE]
    )
    return rows.map((v) => ({ ...v, umfang: 'voll' as const }))
  }

  const rows = await queryP<Omit<ScopeVeranstaltung, 'umfang'>>(
    `SELECT v.veranstaltungsID, v.bezeichnung, v.kurzBezeichnung,
            v.\`begin\` AS \`begin\`, v.ende, a.position
       FROM anmeldungen a
       JOIN veranstaltungen v ON v.veranstaltungsID = a.veranstaltungsID
      WHERE a.personID = ?
        AND a.position IN (${PORTAL_POSITIONEN.map(() => '?').join(',')})
        AND a.abmeldeZeitpunkt IS NULL
        AND ${fenster}
      ORDER BY v.\`begin\``,
    [
      personID,
      ...PORTAL_POSITIONEN,
      SCOPE_NACHLAUF_MONATE,
      SCOPE_VORLAUF_MONATE
    ]
  )

  // Wer bei derselben Freizeit mehrfach gefuehrt ist, bekommt den weitesten
  // Umfang -- sonst entschiede die Sortierung darueber, was jemand darf.
  const je = new Map<number, ScopeVeranstaltung>()
  for (const v of rows) {
    const neu = { ...v, umfang: umfangFuerPosition(v.position) }
    const alt = je.get(v.veranstaltungsID)
    if (!alt || (alt.umfang !== 'voll' && neu.umfang === 'voll')) {
      je.set(v.veranstaltungsID, neu)
    }
  }
  return [...je.values()]
}

export function assertKreis(scope: PortalScope, ecKreisID: number): void {
  if (scope.superuser) return
  if (!scope.kreise.some((k) => k.ecKreisID === ecKreisID)) {
    throw forbidden('Für diesen EC-Kreis bist du nicht zuständig.')
  }
}

/**
 * Zugriff auf eine Veranstaltung.
 *
 * `bedarf` sagt, wofuer: 'kueche' genuegt fuer die Kuechenliste, 'voll'
 * verlangt Leitung oder Hauptleitung. Eine Kuechenleitung kommt damit an ihre
 * Liste, aber nicht an den Fuehrungszeugnis-Stand des Teams.
 */
export function assertVeranstaltung(
  scope: PortalScope,
  veranstaltungsID: number,
  bedarf: Umfang = 'voll'
): void {
  if (scope.superuser) return

  const v = scope.veranstaltungen.find(
    (x) => x.veranstaltungsID === veranstaltungsID
  )
  if (!v) {
    throw forbidden('Für diese Veranstaltung bist du nicht zuständig.')
  }
  if (bedarf === 'voll' && v.umfang !== 'voll') {
    throw forbidden(
      'Als Küchenleitung siehst du nur die Küchenliste dieser Freizeit.'
    )
  }
}

/** Umfang fuer eine Veranstaltung im Scope (Superuser: immer voll). */
export function umfangFuer(
  scope: PortalScope,
  veranstaltungsID: number
): Umfang {
  if (scope.superuser) return 'voll'
  return (
    scope.veranstaltungen.find((v) => v.veranstaltungsID === veranstaltungsID)
      ?.umfang ?? 'kueche'
  )
}

/**
 * Darf fuer diese Person ein Fuehrungszeugnis eingetragen werden?
 *
 * Drei Bedingungen, jede aus einem eigenen Grund:
 *
 *  - `position > 1` bei der Veranstaltungs-Variante. Teilnehmende sind Kinder
 *    und Jugendliche; fuer die gibt es kein Fuehrungszeugnis und niemand hat
 *    etwas in ihren Daten zu suchen. Das ist die wichtigste Zeile dieser Datei.
 *  - `personID !== scope.personID`. Niemand traegt sein eigenes Zeugnis ein.
 *    Die Verwaltung erzwingt dasselbe implizit, indem sie die betroffene Person
 *    aus der "gesehen von"-Auswahl filtert (addFZ.form.ts).
 *  - `anonymisiert = 0`. Sonst schreibt das Portal frische personenbezogene
 *    Daten an eine bereits geloeschte Person.
 */
export async function assertPerson(
  scope: PortalScope,
  personID: number
): Promise<void> {
  if (personID === scope.personID) {
    throw forbidden(
      'Das eigene Führungszeugnis kann nicht selbst eingetragen werden.'
    )
  }

  const kreisIDs = scope.kreise.map((k) => k.ecKreisID)
  // Nur Freizeiten mit vollem Umfang: eine Kuechenleitung traegt keine
  // Fuehrungszeugnisse ein, auch nicht fuer ihr eigenes Kuechenteam.
  const vIDs = scope.veranstaltungen
    .filter((v) => v.umfang === 'voll')
    .map((v) => v.veranstaltungsID)

  if (scope.superuser) {
    const da = await queryP(
      'SELECT 1 FROM personen WHERE personID = ? AND anonymisiert = 0 LIMIT 1',
      [personID]
    )
    if (da.length === 0) throw forbidden('Person nicht gefunden.')
    return
  }

  // Leerer Scope: `IN ()` waere ein SQL-Syntaxfehler, also den Teilausdruck
  // ganz weglassen statt mit Platzhalterwerten zu arbeiten.
  const bedingungen: string[] = []
  const params: unknown[] = [personID]

  if (kreisIDs.length > 0) {
    bedingungen.push(`p.ecKreis IN (${kreisIDs.map(() => '?').join(',')})`)
    params.push(...kreisIDs)
  }
  if (vIDs.length > 0) {
    bedingungen.push(
      `EXISTS (SELECT 1 FROM anmeldungen a
                WHERE a.personID = p.personID
                  AND a.veranstaltungsID IN (${vIDs.map(() => '?').join(',')})
                  AND a.position > 1
                  AND a.abmeldeZeitpunkt IS NULL)`
    )
    params.push(...vIDs)
  }
  if (bedingungen.length === 0) {
    throw forbidden('Du bist derzeit für niemanden zuständig.')
  }

  const rows = await queryP(
    `SELECT 1 FROM personen p
      WHERE p.personID = ? AND p.anonymisiert = 0
        AND (${bedingungen.join(' OR ')})
      LIMIT 1`,
    params
  )
  if (rows.length === 0) {
    throw forbidden('Für diese Person bist du nicht zuständig.')
  }
}
