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
      WHERE veranstaltungen.veranstaltungsID = ${vID}`
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
        AND anmeldungen.adressID = adressen.adressID 
        AND anmeldungen.eMailID = eMails.eMailID 
        AND anmeldungen.anmeldeID = ${aID}`
  ).then((v) => v[0])
}

export async function createBriefVeranstaltung(vID: number) {
  const anmeldeIDs: { anmeldeID: string }[] = await query(
    sql`SELECT anmeldeID FROM anmeldungen WHERE wartelistenPlatz = 0 AND position = 1 AND bestaetigungsBrief is null AND veranstaltungsID = ${vID}`
  )
  const vData = await getVData(vID)
  const aData = await Promise.all(
    anmeldeIDs.map((v) => getAnmeldeData(v.anmeldeID))
  )

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
  const begin = vData.begin.toISOString().split('T')[0]
  const beginMinus18 = begin
    .split('-')
    .map((v, i) => (i === 0 ? parseInt(v) - 18 : v))
    .join('-')

  const gebDat = aData.gebDat.toISOString().split('T')[0]

  const restzahlung = new Date(
    (vData.begin as Date).getTime() - 1000 * 60 * 60 * 24 * 21
  )
    .toISOString()
    .split('T')[0]

  const type =
    aData.anmeldeZeitpunkt < vData.fruehbucherBis
      ? 'Fruehbucher'
      : aData.anmeldeZeitpunkt > vData.lastMinuteAb
      ? 'LastMinute'
      : 'Normal'

  const preis = vData[`preis${type}`]

  const file = await worker.generateDocumentPDF(
    `./best-brief-${vData.briefID}.docx`,
    {
      heute: new Date()
        .toISOString()
        .split('T')[0]
        .split('-')
        .reverse()
        .join('.'),
      anmeldeID: aData.anmeldeID,
      person: {
        vorname: aData.vorname,
        nachname: aData.nachname,
        gebDat: gebDat.split('-').reverse().join('.'),
        geschlecht: aData.geschlecht,
        volljaehrig: beginMinus18 >= gebDat
      },
      adresse: {
        strasse: aData.strasse,
        plz: aData.plz,
        ort: aData.ort
      },
      name: vData.name,
      begin: begin.split('-').reverse().join('.'),
      ende: vData.ende
        .toISOString()
        .split('T')[0]
        .split('-')
        .reverse()
        .join('.'),
      jahr: begin.split('-')[0],
      ort: vData.ort,
      anzahlung: vData.anzahlung + ',00',
      restzahlung: preis - vData.anzahlung + ',00',
      restzahlungsdatum: restzahlung.split('-').reverse().join('.'),
      vegetarisch: aData.vegetarisch,
      lebensmittelAllergien: aData.lebensmittelAllergien,
      fahrgemeinschaften: aData.fahrgemeinschaften,
      bemerkungen: aData.bemerkungen,
      gesundheitsinformationen: aData.gesundheitsinformationen,
      schwimmen: aData.schwimmen,
      sichEntfernen: aData.sichEntfernen,
      klettern: aData.klettern,
      bootfahren: aData.bootFahren
    }
  )

  // Sende Mail
  await mail(
    'anmeldung@ec-nordbund.de',
    {
      to: aData.email,
      cc: vData.informAnmeldecenter,
      bcc: 'datenschutz@ec-nordbund.de'
    },
    `Buchungsbestätigung für ${aData.vorname} ${aData.nachname} für ${
      vData.name
    } vom ${begin.split('-').reverse().join('.')} - ${vData.ende
      .toISOString()
      .split('T')[0]
      .split('-')
      .reverse()
      .join('.')}`,
    `<p>Hallo ${aData.vorname} ${
      aData.nachname
    },<br>Du hast dich zu unserem Angebot ${vData.name} vom ${begin
      .split('-')
      .reverse()
      .join('.')} - ${vData.ende
      .toISOString()
      .split('T')[0]
      .split('-')
      .reverse()
      .join(
        '.'
      )} angemeldet.  Anbei bekommst du die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lies alles sorgfältig. Du findest darin auch die für dich jetzt wichtigen Zahlungsinformationen.<br>${
      beginMinus18 >= gebDat
        ? ''
        : 'Bitte leite diese Informationen auch an deine Eltern weiter.<br>'
    }Falls du Fragen hast, melde dich gerne bei uns (du kannst einfach auf die E-Mail antworten).<br><br>Entschieden für Christus grüßt</p>`,
    true,
    [
      { content: Buffer.from(file), filename: 'bestaetingung_rechnung.pdf' },
      ...(await anhaenge)
    ],
    vData.informAnmeldecenter
  )

  await query(
    sql`UPDATE anmeldungen SET bestaetigungsBrief=CURRENT_TIMESTAMP WHERE anmeldeID = ${aData.anmeldeID}`
  )
}
