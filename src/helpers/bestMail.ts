import mail from './mail'
import { query } from './mysql'
import worker from 'comlink:../workers/generation'
import sql from 'sql-escape-tag'
import { readFile } from 'fs/promises'

async function getVData(vID: number): Promise<any> {
  return query(
    sql`
      SELECT * 
      FROM veranstaltungen, vOrte 
      WHERE 
        veranstaltungen.veranstaltungsort = vOrte.vOrtID 
        AND veranstaltungen.veranstaltungsID = ${vID}`
  ).then((v) => v[0])
}

async function getAnmeldeData(aID: string): Promise<any> {
  return query(
    sql`
      SELECT 
        personen.vorname, personen.nachname, personen.gebDat, personen.geschlecht, 
        adressen.strasse, adressen.plz, adressen.ort, 
        eMails.eMail, telefone.telefon, 
        anmeldungen.* 
      FROM 
        anmeldungen, adressen, eMails, telefone, personen 
      WHERE 
        anmeldungen.personID = personen.personID 
        AND anmeldungen.telefonID = telefone.telefonID 
        AND anmeldungen.adressID = anmeldungen.adressID 
        AND anmeldungen.eMailID = anmeldungen.eMailID 
        AND anmeldungen.anmeldeID = ${aID}`
  ).then((v) => v[0])
}

export async function createBriefVeranstaltung(vID: number) {
  const anmeldeIDs: string[] = await query(
    sql`SELECT anmeldeID FROM anmeldungen WHERE wartelistenPlatz = 0 AND position = 1 AND bestaetigungsBrief is null AND veranstaltungsID = ${vID}`
  )
  const vData = await getVData(vID)
  const aData = await Promise.all(anmeldeIDs.map((v) => getAnmeldeData(v)))

  await Promise.all(aData.map((v) => createBriefFromData(v, vData)))
}

export async function createBriefAnmeldung(anmeldeID: string) {
  const aData = await getAnmeldeData(anmeldeID)
  const vData = await getVData(aData.veranstaltungsID)

  createBriefFromData(aData, vData)
}

const anhaenge = (async () => [
  {
    content: await readFile('./tnBedingungen.pdf'),
    filename: 'TeilnehmeBedingungen.pdf'
  },
  {
    content: await readFile('./sicherungsschein.pdf'),
    filename: 'Sicherungsschein.pdf'
  }
])()

async function createBriefFromData(aData: any, vData: any): Promise<void> {
  // Erzeuge PDF
  const file = await worker.generateDocumentPDF(
    `./best-brief-${vData.briefID}.docx`,
    {
      ...vData,
      ...aData
    }
  )

  // Sende Mail
  await mail(
    'anmeldung@ec-nordbund.de',
    {
      to: aData.email,
      cc: `${vData.informAnmeldecenter}`,
      bcc: 'datenschutz@ec-nordbund.de'
    },
    `Deine Anmeldung zur Veranstaltung ${vData.officalName}`,
    'text',
    true,
    [
      { content: Buffer.from(file), filename: 'bestaetingung_rechnung.pdf' },
      ...(await anhaenge)
    ]
  )
}
