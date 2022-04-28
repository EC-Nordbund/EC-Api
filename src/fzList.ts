import { query } from './helpers/mysql'
import * as xlsx from 'xlsx-template/lib'

const fzTemplates = {
  ec: null,
  veranstaltung: null,
  all: null
}

const template = new xlsx()

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

function getDataAll() {
  return query<FZData>(
    `SELECT personen.personID, personen.vorname, personen.nachname, personen.gebDat, ecKreis.bezeichnung, fzm.gesehenVon, fzm.gesehenAm, fzm.fzVon, fza.erzeugt_durch, fza.erzeugt FROM personen LEFT JOIN ecKreis ON ecKreis.ecKreisID = personen.ecKreis LEFT JOIN (SELECT MAX(fz.fzID) as fzID, fz.personID, IF(personen.personID = 0, "N/A", CONCAT(personen.vorname, " ", personen.nachname)) as gesehenVon, fz.fzVon, fz.gesehenAm FROM fz LEFT JOIN personen ON personen.personID = fz.gesehenVon GROUP BY personID) fzm ON fzm.personID = personen.personID LEFT JOIN (SELECT MAX(fzAntrag.fzAntragID) as fzAntragID, fzAntrag.erzeugt, fzAntrag.erzeugt_durch, fzAntrag.personID from fzAntrag GROUP BY personID) fza ON fza.personID = personen.personID WHERE personen.personID IN (SELECT personID FROM personen WHERE (EXISTS (SELECT * FROM fzAntrag WHERE fzAntrag.personID = personen.personID) OR EXISTS (SELECT * FROM fz WHERE fz.personID = personen.personID)))`
  )
}

function getDataECKreis(kreisID: number) {
  return query<FZData>(
    `SELECT personen.personID, personen.vorname, personen.nachname, personen.gebDat, ecKreis.bezeichnung, fzm.gesehenVon, fzm.gesehenAm, fzm.fzVon, fza.erzeugt_durch, fza.erzeugt FROM personen LEFT JOIN ecKreis ON ecKreis.ecKreisID = personen.ecKreis LEFT JOIN (SELECT MAX(fz.fzID) as fzID, fz.personID, IF(personen.personID = 0, "N/A", CONCAT(personen.vorname, " ", personen.nachname)) as gesehenVon, fz.fzVon, fz.gesehenAm FROM fz LEFT JOIN personen ON personen.personID = fz.gesehenVon GROUP BY personID) fzm ON fzm.personID = personen.personID LEFT JOIN (SELECT MAX(fzAntrag.fzAntragID) as fzAntragID, fzAntrag.erzeugt, fzAntrag.erzeugt_durch, fzAntrag.personID from fzAntrag GROUP BY personID) fza ON fza.personID = personen.personID WHERE personen.personID IN (SELECT personID FROM personen WHERE (EXISTS (SELECT * FROM fzAntrag WHERE fzAntrag.personID = personen.personID) OR EXISTS (SELECT * FROM fz WHERE fz.personID = personen.personID)) AND personen.ecKreis = ${kreisID})`
  )
}

function getDataVeranstaltung(vID: number) {
  return query<FZData>(
    `SELECT personen.personID, personen.vorname, personen.nachname, personen.gebDat, ecKreis.bezeichnung, fzm.gesehenVon, fzm.gesehenAm, DATE_ADD(fzm.gesehenAm, INTERVAL 5 YEAR) as gueltigBis, DATE_ADD(fzm.gesehenAm, INTERVAL 5 YEAR) > NOW() as gueltig,fzm.fzVon, fza.erzeugt_durch, fza.erzeugt FROM personen LEFT JOIN ecKreis ON ecKreis.ecKreisID = personen.ecKreis LEFT JOIN (SELECT MAX(fz.fzID) as fzID, fz.personID, IF(personen.personID = 0, "N/A", CONCAT(personen.vorname, " ", personen.nachname)) as gesehenVon, fz.fzVon, fz.gesehenAm FROM fz LEFT JOIN personen ON personen.personID = fz.gesehenVon GROUP BY personID) fzm ON fzm.personID = personen.personID LEFT JOIN (SELECT MAX(fzAntrag.fzAntragID) as fzAntragID, fzAntrag.erzeugt, fzAntrag.erzeugt_durch, fzAntrag.personID from fzAntrag GROUP BY personID) fza ON fza.personID = personen.personID WHERE personen.personID IN (SELECT personID FROM anmeldungen WHERE anmeldungen.position > 1 AND anmeldungen.veranstaltungsID = ${vID})`
  )
}
