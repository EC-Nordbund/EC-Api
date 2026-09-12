/**
 * Zentrale Konstanten und der Startup-Guard des Portal-Moduls.
 *
 * Das Portal ist ein zweiter, oeffentlich erreichbarer Auth-Kanal neben der
 * Verwaltung. Alles, was seine Reichweite begrenzt, steht bewusst hier an einer
 * Stelle statt verstreut im SQL.
 */

/**
 * Anmelde-Positionen (rollen.rollenID), die Zustaendigkeit fuer eine
 * Veranstaltung begruenden: 5 = Leitung, 6 = Hauptleitung.
 *
 * Der Rollenschluessel steht nirgends in der DB dokumentiert; er stammt aus
 * EC-Verwaltung (pages/_/veranstaltungen/_id/_/anmeldungen.route.vue). Vor
 * einem Prod-Rollout mit `SELECT * FROM rollen` verifizieren -- die gesamte
 * Freizeitleiter-Autorisierung haengt an diesen zwei Zahlen.
 */
export const LEITUNGS_POSITIONEN = [5, 6]

/**
 * Zeitfenster des Veranstaltungs-Scopes.
 *
 * Ohne Fenster haette jemand, der 2014 einmal Hauptleitung war, dauerhaft
 * Zugriff auf die Gesundheitsdaten dieser Freizeit. Der Nachlauf ist so
 * bemessen, dass ein nach der Freizeit nachgereichtes Fuehrungszeugnis noch
 * eingetragen werden kann.
 */
export const SCOPE_NACHLAUF_MONATE = 3
export const SCOPE_VORLAUF_MONATE = 18

/** Gueltigkeit der Einmal-Links (Stunden). */
export const TTL_INVITE_STUNDEN = 14 * 24
export const TTL_RESET_STUNDEN = 2

/** Laufzeit des Portal-JWT. Kein Refresh-Token: abgelaufen = neu anmelden. */
export const TOKEN_LAUFZEIT = '12h'

/** Konto-Sperre nach zu vielen Fehlversuchen. */
export const MAX_FEHLVERSUCHE = 10
export const SPERRE_MINUTEN = 15

/**
 * Mindestalter fuer einen FZ-Eintrag.
 *
 * Ein erweitertes Fuehrungszeugnis wird nach dem BZRG erst ab 14 ausgestellt.
 * Die Grenze verhindert, dass ueber die Kreis-Zustaendigkeit -- die alle
 * Personen eines EC-Kreises umfasst, also ueberwiegend Kinder -- versehentlich
 * fuer Minderjaehrige etwas eingetragen wird.
 */
export const FZ_MINDESTALTER = 14

/** Ein Fuehrungszeugnis gilt fuenf Jahre ab Ausstellungsdatum (fzVon). */
export const FZ_GUELTIG_JAHRE = 5

/**
 * Ab wann die Ampel von gruen auf gelb springt. Entspricht der Absicht von
 * cron.php ("laeuft in Kuerze ab"), siehe ampel() in ./ampel.ts.
 */
export const FZ_WARNUNG_MONATE = 6

/**
 * Frist, innerhalb derer ein Zeugnis nach Ausstellung vorgelegt werden soll.
 * Wird nicht erzwungen (der Bestand tut es auch nicht), aber gemeldet.
 */
export const FZ_VORLAGE_FRIST_MONATE = 3

/** Basis-URL des Portals fuer die Links in Einladungs- und Reset-Mails. */
export const portalBaseUrl = (): string =>
  process.env.PORTAL_BASE_URL || 'https://portal.ec-nordbund.de'

/**
 * Erlaubte Origins fuer /portal/* (Komma-getrennt). Leer = alle, wie im
 * restlichen CORS-Setup der API.
 */
export const portalOrigins = (): string[] =>
  (process.env.PORTAL_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

/**
 * Startup-Guard.
 *
 * Das Portal-JWT MUSS ein eigenes Secret haben: `checkAuth` der Verwaltung
 * prueft nur die Signatur und kennt keinerlei Rechte -- ein mit JWT_SECRET
 * signierter Portal-Token waere damit ein Vollzugriffs-Token auf alle
 * Personendaten. Ist das Secret gleich oder fehlt es, bleibt das Modul aus.
 *
 * Der zweite Fall (`schemaOK`) faengt "API deployt, SQL vergessen" ab; er wird
 * beim ersten Request einmalig gesetzt (siehe pruefeSchema()).
 */
let schemaOK: boolean | null = null

export function portalStatus(): { ok: boolean; grund: string } {
  const secret = process.env.PORTAL_JWT_SECRET
  if (!secret) {
    return { ok: false, grund: 'PORTAL_JWT_SECRET ist nicht gesetzt' }
  }
  if (secret === process.env.JWT_SECRET) {
    return {
      ok: false,
      grund:
        'PORTAL_JWT_SECRET ist identisch mit JWT_SECRET (Portal-Tokens waeren Verwaltungs-Tokens)'
    }
  }
  if (schemaOK === false) {
    return {
      ok: false,
      grund: 'DB-Schema fehlt: zz-portal-schema.sql wurde nicht eingespielt'
    }
  }
  return { ok: true, grund: '' }
}

export function setSchemaOK(ok: boolean): void {
  if (schemaOK !== ok) {
    schemaOK = ok
    if (!ok) {
      console.error(
        '[portal] DB-Schema unvollstaendig -- dumps/zz-portal-schema.sql einspielen'
      )
    }
  }
}

export function schemaGeprueft(): boolean {
  return schemaOK !== null
}
