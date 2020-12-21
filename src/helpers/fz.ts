import mail from './mail'
import { getMySQL } from './mysql'
import { readFileSync } from 'fs'
import { Readable } from 'stream'
import createReport from './generator'
import { ecError } from './error'
import sql from 'sql-escape-tag'

const fzDocument = readFileSync('./fz.docx')

/**
 * Erzeugt einen FZ-Antrag für eine bestimmte Person und sendet ihn per Mail an diese.
 *
 * @author Sebastian
 *
 * @param personID ID der Person
 * @param email Email (als String)
 * @param adressID <i>(optional)</i> ID der Adresse
 */
export async function createFZ(
  personID: number,
  email: string,
  adressID = -1
): Promise<void> {
  const con = await getMySQL(2)

  // Hole Adressdaten
  const adressen = await con.query(
    adressID === -1
      ? sql`SELECT strasse, plz, ort FROM adressen WHERE adressID = ${adressID}`
      : sql`SELECT strasse, plz, ort FROM adressen WHERE personID = ${personID} AND isOld = 0 ORDER BY lastUsed LIMIT 1`
  )

  if (adressen.length === 0) {
    throw new ecError('Keine Adresse gefunden', 404)
  }

  // Hole Personendaten
  const personenDaten = await con.query(
    sql`SELECT vorname, nachname, gebDat, geschlecht FROM personen WHERE personID = ${personID}`
  )

  if (personenDaten.length === 0) {
    throw new ecError('Keine Person gefunden!', 404)
  }

  const p = personenDaten[0]
  const a = adressen[0]

  // Erzeuge Antrag-PDF
  const file = await createReport(fzDocument, {
    vorname: p.vorname,
    nachname: p.nachname,
    gebDat: `${p.gebDat.getDate()}.${
      p.gebDat.getMonth() + 1
    }.${p.gebDat.getFullYear()}`,
    strasse: a.strasse,
    plz: a.plz,
    ort: a.ort,
    geschlecht: p.geschlecht,
    date: new Date().toISOString().split('T')[0].split('-').reverse().join('.')
  })

  // Sende Mail
  await mail(
    'fz@ec-nordbund.de',
    { to: email, bcc: 'fz@ec-nordbund.de;datenschutz@ec-nordbund.de' },
    'Erweitertes Führungszeugnis',
    `<p>Hey <b>${p.vorname} ${p.nachname}</b>,</p>
        <p>du bist als Mitarbeiter${
          p.geschlecht === 'w' ? 'in' : ''
        } im EC-Nordbund überregional oder in deiner Gemeinschaft/Gemeinde vor Ort tätig. Das freut uns ungemein. <b>Danke für deinen Einsatz.</b><br>
        Der Gesetzgeber verlangt von uns, dass wir alle fünf Jahre Einsicht in ein <u><i>aktuelles</i> erweitertes Führungszeugnis</u> nehmen müssen.<br>
        Im Anhang findest du das Formular, mit dem Du <u>bei deiner zuständigen Meldebehörde</u> das Führungszeugnis beantragen kannst.<br>
        Dieses Führungszeugnis musst du bei dem Verantwortlichen bei dir vor Ort oder bei mir (innerhalb von drei Monaten nach Ausstellung des Zeugnisses) vorzeigen.<br>
        Wir hoffen, dass du Verständnis dafür hast, und entschuldigen uns für den Mehraufwand, den du dadurch hast.</p>
        <p>P.S. Du musst das Zeugnis nur vorzeigen. Nicht abgeben. Wenn es für dich allerdings einfacher sein sollte, das Zeugnis einzuscannen und mir zuzumailen (bitte an <a href="mailto:fz@ec-nordbund.de">fz@ec-nordbund.de</a>), ist das für uns in Ordnung.<br>
        Du bist nur nicht verpflichtet, es uns zur Verfügung zu stellen, so dass wir es speichern können. Wir notieren uns keine Inhalte des Zeugnisses und löschen auch die Mail, falls du das wünscht...</p>
        <p>Entschieden für Christus grüßt</p>
        <p><b>ThomaS:-)</b></p>`,
    true,
    [{ content: Readable.from(file), filename: 'fzAntrag.pdf' }]
  )
}
