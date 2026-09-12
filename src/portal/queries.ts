import { queryP, withConnection } from '../helpers/mysql'
import { Ampel, ampel, fzGueltigAmStichtag, gueltigBis } from './ampel'
import {
  FZ_MINDESTALTER,
  FZ_VORLAGE_FRIST_MONATE,
  FZ_GUELTIG_JAHRE
} from './config'
import { PortalFehler, badRequest, notFound } from './error'
import {
  DateObj,
  dateObj,
  heute,
  isoDatum,
  parseDatum,
  plusJahre,
  plusMonate,
  tsObj
} from './date'

/**
 * Alle Datenabfragen des Portals.
 *
 * Zwei Regeln gelten hier durchgehend:
 *  - Nur `queryP`/`withConnection`. `query()` schreibt jedes Statement samt
 *    Werten auf stdout; das waeren hier Namen, Geburtsdaten, Mailadressen und
 *    Telefonnummern im Container-Log.
 *  - `p.anonymisiert = 0` ueberall. Geloeschte Personen tauchen nirgends auf.
 */

/* -------------------------------------------------------------------------- */
/* Bausteine                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Das aktuellste Fuehrungszeugnis einer Person.
 *
 * Als korrelierte Subquery auf die fzID und nicht als `MAX(fzVon) ... GROUP BY
 * personID` wie in fzList.ts: dort stammen die uebrigen Spalten (gesehenAm,
 * kommentar) bei mehreren Zeugnissen aus einer beliebigen Zeile der Gruppe und
 * gehoeren womoeglich gar nicht zum juengsten Zeugnis.
 */
const LETZTES_FZ = `LEFT JOIN fz ON fz.fzID = (
    SELECT f2.fzID FROM fz f2 WHERE f2.personID = p.personID
     ORDER BY f2.fzVon DESC, f2.fzID DESC LIMIT 1)
  LEFT JOIN personen gv ON gv.personID = fz.gesehenVon`

/**
 * Aktuelle Kontaktdaten. Als Subselect statt JOIN, weil es pro Person mehrere
 * Adressen/Mails gibt und ein JOIN die Zeilen vervielfachen wuerde.
 */
const KONTAKT = `(SELECT e.eMail FROM eMails e
                   WHERE e.personID = p.personID AND e.isOld = 0
                   ORDER BY e.lastUsed DESC LIMIT 1) AS email,
                 (SELECT t.telefon FROM telefone t
                   WHERE t.personID = p.personID AND t.isOld = 0
                   ORDER BY t.lastUsed DESC LIMIT 1) AS telefon`

const ANTRAEGE = `(SELECT MIN(fa.erzeugt) FROM fzAntrag fa WHERE fa.personID = p.personID) AS ersterAntrag,
                  (SELECT MAX(fa.erzeugt) FROM fzAntrag fa WHERE fa.personID = p.personID) AS letzterAntrag,
                  (SELECT COUNT(*) FROM fzAntrag fa WHERE fa.personID = p.personID) AS anzahlAntraege`

const PERSON_FZ_SPALTEN = `p.personID, p.vorname, p.nachname, p.gebDat,
  p.fz_deactivate, p.fz_status,
  fz.fzVon, fz.gesehenAm, fz.kommentar,
  IF(fz.gesehenVon = 0 OR gv.personID IS NULL, '',
     CONCAT(gv.vorname, ' ', gv.nachname)) AS gesehenVon,
  ${ANTRAEGE},
  ${KONTAKT}`

interface PersonFzRow {
  personID: number
  vorname: string
  nachname: string
  gebDat: Date
  fz_deactivate: number
  fz_status: string
  fzVon: Date | null
  gesehenAm: Date | null
  kommentar: string | null
  gesehenVon: string
  ersterAntrag: Date | null
  letzterAntrag: Date | null
  anzahlAntraege: number
  email: string | null
  telefon: string | null
}

export interface PersonFz {
  personID: number
  vorname: string
  nachname: string
  gebDat: DateObj | null
  farbe: Ampel
  fzVon: DateObj | null
  gueltigBis: DateObj | null
  gesehenAm: DateObj | null
  gesehenVon: string
  kommentar: string
  ersterAntrag: DateObj | null
  letzterAntrag: DateObj | null
  anzahlAntraege: number
  email: string
  telefon: string
  fzDeaktiviert: boolean
  fzStatus: string
}

