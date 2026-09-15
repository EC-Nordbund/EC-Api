import { PoolConnection } from 'promise-mysql'
import { ecError } from '../helpers/error'
import sendMail from '../helpers/mail'
import { withConnection } from '../helpers/mysql'
import { protokolliere, zustand, type Zustand } from './protokoll'
import { ABMELDE_VERTEILER } from './verteiler'

/**
 * Die beiden eingreifenden Aktionen auf einer abgemeldeten Anmeldung:
 * Ruecknahme der Abmeldung und vollstaendige Loeschung.
 *
 * Beide laufen in einer Transaktion zusammen mit ihrem Protokolleintrag. Das
 * ist der Kern der Sache: die Loeschung beseitigt den einzigen Datensatz, der
 * den Vorgang belegt: bliebe das Protokoll dabei aussen vor, waere hinterher
 * nicht mehr feststellbar, dass es die Anmeldung ueberhaupt gab.
 *
 * Die Mail geht bewusst NACH dem Commit raus: ein Mailserver, der gerade
 * klemmt, darf keinen abgeschlossenen Vorgang zurueckrollen.
 */

export type Ziel = 'angemeldet' | 'warteliste'

type Zeile = {
  anmeldeID: string
  personID: number
  veranstaltungsID: number
  position: number
  wartelistenPlatz: number
  /** Epoch-Sekunden (UNIX_TIMESTAMP), null wenn nicht abgemeldet. */
  abmeldeZeitpunkt: number | null
  abmeldeGebuehr: number
  wegDerAbmeldung: string
  kommentarAbmeldung: string
  bisherBezahlt: number
  rueckbezahlt: number
  geschlecht: string
  vorname: string
  nachname: string
  bezeichnung: string
  hatGWarteliste: number
}

/**
 * Laedt die Anmeldung samt der Felder, die fuer die Einordnung gebraucht
 * werden (Geschlecht fuer die getrennte Warteliste, Bezeichnung fuer die Mail).
 * `FOR UPDATE` sperrt die Zeile: zwei gleichzeitige Ruecknahmen wuerden sonst
 * denselben Wartelistenplatz vergeben.
 */
async function ladeZeile(
  conn: PoolConnection,
  anmeldeID: string
): Promise<Zeile> {
  const zeilen: Zeile[] = await conn.query(
    `SELECT a.anmeldeID, a.personID, a.veranstaltungsID, a.position,
            a.wartelistenPlatz,
            UNIX_TIMESTAMP(a.abmeldeZeitpunkt) AS abmeldeZeitpunkt, a.abmeldeGebuehr,
            a.wegDerAbmeldung, a.kommentarAbmeldung, a.bisherBezahlt,
            a.rueckbezahlt,
            p.geschlecht, p.vorname, p.nachname,
            v.bezeichnung, v.hatGWarteliste
       FROM anmeldungen a
       JOIN personen p       ON p.personID = a.personID
       JOIN veranstaltungen v ON v.veranstaltungsID = a.veranstaltungsID
      WHERE a.anmeldeID = ?
      FOR UPDATE`,
    [anmeldeID]
  )

  if (zeilen.length === 0) {
    throw new ecError(`Es gibt keine Anmeldung mit der ID ${anmeldeID}.`, 404)
  }
  return zeilen[0]
}

/** Abgemeldet ist, wer einen negativen Wartelistenplatz hat (siehe `abmelden`). */
function pruefeAbgemeldet(z: Zeile, was: string): void {
  if (z.wartelistenPlatz >= 0) {
    throw new ecError(
      `Diese Anmeldung ist nicht abgemeldet – ${was} ist nur für abgemeldete Anmeldungen vorgesehen.`,
      400
    )
  }
}

/**
 * Naechster freier Wartelistenplatz.
 *
 * Gleiche Rechnung wie in der Mutation `anmelden`: bei getrennter Warteliste
 * zaehlt nur das eigene Geschlecht. Nur `position = 1` (Teilnehmer) hat
 * ueberhaupt Wartelistenplaetze.
 */
async function naechsterWartelistenPlatz(
  conn: PoolConnection,
  z: Zeile
): Promise<number> {
  const sql = z.hatGWarteliste
    ? `SELECT MAX(a.wartelistenPlatz) AS maxPos
         FROM anmeldungen a JOIN personen p ON p.personID = a.personID
        WHERE a.veranstaltungsID = ? AND a.position = 1 AND p.geschlecht = ?`
    : `SELECT MAX(a.wartelistenPlatz) AS maxPos
         FROM anmeldungen a
        WHERE a.veranstaltungsID = ? AND a.position = 1`
  const params = z.hatGWarteliste
    ? [z.veranstaltungsID, z.geschlecht]
    : [z.veranstaltungsID]

  const r: Array<{ maxPos: number | null }> = await conn.query(sql, params)
  const max = Number(r[0]?.maxPos ?? 0)
  return max > 0 ? max + 1 : 1
}

