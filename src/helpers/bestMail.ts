import mail from './mail'
import { query } from './mysql'
import worker from 'comlink:../workers/generation'
import sql from 'sql-escape-tag'
import { readFile } from 'fs/promises'

async function getVData(vID: number): Promise<any> {
  return query(
    sql`
      SELECT * 
      FROM veranstaltungen
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

export interface BriefReport {
  gesendet: string[]
  fehler: { anmeldeID: string; grund: string }[]
}

/**
 * Verschickt Bestätigungsbriefe an alle offenen Anmeldungen einer
 * Veranstaltung (fester Platz, Teilnehmer, noch kein Brief). Ein Fehler bei
 * einer Anmeldung bricht die Serie NICHT ab — der Report sagt hinterher
 * genau, wer seinen Brief bekommen hat und bei wem es woran scheiterte.
 */
export async function createBriefVeranstaltung(
  vID: number
): Promise<BriefReport> {
  const anmeldeIDs: { anmeldeID: string }[] = await query(
    sql`SELECT anmeldeID FROM anmeldungen WHERE wartelistenPlatz = 0 AND position = 1 AND bestaetigungsBrief is null AND veranstaltungsID = ${vID}`
  )
  const vData = await getVData(vID)
  if (!vData) {
    throw new Error(`Veranstaltung ${vID} nicht gefunden`)
  }

  const report: BriefReport = { gesendet: [], fehler: [] }
  for (let i = 0; i < anmeldeIDs.length; i++) {
    const anmeldeID = anmeldeIDs[i].anmeldeID
    try {
      const aData = await getAnmeldeData(anmeldeID)
      await createBriefFromData(aData, vData)
      report.gesendet.push(anmeldeID)
    } catch (err) {
      console.error(`Bestätigungsbrief ${anmeldeID} fehlgeschlagen:`, err)
      report.fehler.push({ anmeldeID, grund: String(err).slice(0, 200) })
    }
  }
  return report
}

export async function createBriefAnmeldung(anmeldeID: string) {
  const aData = await getAnmeldeData(anmeldeID)
  if (!aData) {
    throw new Error(`Anmeldung ${anmeldeID} nicht gefunden`)
  }
  const vData = await getVData(aData.veranstaltungsID)

  await createBriefFromData(aData, vData)
}

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

  // NULL-sicher: `datum > null` ist in JS immer true (null -> 0) — ohne die
  // Guards bekam bei fehlendem lastMinuteAb JEDER den Last-Minute-Preis
  const type =
    vData.fruehbucherBis != null &&
    aData.anmeldeZeitpunkt < vData.fruehbucherBis
      ? 'Fruehbucher'
      : vData.lastMinuteAb != null &&
          aData.anmeldeZeitpunkt > vData.lastMinuteAb
        ? 'LastMinute'
        : 'Normal'

  // ende ist nullable (eintägige Veranstaltungen) — Fallback auf begin
  const beginStr = begin.split('-').reverse().join('.')
  const endeStr = ((vData.ende ?? vData.begin) as Date)
    .toISOString()
    .split('T')[0]
    .split('-')
    .reverse()
    .join('.')

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
      begin: beginStr,
      ende: endeStr,
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

  let text = 'N/A'

  if (vData.briefID === 1) {
    text = `<p>Hallo ${aData.vorname} ${
      aData.nachname
    },<br>Du hast dich zu unserem Angebot ${vData.name} vom ${beginStr} - ${endeStr} angemeldet.  Anbei bekommst du die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lies alles sorgfältig. Du findest darin auch die für dich jetzt wichtigen Zahlungsinformationen.<br>${
      beginMinus18 >= gebDat
        ? ''
        : 'Bitte leite diese Informationen auch an deine Eltern weiter.<br>'
    }Falls du Fragen hast, melde dich gerne bei uns (du kannst einfach auf die E-Mail antworten).<br><br>Entschieden für Christus grüßt<br><b>Tobias Krahe & Kirke Husberg</b></p>`
  } else if (vData.briefID === 2) {
    text = `<p>Liebe Eltern von ${aData.vorname} ${
      aData.nachname
    },<br>Sie haben ihr Kind zu unserem Angebot ${vData.name} vom ${beginStr} - ${endeStr} angemeldet.  Anbei erhalten Sie die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lesen Sie alles sorgfältig. Sie finden darin auch alle wichtigen Zahlungsinformationen.<br>
    Falls Sie Fragen haben, melden Sie sich gerne bei uns (Sie können einfach auf die E-Mail antworten).<br><br>Herzliche Grüße<br><b>Birgit Herbert</b></p>`
  } else if (vData.briefID === 3) {
    text = `<p>Moin ${aData.vorname} ${
      aData.nachname
    },<br>Du hast dich zu unserem Angebot ${vData.name} vom ${beginStr} - ${endeStr} angemeldet.  Anbei bekommst du die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lies alles sorgfältig. Du findest darin auch die für dich jetzt wichtigen Zahlungsinformationen.<br>${
      beginMinus18 >= gebDat
        ? ''
        : 'Bitte leite diese Informationen auch an deine Eltern weiter.<br>'
    }Falls du Fragen hast, melde dich gerne bei uns (du kannst einfach auf die E-Mail antworten).<br><br>Gott mit dir!<br>Beste Grüße<br><b>Kirke Husberg</b></p>`
  } else if (vData.briefID === 4) {
    text = `<p>Moin ${aData.vorname} ${
      aData.nachname
    },<br>Du hast dich zu unserem Angebot ${vData.name} vom ${beginStr} - ${endeStr} angemeldet.  Anbei bekommst du die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lies alles sorgfältig. Du findest darin auch die für dich jetzt wichtigen Zahlungsinformationen.<br>${
      beginMinus18 >= gebDat
        ? ''
        : 'Bitte leite diese Informationen auch an deine Eltern weiter.<br>'
    }Falls du Fragen hast, melde dich gerne bei uns (du kannst einfach auf die E-Mail antworten).<br><br>Gott mit dir!<br>Beste Grüße<br><b>Tobias Krahe</b></p>`
  } else if (vData.briefID === 5) {
    text = `<p>Moin ${aData.vorname} ${
      aData.nachname
    },<br>Du hast dich zu unserem Angebot ${vData.name} vom ${beginStr} - ${endeStr} angemeldet.  Anbei bekommst du die Buchungsbestätigung zusammen mit unseren Teilnahmebedingungen und dem gesetzlich vorgeschriebenen Sicherungsschein. Bitte lies alles sorgfältig. Du findest darin auch die für dich jetzt wichtigen Zahlungsinformationen.<br>${
      beginMinus18 >= gebDat
        ? ''
        : 'Bitte leite diese Informationen auch an deine Eltern weiter.<br>'
    }Falls du Fragen hast, melde dich gerne bei uns (du kannst einfach auf die E-Mail antworten).<br><br>Gott mit dir!<br>Beste Grüße<br><b>Dortje Gaertner</b></p>`
  }

  // Sende Mail
  await mail(
    'anmeldung@ec-nordbund.de',
    {
      to: aData.eMail,
      // nodemailer trennt Mehrfachempfänger mit Komma, nicht Semikolon
      cc: vData.informAnmeldecenter?.replace(/;/g, ',') ?? undefined,
      bcc: 'datenschutz@ec-nordbund.de'
    },
    `Buchungsbestätigung für ${aData.vorname} ${aData.nachname} für ${
      vData.name
    } vom ${beginStr} - ${endeStr}`,
    text,
    true,
    [
      { content: Buffer.from(file), filename: 'bestaetigung_rechnung.pdf' },
      {
        content: await readFile('./tnBedingungen.pdf'),
        filename: 'TeilnahmeBedingungen.pdf'
      },
      {
        content: await readFile(
          `./sicherungsschein_${begin.split('-')[0]}.pdf`
        ),
        filename: 'Sicherungsschein.pdf'
      }
    ],
    vData.informAnmeldecenter?.replace(/;/g, ',') ?? undefined
  )

  await query(
    sql`UPDATE anmeldungen SET bestaetigungsBrief=CURRENT_TIMESTAMP WHERE anmeldeID = ${aData.anmeldeID}`
  )
}