function formePerson(r: PersonFzRow): PersonFz {
  return {
    personID: r.personID,
    vorname: r.vorname,
    nachname: r.nachname,
    gebDat: dateObj(r.gebDat),
    farbe: ampel(r.fzVon, r.ersterAntrag),
    fzVon: dateObj(r.fzVon),
    gueltigBis: dateObj(gueltigBis(r.fzVon)),
    gesehenAm: dateObj(r.gesehenAm),
    gesehenVon: r.gesehenVon || '',
    kommentar: r.kommentar || '',
    ersterAntrag: dateObj(r.ersterAntrag),
    letzterAntrag: dateObj(r.letzterAntrag),
    anzahlAntraege: Number(r.anzahlAntraege) || 0,
    // Nie null: das Frontend zeigt die Felder direkt an, und "null" in einer
    // Tabellenzelle ist schlechter als eine leere Zelle.
    email: r.email || '',
    telefon: r.telefon || '',
    fzDeaktiviert: r.fz_deactivate === 1,
    fzStatus: r.fz_status || ''
  }
}

/* -------------------------------------------------------------------------- */
/* Kreis-Liste (Ortsverantwortliche)                                           */
/* -------------------------------------------------------------------------- */

export type KreisModus = 'ampel' | 'alle'

/**
 * Personen eines EC-Kreises.
 *
 * `ampel` bildet exakt die Auswahl der Monats-Mail ab (cron.php:18-36): nur
 * Personen, die aus dem Mahnlauf nicht ausgenommen sind und bei denen ueberhaupt
 * etwas passiert ist -- ein Zeugnis juenger als sechs Jahre oder ein Antrag
 * juenger als sechs Monate. Dass beide Ansichten dieselbe Menge zeigen, ist
 * wichtig: sonst kommt die Rueckfrage "warum steht der bei mir nicht drauf".
 *
 * `alle` nimmt jede Person des Kreises dazu, auch die ganz ohne FZ-Vorgang.
 */
export async function kreisListe(
  ecKreisID: number,
  modus: KreisModus
): Promise<{
  kreis: { ecKreisID: number; bezeichnung: string; needsFZ: boolean }
  modus: KreisModus
  stand: string
  personen: PersonFz[]
}> {
  const kreise = await queryP<{
    ecKreisID: number
    bezeichnung: string
    needsFZ: number
  }>(
    'SELECT ecKreisID, bezeichnung, needsFZ FROM ecKreis WHERE ecKreisID = ?',
    [ecKreisID]
  )
  if (kreise.length !== 1) throw notFound('EC-Kreis nicht gefunden.')

  const filter =
    modus === 'ampel'
      ? `AND p.fz_deactivate = 0
         AND (EXISTS (SELECT 1 FROM fz f WHERE f.personID = p.personID
                       AND f.fzVon > NOW() - INTERVAL 6 YEAR)
           OR EXISTS (SELECT 1 FROM fzAntrag fa WHERE fa.personID = p.personID
                       AND fa.erzeugt > NOW() - INTERVAL 6 MONTH))`
      : ''

  const rows = await queryP<PersonFzRow>(
    `SELECT ${PERSON_FZ_SPALTEN}
       FROM personen p
       ${LETZTES_FZ}
      WHERE p.ecKreis = ? AND p.anonymisiert = 0 ${filter}
      ORDER BY p.nachname, p.vorname`,
    [ecKreisID]
  )

  return {
    kreis: {
      ecKreisID: kreise[0].ecKreisID,
      bezeichnung: kreise[0].bezeichnung,
      needsFZ: kreise[0].needsFZ === 1
    },
    modus,
    stand: new Date().toISOString(),
    personen: rows.map(formePerson)
  }
}

/* -------------------------------------------------------------------------- */
/* Mitarbeitende einer Veranstaltung                                           */
/* -------------------------------------------------------------------------- */

export interface Mitarbeiter extends PersonFz {
  anmeldeID: string
  position: number
  positionText: string
  fzGueltigAmStichtag: boolean
}