export type RuecknahmeErgebnis = {
  anmeldeID: string
  wartelistenPlatz: number
  vorher: Zustand
  nachher: Zustand
}

/**
 * Nimmt eine Abmeldung zurueck.
 *
 * Der urspruengliche Wartelistenplatz ist nicht rekonstruierbar -- `abmelden`
 * ueberschreibt ihn seit jeher mit -1. Deshalb entscheidet die Sachbearbeitung
 * im Dialog, ob die Person angemeldet ist oder ans Ende der Warteliste kommt;
 * geraten wird hier nichts.
 *
 * Geloescht werden die Abmeldefelder inklusive `abmeldeGebuehr` -- die Gebuehr
 * faellt mit der Abmeldung weg, auf die sie sich bezieht. `bisherBezahlt` und
 * `rueckbezahlt` bleiben unangetastet: das sind Zahlungsvorgaenge, die
 * tatsaechlich stattgefunden haben. Alle alten Werte stehen im Protokoll.
 */
export async function ruecknahme(
  anmeldeID: string,
  ziel: Ziel,
  begruendung: string,
  userID: number,
  ip: string
): Promise<RuecknahmeErgebnis> {
  const ergebnis = await withConnection(async (conn) => {
    const z = await ladeZeile(conn, anmeldeID)
    pruefeAbgemeldet(z, 'die Rücknahme')

    if (ziel === 'warteliste' && z.position !== 1) {
      throw new ecError(
        'Nur Teilnehmer stehen auf der Warteliste – Mitarbeitende können nur direkt angemeldet werden.',
        400
      )
    }

    // Schutz vor einem Zustand, den die Anmeldung selbst nie erzeugt, der aber
    // durch Handeingriffe entstehen kann: zwei gueltige Anmeldungen derselben
    // Person zur selben Freizeit. Die Ruecknahme wuerde ihn herstellen.
    const konflikt: Array<{ anmeldeID: string }> = await conn.query(
      `SELECT anmeldeID FROM anmeldungen
        WHERE personID = ? AND veranstaltungsID = ? AND anmeldeID <> ?
          AND wartelistenPlatz >= 0`,
      [z.personID, z.veranstaltungsID, anmeldeID]
    )
    if (konflikt.length > 0) {
      throw new ecError(
        `Für diese Person gibt es zu dieser Freizeit bereits die gültige Anmeldung ${konflikt[0].anmeldeID}. ` +
          'Die Abmeldung kann deshalb nicht zurückgenommen werden.',
        409
      )
    }

    const platz =
      ziel === 'warteliste' ? await naechsterWartelistenPlatz(conn, z) : 0

    const vorher = zustand(z)

    await conn.query(
      `UPDATE anmeldungen
          SET wartelistenPlatz = ?, abmeldeZeitpunkt = NULL, abmeldeGebuehr = 0,
              wegDerAbmeldung = '', kommentarAbmeldung = ''
        WHERE anmeldeID = ?`,
      [platz, anmeldeID]
    )

    const nachher: Zustand = {
      ...vorher,
      wartelistenPlatz: platz,
      abmeldeZeitpunkt: null,
      abmeldeGebuehr: 0,
      wegDerAbmeldung: '',
      kommentarAbmeldung: ''
    }

    await protokolliere(conn, {
      anmeldeID,
      personID: z.personID,
      veranstaltungsID: z.veranstaltungsID,
      userID,
      aktion: 'ruecknahme',
      begruendung,
      vorher,
      nachher,
      ip
    })

    return { z, vorher, nachher, platz }
  })

  const { z, platz } = ergebnis
  await benachrichtige(
    'Abmeldung zurückgenommen',
    `<h1>Abmeldung zurückgenommen</h1>
     <p>Die Abmeldung von <b>${escapeHtml(z.vorname)} ${escapeHtml(
       z.nachname
     )}</b> zu <b>${escapeHtml(z.bezeichnung)}</b> wurde zurückgenommen.<br>
     Neuer Status: ${platz === 0 ? 'angemeldet' : `Warteliste, Platz ${platz}`}.<br>
     AnmeldeID: ${escapeHtml(anmeldeID)}<br>
     Begründung: ${escapeHtml(begruendung)}</p>
     <p><a href="https://verwaltung.ec-nordbund.de/#/anmeldungen/${encodeURIComponent(
       anmeldeID
     )}/home">Anmeldung ansehen</a></p>`
  )

  return {
    anmeldeID,
    wartelistenPlatz: platz,
    vorher: ergebnis.vorher,
    nachher: ergebnis.nachher
  }
}

export type LoeschErgebnis = {
  anmeldeID: string
  personID: number
  veranstaltungsID: number
  vorher: Zustand
}

