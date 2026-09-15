import { queryP } from '../helpers/mysql'
import { portalBaseUrl } from '../portal/config'
import { FUSS, esc, sendePortalMail } from '../portal/mail'
import type { AntragDetail, Position } from './antrag'

/**
 * Benachrichtigungen der Materialverwaltung.
 *
 * Jedes Ereignis am Antrag loest eine Mail aus -- an die Materialwarte, wenn
 * der Antragsteller etwas tut, an den Antragsteller, wenn ein Materialwart
 * entscheidet. Texte als Template-Literale im Code wie im uebrigen Portal;
 * Werte aus der DB gehen durch esc().
 *
 * Alle Funktionen werden NACH dem Commit aufgerufen und werfen nach aussen
 * nicht: ein SMTP-Ausfall darf keinen Antrag kippen. Die Aufrufer haengen
 * `.catch(...)` mit Log an (siehe api/portal-material.ts).
 */

/** Wer im Portal nach "Materialwart" gefragt wird, ohne Selbstversand. */
export async function materialwarte(
  ohnePortalUserID?: number
): Promise<string[]> {
  let rows = await queryP<{ portalUserID: number; email: string }>(
    'SELECT portalUserID, email FROM portalUser WHERE is_material_verwalter = 1 AND aktiv = 1'
  )
  if (!rows.length) {
    // Niemand traegt die Rolle: dann sollen es wenigstens die Superuser
    // erfahren, sonst liegt der Antrag unbemerkt.
    rows = await queryP<{ portalUserID: number; email: string }>(
      'SELECT portalUserID, email FROM portalUser WHERE is_superuser = 1 AND aktiv = 1'
    )
  }
  const liste = rows
    .filter((r) => r.portalUserID !== ohnePortalUserID)
    .map((r) => r.email)
  if (!liste.length) {
    console.warn(
      '[material] Kein Materialwart mit aktivem Zugang -- Benachrichtigung entfaellt.'
    )
  }
  return liste
}

const linkNutzer = (id: number) => `${portalBaseUrl()}/#/material/antrag/${id}`
const linkWart = (id: number) =>
  `${portalBaseUrl()}/#/materialwart/antrag/${id}`

const zeitraum = (a: AntragDetail) =>
  `${a.vonObj?.german ?? a.von} – ${a.bisObj?.german ?? a.bis}`

const betreff = (a: AntragDetail, ereignis: string) =>
  `Materialantrag „${a.anlass}“ (${zeitraum(a)}): ${ereignis}`

const kopfzeile = (a: AntragDetail) => `<table cellpadding="4">
  <tr><td><strong>Anlass</strong></td><td>${esc(a.anlass)}${a.kreis ? ` (${esc(a.kreis)})` : ''}</td></tr>
  <tr><td><strong>Zeitraum</strong></td><td>${esc(zeitraum(a))}</td></tr>
  <tr><td><strong>Antragsteller/in</strong></td><td>${esc(a.antragsteller.vorname)} ${esc(a.antragsteller.nachname)}</td></tr>
</table>`

const absatz = (label: string, t: string) =>
  t.trim()
    ? `<p><strong>${label}:</strong><br>${esc(t).replace(/\n/g, '<br>')}</p>`
    : ''

const zelle = 'style="border-bottom:1px solid #ddd;padding:4px 8px"'

/**
 * Gemeinsamer Renderer der Positionsliste. Mit `mitGenehmigt` zwei Spalten:
 * gestrichene Positionen durchgestrichen, reduzierte hervorgehoben. `vorher`
 * blendet eine dritte Spalte mit der vorherigen Genehmigung ein.
 */
export function antragTabelle(
  positionen: Position[],
  opt: {
    mitGenehmigt?: boolean
    vorher?: Map<number, number | null>
    mitLagerort?: boolean
  } = {}
): string {
  const kopf = [
    '<th align="left">Material</th>',
    '<th align="right">beantragt</th>',
    opt.vorher ? '<th align="right">bisher</th>' : '',
    opt.mitGenehmigt ? '<th align="right">genehmigt</th>' : '',
    opt.mitLagerort ? '<th align="left">Lagerort</th>' : ''
  ].join('')
  const zeilen = positionen
    .map((p) => {
      const gestrichen = opt.mitGenehmigt && p.mengeGenehmigt === 0
      const reduziert =
        opt.mitGenehmigt &&
        p.mengeGenehmigt !== null &&
        p.mengeGenehmigt > 0 &&
        p.mengeGenehmigt < p.menge
      const stil = gestrichen
        ? 'text-decoration:line-through;color:#888'
        : reduziert
          ? 'color:#AC1636;font-weight:bold'
          : ''
      const alt = opt.vorher?.get(p.materialAntragPositionID)
      return `<tr style="${stil}">
  <td ${zelle}>${esc(p.name)}</td>
  <td ${zelle} align="right">${p.menge}</td>
  ${opt.vorher ? `<td ${zelle} align="right">${alt === null || alt === undefined ? '–' : alt}</td>` : ''}
  ${opt.mitGenehmigt ? `<td ${zelle} align="right">${p.mengeGenehmigt === null ? '–' : p.mengeGenehmigt}</td>` : ''}
  ${opt.mitLagerort ? `<td ${zelle}>${esc(p.lagerort)}</td>` : ''}
</tr>`
    })
    .join('')
  return `<table cellspacing="0" style="border-collapse:collapse"><tr>${kopf}</tr>${zeilen}</table>`
}