/**
 * FZ-Stand des Teams einer Freizeit.
 *
 * `position > 1` schliesst Teilnehmende aus -- die sind Kinder und Jugendliche,
 * fuer die es kein Fuehrungszeugnis gibt und die hier nichts zu suchen haben.
 *
 * Die Ampel folgt derselben Regel wie in der Kreis-Liste (Stichtag heute),
 * zusaetzlich gibt es `fzGueltigAmStichtag`: fuer eine Freizeit zaehlt, ob das
 * Zeugnis am ENDE noch gueltig ist. Ein Zeugnis, das mitten in der Freizeit
 * ablaeuft, reicht nicht.
 */
export async function veranstaltungMitarbeiter(
  veranstaltungsID: number
): Promise<{
  veranstaltung: {
    veranstaltungsID: number
    bezeichnung: string
    kurzBezeichnung: string
    begin: DateObj | null
    ende: DateObj | null
  }
  mitarbeiter: Mitarbeiter[]
}> {
  const v = await ladeVeranstaltung(veranstaltungsID)

  const rows = await queryP<
    PersonFzRow & {
      anmeldeID: string
      position: number
      positionText: string
    }
  >(
    `SELECT ${PERSON_FZ_SPALTEN},
            a.anmeldeID, a.position,
            COALESCE(r.bezeichnung, '') AS positionText
       FROM anmeldungen a
       JOIN personen p ON p.personID = a.personID
       LEFT JOIN rollen r ON r.rollenID = a.position
       ${LETZTES_FZ}
      WHERE a.veranstaltungsID = ?
        AND a.position > 1
        AND a.abmeldeZeitpunkt IS NULL
        AND p.anonymisiert = 0
      ORDER BY a.position DESC, p.nachname, p.vorname`,
    [veranstaltungsID]
  )

  const mitarbeiter = rows.map((r) => ({
    ...formePerson(r),
    anmeldeID: r.anmeldeID,
    position: r.position,
    positionText: r.positionText,
    fzGueltigAmStichtag: fzGueltigAmStichtag(r.fzVon, v.ende, v.begin)
  }))

  // Wer kein gueltiges Zeugnis hat, steht oben -- das ist der Grund, warum ein
  // Leiter diese Liste ueberhaupt aufmacht.
  mitarbeiter.sort(
    (a, b) => Number(a.fzGueltigAmStichtag) - Number(b.fzGueltigAmStichtag)
  )

  return {
    veranstaltung: {
      veranstaltungsID: v.veranstaltungsID,
      bezeichnung: v.bezeichnung,
      kurzBezeichnung: v.kurzBezeichnung,
      begin: dateObj(v.begin),
      ende: dateObj(v.ende)
    },
    mitarbeiter
  }
}

interface VeranstaltungRow {
  veranstaltungsID: number
  bezeichnung: string
  kurzBezeichnung: string
  begin: Date
  ende: Date | null
  minTNAlter: number
  maxTNAlter: number
  anzahlPlaetze: number
  anzahlPlaetzeW: number
  anzahlPlaetzeM: number
  preisNormal: number
  preisLastMinute: number
  preisFruehbucher: number
  fruehbucherBis: Date | null
  lastMinuteAb: Date | null
  kannVorortBezahltWerden: number
  hatGWarteliste: number
  vOrtBezeichnung: string | null
  vOrtStrasse: string | null
  vOrtPlz: string | null
  vOrtOrt: string | null
  vOrtLand: string | null
}

async function ladeVeranstaltung(id: number): Promise<VeranstaltungRow> {
  const rows = await queryP<VeranstaltungRow>(
    `SELECT v.veranstaltungsID, v.bezeichnung, v.kurzBezeichnung,
            v.\`begin\` AS \`begin\`, v.ende,
            v.minTNAlter, v.maxTNAlter,
            v.\`anzahlPlätze\` AS anzahlPlaetze,
            v.\`anzahlPlätzeWeiblich\` AS anzahlPlaetzeW,
            v.\`anzahlPlätzeMännlich\` AS anzahlPlaetzeM,
            v.preisNormal, v.preisLastMinute, v.preisFruehbucher,
            v.fruehbucherBis, v.lastMinuteAb,
            v.kannVorortBezahltWerden, v.hatGWarteliste,
            o.bezeichnung AS vOrtBezeichnung, o.strasse AS vOrtStrasse,
            o.plz AS vOrtPlz, o.ort AS vOrtOrt, o.land AS vOrtLand
       FROM veranstaltungen v
       LEFT JOIN vOrte o ON o.vOrtID = v.veranstaltungsort
      WHERE v.veranstaltungsID = ?`,
    [id]
  )
  if (rows.length !== 1) throw notFound('Veranstaltung nicht gefunden.')
  return rows[0]
}

