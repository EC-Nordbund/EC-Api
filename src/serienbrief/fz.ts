import mail from '../schema/mail'
import { query } from '../schema/mysql'
import { readFileSync } from 'fs'
import { Readable } from 'stream'
import createReport from './generator'
export function createFZ(
  personID: number,
  email: string,
  adressID = -1
): Promise<void> {
  return createFZWithData(personID, adressID).then((file) => {
    query(
      `SELECT vorname, nachname, geschlecht FROM personen WHERE personID = ${personID}`
    ).then((rows) => {
      const p = rows[0]
      return mail(
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
    })
  })
}

export function createFZWithData(
  personID: number,
  adressID = -1
): Promise<NodeJS.ReadableStream> {
  return new Promise((res, rej) => {
    if (adressID === -1) {
      query(
        `SELECT adressID FROM adressen WHERE personID = ${personID} AND isOld = 0 ORDER BY lastUsed LIMIT 1`
      ).then((row: Array<{ adressID: number }>) => {
        if (row.length === 0) {
          rej('Keine Gültige Adresse gefunden')
        } else {
          createFZWithData(personID, row[0].adressID).then(res)
        }
      })
    } else {
      query(
        `SELECT strasse, plz, ort FROM adressen WHERE adressID = ${adressID}`
      ).then(
        (adressen: Array<{ strasse: string; plz: string; ort: string }>) => {
          query(
            `SELECT vorname, nachname, gebDat, geschlecht FROM personen WHERE personID = ${personID}`
          ).then(
            (
              personen: Array<{
                vorname: string
                nachname: string
                gebDat: Date
                geschlecht: string
              }>
            ) => {
              const p = personen[0]
              const a = adressen[0]
              createFZDocument(
                p.vorname,
                p.nachname,
                `${p.gebDat.getDate()}.${
                  p.gebDat.getMonth() + 1
                }.${p.gebDat.getFullYear()}`,
                a.strasse,
                a.plz,
                a.ort,
                p.geschlecht
              ).then(res)
            }
          )
        }
      )
    }
  })
}

const fzDocument = readFileSync('./fz.docx')

async function createFZDocument(
  vorname: string,
  nachname: string,
  gebDat: string,
  strasse: string,
  plz: string,
  ort: string,
  geschlecht: string
): Promise<NodeJS.ReadableStream> {
  const result = await createReport(fzDocument, {
    vorname,
    nachname,
    gebDat,
    strasse,
    plz,
    ort,
    geschlecht,
    date: new Date().toISOString().split('T')[0].split('-').reverse().join('.'),
  })

  return result
}