async function anAlle(
  empfaenger: string[],
  subject: string,
  html: string
): Promise<void> {
  if (!empfaenger.length) return
  await sendePortalMail(empfaenger.join(', '), subject, html, '')
}

/* ------------------------------------------------- an die Materialwarte -- */

export async function sendeAntragEingegangen(
  a: AntragDetail,
  konfliktPositionen: number
): Promise<void> {
  const hinweis =
    konfliktPositionen > 0
      ? `<p style="color:#AC1636">Bei ${konfliktPositionen} Position(en) gibt es im
Zeitraum bereits andere Anfragen oder Reservierungen — bitte im Portal prüfen.</p>`
      : ''
  await anAlle(
    await materialwarte(a.portalUserID),
    betreff(a, 'neuer Antrag'),
    `<p>Im EC-Portal ist ein neuer Materialantrag eingegangen.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen)}
${absatz('Kommentar', a.kommentar)}
${hinweis}
<p><a href="${linkWart(a.materialAntragID)}">Antrag im Portal bearbeiten</a></p>
${FUSS}`
  )
}

export async function sendeAntragStorniert(a: AntragDetail): Promise<void> {
  await anAlle(
    await materialwarte(a.portalUserID),
    betreff(a, 'zurückgezogen'),
    `<p>${esc(a.antragsteller.vorname)} ${esc(a.antragsteller.nachname)} hat den
Materialantrag zurückgezogen. Es ist nichts weiter zu tun.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen)}
<p><a href="${linkWart(a.materialAntragID)}">Antrag im Portal ansehen</a></p>
${FUSS}`
  )
}

export async function sendeAllesZurueck(a: AntragDetail): Promise<void> {
  await anAlle(
    await materialwarte(),
    betreff(a, 'alles zurückgebracht'),
    `<p>${esc(a.antragsteller.vorname)} ${esc(a.antragsteller.nachname)} hat in der
Packliste alle Positionen als zurückgebracht abgehakt. Wenn alles da ist, kann
der Antrag abgeschlossen werden.</p>
${kopfzeile(a)}
${antragTabelle(
  a.positionen.filter((p) => (p.mengeGenehmigt ?? 0) > 0),
  { mitGenehmigt: true }
)}
<p><a href="${linkWart(a.materialAntragID)}">Antrag im Portal abschließen</a></p>
${FUSS}`
  )
}

/* ------------------------------------------------- an den Antragsteller -- */

export type Entscheidung =
  | 'genehmigt'
  | 'abgelehnt'
  | 'geaendert'
  | 'zurueckgezogen'
  | 'offen'
  | 'abgeschlossen'