/* -------------------------------------------------------------------------- */
/* TN-Liste                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Der volle Datensatz einer Veranstaltung -- Grundlage der Web-Ansicht UND des
 * XLSX-Exports.
 *
 * Die Struktur bildet die GraphQL-Antwort von TN_LIST_QUERY nach, Feld fuer
 * Feld. Das ist kein Selbstzweck: die Platzhalter in den xlsx-Vorlagen sind
 * genau diese Pfade (`${begin.german}`, `${table:anmeldungen.person.nachname}`,
 * `${hauptleiter.person.vorname}`). Weicht ein Name ab, bleibt die Zelle leer,
 * ohne dass irgendwo ein Fehler auftaucht.
 *
 * Drei Fallen, die hier bewusst adressiert sind:
 *
 *  1. `hauptleiter` darf nie null sein. GraphQL liefert null, wenn niemand mit
 *     position 6 angemeldet ist; alle fuenf Vorlagen greifen aber auf
 *     `hauptleiter.person.vorname` zu und xlsx-template stuerzt darueber.
 *     Dasselbe gilt fuer adresse/telefon/email je Anmeldung -- deren IDs
 *     koennen ins Leere zeigen.
 *  2. Booleans muessen Booleans bleiben. In der DB sind es tinyints; roh
 *     durchgereicht stuende in der Excel "0" statt "false".
 *  3. Die Umlaut-Spalten (`anzahlPlätze` &c.) brauchen ein Alias.
 *
 * `felder='basis'` laesst die Gesundheits- und Bemerkungsfelder weg. Die
 * Web-Ansicht laedt damit keine Art.-9-Daten, solange niemand die Liste
 * tatsaechlich exportiert.
 */
export type TnFelder = 'basis' | 'voll'

/**
 * Zugriffsumfang der aufrufenden Person auf diese Veranstaltung.
 * 'kueche' liefert ausschliesslich die Felder der Kuechenliste.
 */
export type TnUmfang = 'voll' | 'kueche'