/**
 * Loescht eine abgemeldete Anmeldung endgueltig.
 *
 * Gedacht fuer den Fall, dass dieselbe Person zur selben Freizeit erneut
 * anfaengt -- z. B. als Mitarbeiterin statt als Teilnehmerin. Die Mutation
 * `anmelden` lehnt das sonst mit Status -2 ab, weil sie jede vorhandene
 * Anmeldung zaehlt, auch eine abgemeldete.
 *
 * Auf `anmeldungen` zeigt kein Fremdschluessel, die Zeile haengt also an
 * nichts; mitgeloescht werden ausserdem die Gesundheits-, Allergie- und
 * Bemerkungstexte -- aus DSGVO-Sicht ist das erwuenscht und der Grund, warum
 * das Protokoll sie nicht aufbewahrt.
 */
export async function loeschen(
  anmeldeID: string,
  begruendung: string,
  trotzOffenerZahlung: boolean,
  userID: number,
  ip: string
): Promise<LoeschErgebnis> {
  const ergebnis = await withConnection(async (conn) => {
    const z = await ladeZeile(conn, anmeldeID)
    pruefeAbgemeldet(z, 'das Löschen')

    // Gezahltes Geld, das weder zurueck- noch als Gebuehr verbucht ist, ist ein
    // offener Vorgang. Mit der Zeile verschwindet auch der Beleg dafuer, also
    // nicht stillschweigend loeschen -- aber auch nicht verbieten: manchmal ist
    // genau das gewollt (etwa wenn der Betrag zur neuen Anmeldung umgebucht wird).
    const offen = z.bisherBezahlt - z.rueckbezahlt - z.abmeldeGebuehr
    if (offen > 0 && !trotzOffenerZahlung) {
      throw new ecError(
        `Auf dieser Anmeldung stehen noch ${formatEuro(offen)} offen ` +
          `(gezahlt ${formatEuro(z.bisherBezahlt)}, zurückbezahlt ${formatEuro(
            z.rueckbezahlt
          )}, Abmeldegebühr ${formatEuro(z.abmeldeGebuehr)}). ` +
          'Klär die Zahlung oder bestätige das Löschen ausdrücklich.',
        409
      )
    }

    const vorher = zustand(z)

    // Protokoll VOR dem DELETE: beides in derselben Transaktion, aber so steht
    // der Eintrag auch dann, wenn das DELETE scheitert und alles zurueckrollt --
    // dann gibt es weder Loeschung noch Eintrag, nie das eine ohne das andere.
    await protokolliere(conn, {
      anmeldeID,
      personID: z.personID,
      veranstaltungsID: z.veranstaltungsID,
      userID,
      aktion: 'loeschen',
      begruendung:
        offen > 0
          ? `${begruendung} [offener Betrag: ${formatEuro(offen)}]`
          : begruendung,
      vorher,
      nachher: {},
      ip
    })

    await conn.query('DELETE FROM anmeldungen WHERE anmeldeID = ?', [anmeldeID])

    return { z, vorher }
  })

  const { z } = ergebnis
  await benachrichtige(
    'Anmeldung gelöscht',
    `<h1>Anmeldung gelöscht</h1>
     <p>Die abgemeldete Anmeldung von <b>${escapeHtml(z.vorname)} ${escapeHtml(
       z.nachname
     )}</b> zu <b>${escapeHtml(z.bezeichnung)}</b> wurde vollständig gelöscht.<br>
     AnmeldeID: ${escapeHtml(anmeldeID)}<br>
     Begründung: ${escapeHtml(begruendung)}</p>
     <p>Der Vorgang steht im Protokoll der Freizeit
     (<a href="https://verwaltung.ec-nordbund.de/#/veranstaltungen/${
       z.veranstaltungsID
     }/protokoll">Protokoll ansehen</a>).</p>`
  )

  return {
    anmeldeID,
    personID: z.personID,
    veranstaltungsID: z.veranstaltungsID,
    vorher: ergebnis.vorher
  }
}

/**
 * Benachrichtigung an den Verteiler. Faengt eigene Fehler ab: der fachliche
 * Vorgang ist zu diesem Zeitpunkt committet, eine klemmende Mail darf ihn nicht
 * nachtraeglich als Fehler erscheinen lassen.
 */
async function benachrichtige(betreff: string, html: string): Promise<void> {
  try {
    await sendMail(
      'automated@ec-nordbund.de',
      { to: ABMELDE_VERTEILER },
      betreff,
      html
    )
  } catch (err) {
    console.error('[anmeldung] Benachrichtigung fehlgeschlagen:', betreff, err)
  }
}

function formatEuro(betrag: number): string {
  return `${betrag.toFixed(2).replace('.', ',')} €`
}

/**
 * Namen und Begruendung kommen aus Freitextfeldern und landen in einer
 * HTML-Mail -- ohne Maskierung reisst ein "&" oder ein spitzes Klammerpaar die
 * Darstellung auseinander.
 */
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