export async function sendeAntragEntschieden(
  a: AntragDetail,
  art: Entscheidung,
  opt: {
    /** Genehmigungen vor der Aenderung (nur bei 'geaendert'). */
    vorher?: Map<number, number | null>
    /** Positionen, die beim Abschluss noch nicht abgehakt waren. */
    nichtAbgehakt?: Position[]
    /** Wer entschieden hat -- kein Selbstversand. */
    durchPortalUserID?: number
  } = {}
): Promise<void> {
  if (opt.durchPortalUserID === a.portalUserID) return
  const to = a.antragsteller.email
  const anrede = `<p>Hallo <strong>${esc(a.antragsteller.vorname)}</strong>,</p>`
  const link = `<p><a href="${linkNutzer(a.materialAntragID)}">Antrag im Portal ansehen</a></p>`
  const antwort = absatz('Antwort der Materialverwaltung', a.antwort)

  switch (art) {
    case 'genehmigt':
      await sendePortalMail(
        to,
        betreff(a, 'genehmigt'),
        `${anrede}
<p>dein Materialantrag wurde <strong>genehmigt</strong>. Durchgestrichene
Positionen sind nicht dabei, abweichende Mengen sind hervorgehoben.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen, { mitGenehmigt: true, mitLagerort: true })}
${antwort}
<p>Im Portal findest du jetzt die <strong>Packliste</strong>: dort hakst du ab,
was du eingeladen und später wieder zurückgebracht hast.</p>
${link}${FUSS}`,
        ''
      )
      return
    case 'abgelehnt':
      await sendePortalMail(
        to,
        betreff(a, 'abgelehnt'),
        `${anrede}
<p>dein Materialantrag wurde leider <strong>abgelehnt</strong>.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen)}
${antwort}
${link}${FUSS}`,
        ''
      )
      return
    case 'geaendert':
      await sendePortalMail(
        to,
        betreff(a, 'geändert'),
        `${anrede}
<p>an deinem genehmigten Materialantrag wurde etwas <strong>geändert</strong>.
Die Spalte „bisher“ zeigt die vorherige Genehmigung.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen, { mitGenehmigt: true, vorher: opt.vorher, mitLagerort: true })}
${antwort}
${link}${FUSS}`,
        ''
      )
      return
    case 'zurueckgezogen':
      await sendePortalMail(
        to,
        betreff(a, 'Genehmigung zurückgezogen'),
        `${anrede}
<p>die Genehmigung deines Materialantrags wurde <strong>zurückgezogen</strong>.
Das Material steht dir damit nicht mehr zur Verfügung.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen)}
${antwort}
${link}${FUSS}`,
        ''
      )
      return
    case 'offen':
      await sendePortalMail(
        to,
        betreff(a, 'wieder in Bearbeitung'),
        `${anrede}
<p>dein Materialantrag wurde <strong>wieder geöffnet</strong> und wird erneut
geprüft. Du bekommst eine Mail, sobald entschieden ist.</p>
${kopfzeile(a)}
${antwort}
${link}${FUSS}`,
        ''
      )
      return
    case 'abgeschlossen': {
      const offen = opt.nichtAbgehakt ?? []
      const hinweis = offen.length
        ? `<p>Folgende Positionen hattest du noch nicht als zurückgebracht
abgehakt — laut Materialverwaltung sind sie zurück:</p>
<ul>${offen.map((p) => `<li>${esc(p.name)} (${p.mengeGenehmigt})</li>`).join('')}</ul>`
        : ''
      await sendePortalMail(
        to,
        betreff(a, 'abgeschlossen'),
        `${anrede}
<p>die Rückgabe wurde geprüft, dein Materialantrag ist damit
<strong>abgeschlossen</strong>. Danke!</p>
${kopfzeile(a)}
${hinweis}
${antwort}
${link}${FUSS}`,
        ''
      )
      return
    }
  }
}

/* -------------------------------------------------------- Erinnerungen -- */

export async function sendeErinnerungRueckgabe(a: AntragDetail): Promise<void> {
  const offen = a.positionen.filter(
    (p) => (p.mengeGenehmigt ?? 0) > 0 && !p.zurueck
  )
  const liste = `<ul>${offen
    .map((p) => `<li>${esc(p.name)} (${p.mengeGenehmigt})</li>`)
    .join('')}</ul>`
  await sendePortalMail(
    a.antragsteller.email,
    betreff(a, 'Rückgabe offen'),
    `<p>Hallo <strong>${esc(a.antragsteller.vorname)}</strong>,</p>
<p>der Ausleihzeitraum deines Materialantrags ist vorbei, und folgende
Positionen sind noch nicht als zurückgebracht abgehakt:</p>
${liste}
<p>Bitte bring das Material zurück und hake es im Portal ab — oder melde dich
bei der Materialverwaltung, wenn etwas fehlt.</p>
<p><a href="${linkNutzer(a.materialAntragID)}">Packliste im Portal</a></p>
${FUSS}`,
    ''
  )
  await anAlle(
    await materialwarte(),
    betreff(a, 'Rückgabe überfällig'),
    `<p>Der Ausleihzeitraum ist vorbei, aber der Antrag ist noch nicht
abgeschlossen. Nicht abgehakt:</p>
${kopfzeile(a)}
${liste}
<p>Die Antragstellerin bzw. der Antragsteller wurde ebenfalls erinnert.</p>
<p><a href="${linkWart(a.materialAntragID)}">Antrag im Portal</a></p>
${FUSS}`
  )
}

export async function sendeErinnerungOffen(a: AntragDetail): Promise<void> {
  await anAlle(
    await materialwarte(),
    betreff(a, 'noch unbearbeitet'),
    `<p>Dieser Materialantrag wartet noch auf eine Entscheidung.</p>
${kopfzeile(a)}
${antragTabelle(a.positionen)}
${absatz('Kommentar', a.kommentar)}
<p><a href="${linkWart(a.materialAntragID)}">Antrag im Portal bearbeiten</a></p>
${FUSS}`
  )
}