export async function tnListe(
  veranstaltungsID: number,
  felder: TnFelder,
  umfang: TnUmfang = 'voll'
): Promise<Record<string, unknown>> {
  const v = await ladeVeranstaltung(veranstaltungsID)

  const rows = await queryP<any>(
    `SELECT a.anmeldeID, a.position, a.wartelistenPlatz, a.anmeldeZeitpunkt,
            a.abmeldeZeitpunkt, a.extra_json,
            a.vegetarisch, a.radfahren, a.schwimmen, a.fahrgemeinschaften,
            a.klettern, a.sichEntfernen, a.bootFahren,
            a.bemerkungen, a.gesundheitsinformationen, a.lebensmittelAllergien,
            p.personID, p.vorname, p.nachname, p.geschlecht, p.gebDat,
            ad.strasse, ad.plz, ad.ort,
            t.telefon, e.eMail
       FROM anmeldungen a
       JOIN personen p ON p.personID = a.personID
       LEFT JOIN adressen ad ON ad.adressID = a.adressID
       LEFT JOIN telefone t ON t.telefonID = a.telefonID
       LEFT JOIN eMails  e ON e.eMailID   = a.eMailID
      WHERE a.veranstaltungsID = ? AND p.anonymisiert = 0
      ORDER BY a.anmeldeZeitpunkt`,
    [veranstaltungsID]
  )

  const voll = felder === 'voll'
  const nurKueche = umfang === 'kueche'

  /**
   * Die Kuechenliste braucht Namen, Geburtsdatum, Kontakt und alles zur
   * Ernaehrung -- dafuer ist sie da. Adressen, Aktivitaets-Freigaben,
   * Anmeldezeitpunkte und das Extra-JSON braucht sie nicht, also bekommt eine
   * Kuechenleitung sie auch nicht. Die Felder bleiben als leere Werte
   * erhalten, damit xlsx-template und die Web-Ansicht nicht ueber
   * undefined stolpern.
   */
  const anmeldungen = rows.map((r) => ({
    anmeldeID: nurKueche ? '' : r.anmeldeID,
    position: r.position,
    wartelistenPlatz: r.wartelistenPlatz,
    person: {
      personID: r.personID,
      vorname: r.vorname,
      nachname: r.nachname,
      geschlecht: nurKueche ? '' : r.geschlecht,
      gebDat: dateObj(r.gebDat)
    },
    adresse: nurKueche
      ? { strasse: '', plz: '', ort: '' }
      : {
          strasse: r.strasse ?? '',
          plz: r.plz ?? '',
          ort: r.ort ?? ''
        },
    telefon: { telefon: r.telefon ?? '' },
    email: { eMail: r.eMail ?? '' },
    bemerkungen: voll ? (r.bemerkungen ?? '') : '',
    gesundheitsinformationen: voll ? (r.gesundheitsinformationen ?? '') : '',
    lebensmittelAllergien: voll ? (r.lebensmittelAllergien ?? '') : '',
    vegetarisch: r.vegetarisch === 1,
    radfahren: nurKueche ? false : r.radfahren === 1,
    schwimmen: nurKueche ? 0 : Number(r.schwimmen) || 0,
    fahrgemeinschaften: nurKueche ? false : r.fahrgemeinschaften === 1,
    klettern: nurKueche ? false : r.klettern === 1,
    sichEntfernen: nurKueche ? false : r.sichEntfernen === 1,
    bootFahren: nurKueche ? false : r.bootFahren === 1,
    anmeldeZeitpunkt: nurKueche ? null : tsObj(r.anmeldeZeitpunkt),
    abmeldeZeitpunkt: nurKueche ? null : tsObj(r.abmeldeZeitpunkt),
    extra_json: nurKueche ? '{}' : (r.extra_json ?? '{}')
  }))

  const hl = rows.find((r) => r.position === 6)

  return {
    veranstaltungsID: v.veranstaltungsID,
    bezeichnung: v.bezeichnung,
    kurzBezeichnung: v.kurzBezeichnung,
    begin: dateObj(v.begin),
    ende: dateObj(v.ende),
    minTNAlter: v.minTNAlter,
    maxTNAlter: v.maxTNAlter,
    anzahlPlaetze: v.anzahlPlaetze,
    anzahlPlaetzeW: v.anzahlPlaetzeW,
    anzahlPlaetzeM: v.anzahlPlaetzeM,
    preisNormal: v.preisNormal,
    preisLastMinute: v.preisLastMinute,
    preisFruehbucher: v.preisFruehbucher,
    fruehbucherBis: dateObj(v.fruehbucherBis),
    lastMinuteAb: dateObj(v.lastMinuteAb),
    kannVorortBezahltWerden: v.kannVorortBezahltWerden === 1,
    hatGWarteliste: v.hatGWarteliste === 1,
    veranstaltungsort: {
      bezeichnung: v.vOrtBezeichnung ?? '',
      strasse: v.vOrtStrasse ?? '',
      plz: v.vOrtPlz ?? '',
      ort: v.vOrtOrt ?? '',
      land: v.vOrtLand ?? ''
    },
    // Immer ein Objekt, nie null -- siehe Falle 1 im Kommentar oben.
    hauptleiter: {
      person: {
        personID: hl?.personID ?? 0,
        vorname: hl?.vorname ?? '',
        nachname: hl?.nachname ?? ''
      }
    },
    anmeldungen
  }
}

/* -------------------------------------------------------------------------- */
/* Zaehler fuer die Startseite                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Wie viele Personen stehen auf gelb oder rot? Ein Aggregat pro Kreis bzw.
 * Veranstaltung, damit /home ohne Nachladen sagen kann, wo etwas zu tun ist.
 *
 * Die Farbe wird bewusst in JS berechnet (dieselbe Funktion wie in den Listen)
 * statt als zweite SQL-Fassung -- eine abweichende Zaehlung auf der Startseite
 * waere schlimmer als gar keine.
 */
