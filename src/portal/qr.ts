import QRCode from 'qrcode'
import worker from 'comlink:../workers/generation'
import { queryP } from '../helpers/mysql'
import { createToken } from '../nuxt/jwt'
import { notFound } from './error'
import { QR_GUELTIG_JAHRE, WEBSITE_ANMELDUNG } from './config'

/**
 * QR-Blatt zur Mitarbeitererfassung eines EC-Kreises.
 *
 * Jeder Kreis haengt so ein Blatt aus; wer dort mitarbeitet, scannt den Code
 * und traegt sich auf der Website ein. Das Blatt wurde bisher in der
 * Geschaeftsstelle erzeugt -- Token von Hand signieren, Vorlage von Hand
 * fuellen. Hier erzeugt es die FZ-Verantwortliche des Kreises selbst.
 *
 * Am bestehenden Verfahren aendert sich dabei nichts: gleiches Token-Format,
 * gleiches Secret, gleiche Zielseite. Ausgegebene Codes bleiben unveraendert
 * gueltig, es kommen nur neue Dokumente hinzu.
 */

/** Vorlage relativ zum Arbeitsverzeichnis -- wie in portal/templates.ts. */
const VORLAGE = './templates/qr-mitarbeitererfassung.docx'

export interface QrBlatt {
  kreis: string
  jahr: number
  url: string
  dateiname: string
  daten: Record<string, unknown>
}

/**
 * Gueltig bis zum Ende des fuenften Kalenderjahres.
 *
 * Bewusst nicht "fuenf Jahre ab heute": ein im September gedrucktes Blatt
 * wuerde dann mitten im Jahr ungueltig, und das waere dem Aushang nicht
 * anzusehen. So passt die Jahreszahl in der Ueberschrift exakt zum Ablauf.
 *
 * Das Jahr wird direkt gerechnet und nicht aus dem Datum zurueckgelesen:
 * `new Date(...)` ist Ortszeit, `getUTCFullYear()` waere am 31.12. abends
 * bereits das Folgejahr.
 */
export function gueltigBisEndeJahr(jetzt = new Date()): {
  jahr: number
  ablauf: Date
} {
  const jahr = jetzt.getFullYear() + QR_GUELTIG_JAHRE
  return { jahr, ablauf: new Date(jahr, 11, 31, 23, 59, 59) }
}

/**
 * Token, QR-Bild und Vorlagendaten fuer einen Kreis.
 *
 * Der Kreisname kommt aus der Datenbank und wird nicht uebergeben: die
 * Anmeldung sucht den Kreis ueber `lower(ecKreis.bezeichnung)` (Mutation
 * `anmelden` in graphql.ts). Ein von Hand getippter Name, der auch nur in
 * einem Zeichen abweicht, erzeugt ein Blatt, dessen Anmeldungen ins Leere
 * laufen -- und das faellt erst auf, wenn sich jemand beschwert.
 */
export async function erzeugeQrBlatt(ecKreisID: number): Promise<QrBlatt> {
  const rows = await queryP<{ bezeichnung: string }>(
    'SELECT bezeichnung FROM ecKreis WHERE ecKreisID = ?',
    [ecKreisID]
  )
  if (rows.length !== 1) throw notFound('EC-Kreis nicht gefunden.')
  const bezeichnung = rows[0].bezeichnung

  const { jahr, ablauf } = gueltigBisEndeJahr()
  const sekunden = Math.floor((ablauf.getTime() - Date.now()) / 1000)

  // Payload wie im Bestand: nur `d` mit dem kleingeschriebenen Kreisnamen.
  // Kein '|' darin -- daran unterscheidet die Website einen Orts-Code von
  // einem Veranstaltungs-Code (nuxt/index.ts, checkToken).
  const token = await createToken({ d: bezeichnung.toLowerCase() }, sekunden)
  const url = `${WEBSITE_ANMELDUNG}/${token}`

  const png = await QRCode.toBuffer(url, {
    // 'M' vertraegt bis zu 15 % Verdeckung -- genug fuer ein Blatt an einer
    // Pinnwand, ohne den Code unnoetig dicht zu machen. Der Token ist lang,
    // eine hoehere Stufe wuerde die Module sichtbar verkleinern.
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 1200
  })

  return {
    kreis: bezeichnung,
    jahr,
    url,
    dateiname: `QR-Mitarbeitererfassung ${bezeichnung} bis ${jahr}.pdf`,
    daten: {
      jahr: String(jahr),
      kreis: bezeichnung,
      // Der Platzhalter heisst nicht `link`: LINK ist ein reservierter Befehl
      // von docx-templates und wuerde den Wert als Kommando lesen.
      anmeldeUrl: url,
      // Das Bild reist als base64-String im Datenobjekt und nicht als
      // Buffer: die Daten laufen durch den Dokument-Worker in einem eigenen
      // Thread, ein String uebersteht die Uebergabe unveraendert.
      qr: {
        width: 9.9,
        height: 9.9,
        data: png.toString('base64'),
        extension: '.png'
      }
    }
  }
}

/** Fertiges PDF zum Ausdrucken und Aushaengen. */
export async function erzeugeQrPdf(
  ecKreisID: number
): Promise<{ pdf: Buffer; dateiname: string; jahr: number }> {
  const blatt = await erzeugeQrBlatt(ecKreisID)
  const datei = await worker.generateDocumentPDF(VORLAGE, blatt.daten)

  return {
    pdf: Buffer.from(datei),
    dateiname: blatt.dateiname,
    jahr: blatt.jahr
  }
}
