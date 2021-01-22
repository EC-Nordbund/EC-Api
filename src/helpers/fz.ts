import mail from './mail'
import { getMySQL } from './mysql'
import { Readable } from 'stream'
import worker from 'comlink:../workers/generation'
import { ecError } from './error'
import sql from 'sql-escape-tag'

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
  adressID = -1,
  veranstaltungsID = -1
): Promise<void> {
  const con = await getMySQL(2)

  // Hole Adressdaten
  const adressen = await con.query(
    adressID !== -1
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
  const file = await worker.generateDocumentPDF('./fz.docx', {
    vorname: p.vorname,
    nachname: p.nachname,
    gebDat: p.gebDat.toISOString().split('T')[0].split('-').reverse().join('.'),
    strasse: a.strasse,
    plz: a.plz,
    ort: a.ort,
    geschlecht: p.geschlecht,
    date: new Date().toISOString().split('T')[0].split('-').reverse().join('.')
  })

  /**
   * In dieser Reihenfolge
   *
   * 1. Normal
   * 2. VorOrt
   * 3. Veranstaltung
   */
  const text =
    veranstaltungsID === -1
      ? `<p>Hey <b>${p.vorname} ${p.nachname}</b>,</p>
    <p>du bist als Mitarbeiter${p.geschlecht === 'w' ? 'in' : ''} 
    im EC-Nordbund überregional oder in deiner Gemeinschaft/Gemeinde vor Ort tätig. 
    Das freut uns ungemein. <b>Danke für deinen Einsatz.</b><br>
    Der Gesetzgeber verlangt von uns, dass wir alle fünf Jahre Einsicht in ein <u><i>aktuelles</i> erweitertes Führungszeugnis</u> nehmen müssen.<br>
    Im Anhang findest du das Formular, mit dem Du <u>bei deiner zuständigen Meldebehörde</u> das Führungszeugnis beantragen kannst.<br>
    Dieses Führungszeugnis musst du bei dem Verantwortlichen bei dir vor Ort oder bei mir (innerhalb von drei Monaten nach Ausstellung des Zeugnisses) vorzeigen.<br>
    Wir hoffen, dass du Verständnis dafür hast, und entschuldigen uns für den Mehraufwand, den du dadurch hast.</p>
    <p>P.S. Du musst das Zeugnis nur vorzeigen. Nicht abgeben. Wenn es für dich allerdings einfacher sein sollte, das Zeugnis einzuscannen und mir zuzumailen (bitte an <a href="mailto:fz@ec-nordbund.de">fz@ec-nordbund.de</a>), ist das für uns in Ordnung.<br>
    Du bist nur nicht verpflichtet, es uns zur Verfügung zu stellen, so dass wir es speichern können. Wir notieren uns keine Inhalte des Zeugnisses und löschen auch die Mail, falls du das wünscht...</p>
    <p>Entschieden für Christus grüßt</p>
    <p><b>ThomaS:-)</b></p>`
      : veranstaltungsID === 42
      ? `<p>Hey <b>${p.vorname} ${p.nachname}</b>,</p>
    <p>du hast dich gerade als Mitarbeiter${p.geschlecht === 'w' ? 'in' : ''} 
    in deinem EC-Kreis oder deiner Gemeinschaft angemeldet. 
    Das freut uns ungemein. <b>Danke für deinen Einsatz.</b><br>
    Der Gesetzgeber verlangt von uns, dass wir alle fünf Jahre Einsicht in ein <u><i>aktuelles</i> erweitertes Führungszeugnis</u> nehmen müssen.<br>
    Im Anhang findest du das Formular, mit dem Du <u>bei deiner zuständigen Meldebehörde</u> das Führungszeugnis beantragen kannst.<br>
    Dieses Führungszeugnis musst du bei dem Verantwortlichen bei dir vor Ort oder bei mir (innerhalb von drei Monaten nach Ausstellung des Zeugnisses) vorzeigen.<br>
    Wir hoffen, dass du Verständnis dafür hast, und entschuldigen uns für den Mehraufwand, den du dadurch hast.</p>
    <p>P.S. Du musst das Zeugnis nur vorzeigen. Nicht abgeben. Wenn es für dich allerdings einfacher sein sollte, das Zeugnis einzuscannen und mir zuzumailen (bitte an <a href="mailto:fz@ec-nordbund.de">fz@ec-nordbund.de</a>), ist das für uns in Ordnung.<br>
    Du bist nur nicht verpflichtet, es uns zur Verfügung zu stellen, so dass wir es speichern können. Wir notieren uns keine Inhalte des Zeugnisses und löschen auch die Mail, falls du das wünscht...</p>
    <p>Entschieden für Christus grüßt</p>
    <p><b>ThomaS:-)</b></p>`
      : `<p>Hey <b>${p.vorname} ${p.nachname}</b>,</p>
    <p>du hast dich gerade als Mitarbeiter${p.geschlecht === 'w' ? 'in' : ''} 
    auf einer EC-Freizeit angemeldet. 
    Das freut uns ungemein. <b>Danke für deinen Einsatz.</b><br>
    Wir haben allerdings noch kein (oder kein aktuell gültiges) <u>erweitertes Führungszeugnis</u> von dir eingesehen.
    Der Gesetzgeber verlangt von uns, dass wir alle fünf Jahre Einsicht in ein <u><i>aktuelles</i> erweitertes Führungszeugnis</u> nehmen müssen.<br>
    Im Anhang findest du das Formular, mit dem Du <u>bei deiner zuständigen Meldebehörde</u> das Führungszeugnis beantragen kannst.<br>
    Dieses Führungszeugnis musst du vor der Freizeit bei dem Freizeitleiter oder bei mir (inerhalb von drei Monaten nach Austellung des Zeugnisses) vorzeigen.<br>
    Wir hoffen, dass du Verständnis dafür hast, und entschuldigen uns für den Mehraufwand, den du dadurch hast.  (Bei zeitlichen Problemen müsstest du unbedingt <i><b><u>vor</u></b></i> der Freizeit Kontakt mit uns aufnehmen, damit wir schauen können, wie wir weiter verfahren.)</p>
    <p>P.S. Du musst das Zeugnis nur vorzeigen. Nicht abgeben. Wenn es für dich allerdings einfacher sein sollte, das Zeugnis einzuscannen und mir zuzumailen (bitte an <a href="mailto:fz@ec-nordbund.de">fz@ec-nordbund.de</a>), ist das für uns in Ordnung.<br>
    Du bist nur nicht verpflichtet, es uns zur Verfügung zu stellen, so dass wir es speichern können. Wir notieren uns keine Inhalte des Zeugnisses und löschen auch die Mail, falls du das wünscht...</p>
    <p>Entschieden für Christus grüßt</p>
    <p><b>ThomaS:-)</b></p>`

  // Sende Mail
  await mail(
    'fz@ec-nordbund.de',
    { to: email, bcc: 'fz@ec-nordbund.de;datenschutz@ec-nordbund.de' },
    'Erweitertes Führungszeugnis',
    text,
    true,
    [{ content: Buffer.from(file), filename: 'fzAntrag.pdf' }]
  )
}
