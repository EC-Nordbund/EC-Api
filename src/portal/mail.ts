import { createTransport } from 'nodemailer'
import { queryP } from '../helpers/mysql'
import { portalBaseUrl } from './config'

/**
 * Mailversand des Portals.
 *
 * Warum nicht helpers/mail.ts: das protokolliert jede Mail im Volltext nach
 * `gesendeteEmails` (mail.ts:68). Der Einladungslink enthaelt den Klartext-
 * Token; er laege damit dauerhaft in der Datenbank, und wer diese Tabelle lesen
 * kann -- jeder Verwaltungszugang, jedes Backup -- koennte jeden Portal-Account
 * uebernehmen. Hier wird derselbe Weg genommen, der Link im protokollierten
 * Text aber durch einen Platzhalter ersetzt.
 */
const smtp = createTransport({
  host: process.env.SMTP_SERVER || '',
  port: parseInt(process.env.SMTP_PORT || '1'),
  auth: {
    user: process.env.SMTP_USERNAME || '',
    pass: process.env.SMTP_PASSWORD || ''
  }
})

const ABSENDER = 'fz@ec-nordbund.de'

async function sendePortalMail(
  to: string,
  subject: string,
  html: string,
  /** Der Teil, der im Protokoll unkenntlich gemacht wird. */
  geheim: string
): Promise<void> {
  await smtp.sendMail({
    from: ABSENDER,
    to,
    replyTo: ABSENDER,
    subject,
    html
  })

  const protokoll = {
    from: ABSENDER,
    to,
    subject,
    html: html.split(geheim).join('[LINK ENTFERNT]')
  }
  // queryP statt query: parametrisiert (der Bestand interpoliert den Mailtext
  // in den SQL-String) und ohne stdout-Logging, in dem sonst die Mailadresse
  // des Empfaengers landet.
  await queryP('INSERT INTO gesendeteEmails (content) VALUES (?)', [
    JSON.stringify(protokoll)
  ])
}

const FUSS = `<p>Entschieden für Christus grüßt<br><strong>dein EC-Nordbund</strong></p>
<hr>
<p style="color:#666;font-size:small">Diese Mail wurde automatisch verschickt.
Wenn du damit nichts anfangen kannst, ignoriere sie bitte einfach — ohne den
Link passiert nichts.</p>`

export async function sendeEinladung(
  to: string,
  vorname: string,
  token: string,
  tageGueltig: number
): Promise<void> {
  const link = `${portalBaseUrl()}/#/passwort/setzen?token=${token}`
  await sendePortalMail(
    to,
    'Dein Zugang zum EC-Portal',
    `<p>Hallo <strong>${esc(vorname)}</strong>,</p>
<p>für dich wurde ein Zugang zum <strong>EC-Portal</strong> angelegt. Dort siehst du
die aktuellen Listen für den Bereich, für den du zuständig bist, und kannst
eingesehene Führungszeugnisse selbst eintragen.</p>
<p>Bitte lege zuerst dein Passwort fest:</p>
<p><a href="${link}">${link}</a></p>
<p>Der Link ist ${tageGueltig} Tage gültig und funktioniert genau einmal.</p>
${FUSS}`,
    token
  )
}

export async function sendeReset(
  to: string,
  vorname: string,
  token: string,
  stundenGueltig: number
): Promise<void> {
  const link = `${portalBaseUrl()}/#/passwort/setzen?token=${token}`
  await sendePortalMail(
    to,
    'Neues Passwort für das EC-Portal',
    `<p>Hallo <strong>${esc(vorname)}</strong>,</p>
<p>für deinen Zugang zum EC-Portal wurde ein neues Passwort angefordert.
Über diesen Link kannst du es festlegen:</p>
<p><a href="${link}">${link}</a></p>
<p>Der Link ist ${stundenGueltig} Stunden gültig und funktioniert genau einmal.
Dein bisheriges Passwort bleibt gültig, bis du ein neues gesetzt hast.</p>
${FUSS}`,
    token
  )
}

/**
 * Meldung an die Geschaeftsstelle, wenn eine Person den EC-Kreis wechselt.
 *
 * Das Umhaengen passiert im Portal ohne Rueckfrage -- sonst braeuchte jeder
 * Umzug einen Anruf. Damit der abgebende Kreis seine Leute nicht kommentarlos
 * verliert, geht diese Meldung raus; sie ist die einzige Spur des Vorgangs
 * ausserhalb des Audit-Protokolls.
 */
export async function sendeKreiswechsel(daten: {
  vorname: string
  nachname: string
  gebDat: string
  vonKreis: string
  nachKreis: string
  durch: string
}): Promise<void> {
  const to = process.env.PORTAL_MELDUNG_MAIL || ABSENDER
  await smtp.sendMail({
    from: ABSENDER,
    to,
    replyTo: ABSENDER,
    subject: `[Portal] Kreiswechsel: ${daten.vorname} ${daten.nachname}`,
    html: `<p>Im Portal wurde eine Person einem anderen EC-Kreis zugeordnet.</p>
<table cellpadding="4">
  <tr><td><strong>Person</strong></td><td>${esc(daten.vorname)} ${esc(daten.nachname)}, geboren ${esc(daten.gebDat)}</td></tr>
  <tr><td><strong>Bisher</strong></td><td>${esc(daten.vonKreis)}</td></tr>
  <tr><td><strong>Jetzt</strong></td><td>${esc(daten.nachKreis)}</td></tr>
  <tr><td><strong>Eingetragen von</strong></td><td>${esc(daten.durch)}</td></tr>
</table>
<p>Das passiert, wenn jemand über „+ Neu" eine Person anlegt, die es im
Bestand schon gibt. Wenn das nicht stimmt, lässt sich die Zuordnung in der
Verwaltung zurücksetzen.</p>
${FUSS}`
  })

  await queryP('INSERT INTO gesendeteEmails (content) VALUES (?)', [
    JSON.stringify({ from: ABSENDER, to, subject: 'Kreiswechsel', daten })
  ])
}

/** Namen kommen aus der DB und landen in HTML -- also escapen. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