export async function offeneImKreis(ecKreisID: number): Promise<number> {
  const rows = await queryP<{ fzVon: Date | null; ersterAntrag: Date | null }>(
    `SELECT fz.fzVon,
            (SELECT MIN(fa.erzeugt) FROM fzAntrag fa WHERE fa.personID = p.personID) AS ersterAntrag
       FROM personen p
       ${LETZTES_FZ}
      WHERE p.ecKreis = ? AND p.anonymisiert = 0 AND p.fz_deactivate = 0
        AND (EXISTS (SELECT 1 FROM fz f WHERE f.personID = p.personID
                      AND f.fzVon > NOW() - INTERVAL 6 YEAR)
          OR EXISTS (SELECT 1 FROM fzAntrag fa WHERE fa.personID = p.personID
                      AND fa.erzeugt > NOW() - INTERVAL 6 MONTH))`,
    [ecKreisID]
  )
  return rows.filter((r) => ampel(r.fzVon, r.ersterAntrag) !== 'green').length
}

export async function offeneInVeranstaltung(
  veranstaltungsID: number,
  begin: Date,
  ende: Date | null
): Promise<{ mitarbeiter: number; fzOffen: number }> {
  const rows = await queryP<{ fzVon: Date | null }>(
    `SELECT fz.fzVon
       FROM anmeldungen a
       JOIN personen p ON p.personID = a.personID
       ${LETZTES_FZ}
      WHERE a.veranstaltungsID = ? AND a.position > 1
        AND a.abmeldeZeitpunkt IS NULL AND p.anonymisiert = 0`,
    [veranstaltungsID]
  )
  return {
    mitarbeiter: rows.length,
    fzOffen: rows.filter((r) => !fzGueltigAmStichtag(r.fzVon, ende, begin))
      .length
  }
}

/* -------------------------------------------------------------------------- */
/* Fuehrungszeugnis eintragen                                                  */
/* -------------------------------------------------------------------------- */

export interface FzEingabe {
  personID: number
  fzVon: Date
  gesehenAm: Date
  kommentar: string
}

/**
 * Prueft die Eingaben einer FZ-Meldung.
 *
 * Die Daten landen unveraendert in `fz` und entscheiden darueber, ob jemand
 * mitarbeiten darf -- deshalb hier streng statt nachsichtig.
 */
export function pruefeFzEingabe(body: any): FzEingabe {
  const personID =
    Number.isInteger(body?.personID) && body.personID > 0 ? body.personID : null
  if (!personID) {
    throw badRequest('INVALID_INPUT', 'personID fehlt oder ist ungültig.')
  }

  const fzVon = parseDatum(body?.fzVon)
  const gesehenAm = parseDatum(body?.gesehenAm)
  if (!fzVon) {
    throw badRequest(
      'INVALID_INPUT',
      'Bitte das Ausstellungsdatum angeben (Format JJJJ-MM-TT).'
    )
  }
  if (!gesehenAm) {
    throw badRequest(
      'INVALID_INPUT',
      'Bitte angeben, wann du das Zeugnis gesehen hast.'
    )
  }

  const jetzt = heute()
  if (fzVon > jetzt) {
    throw badRequest(
      'INVALID_INPUT',
      'Das Ausstellungsdatum kann nicht in der Zukunft liegen.'
    )
  }
  if (gesehenAm > jetzt) {
    throw badRequest(
      'INVALID_INPUT',
      'Das Einsichtsdatum kann nicht in der Zukunft liegen.'
    )
  }
  if (gesehenAm < fzVon) {
    throw badRequest(
      'INVALID_INPUT',
      'Das Zeugnis kann nicht vor seiner Ausstellung eingesehen worden sein.'
    )
  }
  if (plusJahre(fzVon, FZ_GUELTIG_JAHRE) < jetzt) {
    throw badRequest(
      'FZ_ABGELAUFEN',
      'Dieses Zeugnis ist bereits älter als fünf Jahre und damit nicht mehr gültig.'
    )
  }

  const kommentar = String(body?.kommentar ?? '')
    .trim()
    .slice(0, 255)
  if (!kommentar) {
    throw badRequest('INVALID_INPUT', 'Bitte einen Kommentar angeben.')
  }

  return { personID, fzVon, gesehenAm, kommentar }
}

