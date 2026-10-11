import { query } from './helpers/mysql'
import xlsx from 'xlsx-template'
import { ladeVorlage } from './vorlagen/store'

/**
 * FZ-Gesamtliste als Excel. Die Vorlage kommt aus den Dateivorlagen
 * (`fz.liste-alle`: Datenbank, sonst ./all.xlsx) und wird je Aufruf geholt --
 * bis 09/2026 wurde sie beim Modul-Laden gelesen, ohne die Datei startete die
 * API nicht.
 */
function render(data: any, template: Buffer) {
  const workbook = new xlsx(template)
  workbook.substitute(1, data)
  return workbook.generate({ type: 'nodebuffer' })
}

interface FZData {
  personID: number
  vorname: string
  nachname: string
  gebDat: Date
  bezeichnung: string
  gesehenVon: string
  gesehenAm: Date
  gueltigBis: Date
  gueltig: boolean
  fzVon: Date
  erzeugt_durch: string
  erzeugt: Date
}

export async function createFZAll() {
  const getDATA = await getDataAll()
  const vorlage = await ladeVorlage('fz.liste-alle')

  return render(
    {
      row: getDATA.map((v) => ({
        personID: v.personID,
        vorname: v.vorname,
        nachname: v.nachname,
        gebDat: v.gebDat,
        bezeichnung: v.bezeichnung ?? 'N/A',
        gesehenVon: v.gesehenVon ?? '',
        gesehenAm: v.gesehenAm ?? '',
        gueltigBis: v.gueltigBis ?? '',
        gueltig: v.gueltig ?? false,
        fzVon: v.fzVon ?? '',
        erzeugt_durch: v.erzeugt_durch ?? '',
        erzeugt: v.erzeugt ?? ''
      })),
      heute: new Date()
    },
    vorlage.inhalt
  )
}

function getDataAll() {
  return query<FZData>(
    `SELECT personen.personID, personen.vorname, personen.nachname, personen.gebDat, ecKreis.bezeichnung, fzm.gesehenVon, fzm.gesehenAm, fzm.fzVon, fza.erzeugt_durch, fza.erzeugt FROM personen LEFT JOIN ecKreis ON ecKreis.ecKreisID = personen.ecKreis LEFT JOIN (SELECT MAX(fz.fzID) as fzID, fz.personID, IF(personen.personID = 0, "N/A", CONCAT(personen.vorname, " ", personen.nachname)) as gesehenVon, fz.fzVon, fz.gesehenAm FROM fz LEFT JOIN personen ON personen.personID = fz.gesehenVon GROUP BY personID) fzm ON fzm.personID = personen.personID LEFT JOIN (SELECT MAX(fzAntrag.fzAntragID) as fzAntragID, fzAntrag.erzeugt, fzAntrag.erzeugt_durch, fzAntrag.personID from fzAntrag GROUP BY personID) fza ON fza.personID = personen.personID WHERE personen.personID IN (SELECT personID FROM personen WHERE (EXISTS (SELECT * FROM fzAntrag WHERE fzAntrag.personID = personen.personID) OR EXISTS (SELECT * FROM fz WHERE fz.personID = personen.personID)))`
  )
}