/**
 * Altersgrenze fuer einen FZ-Eintrag.
 *
 * Der scope-Check allein reicht hier nicht: er laesst einen Ortsverantwortlichen
 * fuer JEDE Person seines Kreises eintragen, und in einem EC-Kreis sind die
 * meisten Personen Kinder und Jugendliche. Fuer die Veranstaltungs-Seite faengt
 * `position > 1` das ab (Teilnehmende sind ausgeschlossen), fuer die Kreis-Seite
 * gibt es kein Gegenstueck -- ohne diese Pruefung liesse sich fuer ein
 * elfjaehriges Freizeitkind ein "Fuehrungszeugnis" eintragen.
 *
 * Die Grenze ist keine Ermessensfrage: ein erweitertes Fuehrungszeugnis wird
 * erst ab 14 ausgestellt (BZRG). Alles darunter kann es schlicht nicht geben und
 * ist immer ein Fehlgriff -- entweder die falsche Person ausgewaehlt oder ein
 * falsches Verstaendnis davon, wofuer die Liste da ist.
 */
async function pruefeAlter(personID: number, gesehenAm: Date): Promise<void> {
  const rows = await queryP<{ gebDat: Date | null }>(
    'SELECT gebDat FROM personen WHERE personID = ?',
    [personID]
  )
  if (rows.length !== 1) throw notFound('Person nicht gefunden.')

  const geb = rows[0].gebDat
  if (!geb) return

  if (plusJahre(new Date(geb), FZ_MINDESTALTER) > gesehenAm) {
    throw badRequest(
      'ZU_JUNG',
      `Für Personen unter ${FZ_MINDESTALTER} Jahren wird kein erweitertes Führungszeugnis ausgestellt.`
    )
  }
}

/**
 * Traegt ein eingesehenes Fuehrungszeugnis ein.
 *
 * Fachlich identisch zur Mutation `addFZ` (graphql.ts): Zeile in `fz`, offene
 * Antraege der Person loeschen. Dazu `ecKreis.lastFZUpdate` -- das macht
 * `addFZ` nicht, `addFZAntrag` schon, und ohne den Anstupser merkt die
 * Monats-Mail die Aenderung erst ueber den Pruefsummenvergleich.
 *
 * `personen.fz_status` wird bewusst NICHT gesetzt: das schreibt der PHP-Cron,
 * und zwei Schreiber auf demselben Feld erzeugen Races mit dessen Lauf.
 */
export async function addFz(
  eingabe: FzEingabe,
  gesehenVonPersonID: number
): Promise<{ fzID: number; warnung: string | null }> {
  await pruefeAlter(eingabe.personID, eingabe.gesehenAm)

  const doppelt = await queryP(
    'SELECT 1 FROM fz WHERE personID = ? AND fzVon = ? LIMIT 1',
    [eingabe.personID, isoDatum(eingabe.fzVon)]
  )
  if (doppelt.length > 0) {
    throw new PortalFehler(
      'FZ_EXISTS',
      'Für dieses Ausstellungsdatum ist bereits ein Zeugnis eingetragen.',
      409
    )
  }

  const fzID = await withConnection(async (conn) => {
    const res: any = await conn.query(
      `INSERT INTO fz (personID, gesehenAm, gesehenVon, kommentar, fzVon)
       VALUES (?, ?, ?, ?, ?)`,
      [
        eingabe.personID,
        isoDatum(eingabe.gesehenAm),
        gesehenVonPersonID,
        eingabe.kommentar,
        isoDatum(eingabe.fzVon)
      ]
    )
    await conn.query('DELETE FROM fzAntrag WHERE personID = ?', [
      eingabe.personID
    ])
    await conn.query(
      `UPDATE ecKreis SET lastFZUpdate = CURRENT_TIMESTAMP
        WHERE ecKreisID = (SELECT ecKreis FROM personen WHERE personID = ?)`,
      [eingabe.personID]
    )
    return res.insertId as number
  })

  // Das Anschreiben verlangt Vorlage binnen drei Monaten nach Ausstellung
  // (helpers/fz.ts). Erzwungen wird das nirgends im Bestand -- also melden,
  // nicht blockieren.
  const warnung =
    eingabe.gesehenAm > plusMonate(eingabe.fzVon, FZ_VORLAGE_FRIST_MONATE)
      ? 'Das Zeugnis war bei der Einsicht älter als drei Monate.'
      : null

  return { fzID, warnung }
}
