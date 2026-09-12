import { queryP, withConnection } from '../helpers/mysql'
import { badRequest, notFound, PortalFehler } from './error'
import { dateObj, isoDatum, parseDatum, type DateObj } from './date'

/**
 * Mitgliederliste eines EC-Kreises -- die Aufgabe der oder des
 * Ortsverantwortlichen.
 *
 * Anders als die Fuehrungszeugnis-Liste zeigt sie ausnahmslos alle Personen des
 * Kreises, unabhaengig davon, ob je ein Zeugnis im Spiel war.
 */

export interface MitgliedStatus {
  ecMitgliedStatusID: number
  bezeichnung: string
}

export function ladeStatusListe(): Promise<MitgliedStatus[]> {
  return queryP<MitgliedStatus>(
    'SELECT ecMitgliedStatusID, bezeichnung FROM ecMitgliedStatus ORDER BY ecMitgliedStatusID'
  )
}

export interface Mitglied {
  personID: number
  vorname: string
  nachname: string
  gebDat: DateObj | null
  geschlecht: string
  ecMitglied: number
  statusText: string
  email: string
  telefon: string
  adresse: string
}

export async function kreisMitglieder(ecKreisID: number): Promise<{
  kreis: { ecKreisID: number; bezeichnung: string }
  mitglieder: Mitglied[]
}> {
  const kreise = await queryP<{ ecKreisID: number; bezeichnung: string }>(
    'SELECT ecKreisID, bezeichnung FROM ecKreis WHERE ecKreisID = ?',
    [ecKreisID]
  )
  if (kreise.length !== 1) throw notFound('EC-Kreis nicht gefunden.')

  const rows = await queryP<any>(
    `SELECT p.personID, p.vorname, p.nachname, p.gebDat, p.geschlecht,
            p.ecMitglied,
            COALESCE(st.bezeichnung, '') AS statusText,
            (SELECT e.eMail FROM eMails e
              WHERE e.personID = p.personID AND e.isOld = 0
              ORDER BY e.lastUsed DESC LIMIT 1) AS email,
            (SELECT t.telefon FROM telefone t
              WHERE t.personID = p.personID AND t.isOld = 0
              ORDER BY t.lastUsed DESC LIMIT 1) AS telefon,
            (SELECT CONCAT(a.strasse, ', ', a.plz, ' ', a.ort) FROM adressen a
              WHERE a.personID = p.personID AND a.isOld = 0
              ORDER BY a.lastUsed DESC LIMIT 1) AS adresse
       FROM personen p
       LEFT JOIN ecMitgliedStatus st ON st.ecMitgliedStatusID = p.ecMitglied
      WHERE p.ecKreis = ? AND p.anonymisiert = 0
      ORDER BY p.nachname, p.vorname`,
    [ecKreisID]
  )

  return {
    kreis: kreise[0],
    mitglieder: rows.map((r) => ({
      personID: r.personID,
      vorname: r.vorname,
      nachname: r.nachname,
      gebDat: dateObj(r.gebDat),
      geschlecht: r.geschlecht,
      ecMitglied: r.ecMitglied,
      statusText: r.statusText || '',
      email: r.email || '',
      telefon: r.telefon || '',
      adresse: r.adresse || ''
    }))
  }
}

/** Mitgliedsstatus einer Person setzen. */
export async function setzeStatus(
  personID: number,
  ecKreisID: number,
  status: unknown
): Promise<void> {
  const wert = Number(status)
  const erlaubt = await ladeStatusListe()
  if (!erlaubt.some((s) => s.ecMitgliedStatusID === wert)) {
    throw badRequest('INVALID_INPUT', 'Unbekannter Mitgliedsstatus.')
  }

  // Die Person muss zu diesem Kreis gehören -- sonst könnte über eine fremde
  // personID der Status beliebiger Personen geändert werden.
  const r: any = await queryP(
    'UPDATE personen SET ecMitglied = ? WHERE personID = ? AND ecKreis = ? AND anonymisiert = 0',
    [wert, personID, ecKreisID]
  )
  if (!r || r.affectedRows === 0) {
    throw notFound('Diese Person gehört nicht zu deinem EC-Kreis.')
  }
}

/** Person aus dem Kreis nehmen. Die Person selbst bleibt bestehen. */
export async function entferneAusKreis(
  personID: number,
  ecKreisID: number
): Promise<void> {
  const r: any = await queryP(
    'UPDATE personen SET ecKreis = NULL WHERE personID = ? AND ecKreis = ? AND anonymisiert = 0',
    [personID, ecKreisID]
  )
  if (!r || r.affectedRows === 0) {
    throw notFound('Diese Person gehört nicht zu deinem EC-Kreis.')
  }
}

export interface NeuePersonEingabe {
  vorname: string
  nachname: string
  gebDat: Date
  geschlecht: 'm' | 'w'
  ecMitglied: number
  email: string
  telefon: string
  strasse: string
  plz: string
  ort: string
}

export function pruefeNeuePerson(body: any): NeuePersonEingabe {
  const text = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : ''

  const vorname = text(body?.vorname, 50)
  const nachname = text(body?.nachname, 50)
  if (!vorname || !nachname) {
    throw badRequest('INVALID_INPUT', 'Vor- und Nachname werden gebraucht.')
  }

  const gebDat = parseDatum(body?.gebDat)
  if (!gebDat) {
    throw badRequest(
      'INVALID_INPUT',
      'Bitte ein Geburtsdatum angeben (JJJJ-MM-TT).'
    )
  }
  if (gebDat > new Date()) {
    throw badRequest('INVALID_INPUT', 'Das Geburtsdatum liegt in der Zukunft.')
  }

  const geschlecht =
    body?.geschlecht === 'w' ? 'w' : body?.geschlecht === 'm' ? 'm' : null
  if (!geschlecht) {
    throw badRequest('INVALID_INPUT', 'Bitte das Geschlecht angeben.')
  }

  const email = text(body?.email, 50)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest(
      'INVALID_INPUT',
      'Die E-Mail-Adresse sieht nicht richtig aus.'
    )
  }

  const plz = text(body?.plz, 5)
  if (plz && !/^\d{5}$/.test(plz)) {
    throw badRequest(
      'INVALID_INPUT',
      'Die Postleitzahl muss fünf Ziffern haben.'
    )
  }

  return {
    vorname,
    nachname,
    gebDat,
    geschlecht,
    ecMitglied: Number(body?.ecMitglied) || 1,
    email,
    telefon: text(body?.telefon, 50),
    strasse: text(body?.strasse, 50),
    plz,
    ort: text(body?.ort, 50)
  }
}

export interface AnlageErgebnis {
  personID: number
  /** neu angelegt, aus dem Bestand übernommen, oder aus einem anderen Kreis geholt */
  art: 'neu' | 'uebernommen' | 'umgezogen'
  vorherigerKreis: { ecKreisID: number; bezeichnung: string } | null
}

/**
 * Person anlegen oder aus dem Bestand übernehmen.
 *
 * Dieselbe Reihenfolge wie die Anmeldung auf der Website (graphql.ts,
 * Mutation `anmelden`), und aus demselben Grund: `personen` hat ein UNIQUE auf
 * (vorname, nachname, gebDat), ein blindes INSERT würde bei jeder bereits
 * bekannten Person scheitern. Also:
 *
 *  1. Exakt auf Vorname, Nachname und Geburtsdatum suchen.
 *  2. Sonst in `dublikate` nachschlagen -- dort stehen Schreibvarianten, die
 *     die Geschäftsstelle bereits einer Person zugeordnet hat. So landet
 *     "Müller"/"Mueller" nicht zweimal im Bestand.
 *  3. Erst wenn beides leer bleibt, eine neue Person anlegen.
 *
 * Kontaktdaten werden wie dort per get-or-create ergänzt: vorhandene bleiben,
 * neue kommen dazu. Nichts wird überschrieben -- der Ortsverantwortliche soll
 * ergänzen können, ohne bestehende Angaben zu zerstören.
 */
export async function personAnlegenOderUebernehmen(
  eingabe: NeuePersonEingabe,
  ecKreisID: number
): Promise<AnlageErgebnis> {
  const geb = isoDatum(eingabe.gebDat)

  return withConnection(async (conn) => {
    let art: AnlageErgebnis['art'] = 'uebernommen'
    let personID: number | null = null
    let vorherigerKreis: AnlageErgebnis['vorherigerKreis'] = null

    const treffer = await conn.query(
      'SELECT personID, ecKreis, anonymisiert FROM personen WHERE vorname = ? AND nachname = ? AND gebDat = ?',
      [eingabe.vorname, eingabe.nachname, geb]
    )

    if (treffer.length > 0) {
      personID = treffer[0].personID
      if (treffer[0].anonymisiert === 1) {
        throw new PortalFehler(
          'ANONYMISIERT',
          'Zu diesen Angaben gibt es einen gelöschten Datensatz. Bitte wende dich an die Geschäftsstelle.',
          409
        )
      }
      if (treffer[0].ecKreis && treffer[0].ecKreis !== ecKreisID) {
        art = 'umgezogen'
        const alt = await conn.query(
          'SELECT ecKreisID, bezeichnung FROM ecKreis WHERE ecKreisID = ?',
          [treffer[0].ecKreis]
        )
        vorherigerKreis = alt[0] ?? null
      }
    } else {
      const dubs = await conn.query(
        'SELECT zielPersonID FROM dublikate WHERE vorname = ? AND nachname = ? AND gebDat = ?',
        [eingabe.vorname, eingabe.nachname, geb]
      )
      if (dubs.length > 0) {
        personID = dubs[0].zielPersonID
        const p = await conn.query(
          'SELECT ecKreis FROM personen WHERE personID = ?',
          [personID]
        )
        if (p.length > 0 && p[0].ecKreis && p[0].ecKreis !== ecKreisID) {
          art = 'umgezogen'
          const alt = await conn.query(
            'SELECT ecKreisID, bezeichnung FROM ecKreis WHERE ecKreisID = ?',
            [p[0].ecKreis]
          )
          vorherigerKreis = alt[0] ?? null
        }
      } else {
        const res: any = await conn.query(
          `INSERT INTO personen (vorname, nachname, gebDat, geschlecht, ecKreis, ecMitglied)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            eingabe.vorname,
            eingabe.nachname,
            geb,
            eingabe.geschlecht,
            ecKreisID,
            eingabe.ecMitglied
          ]
        )
        personID = res.insertId
        art = 'neu'
      }
    }

    if (!personID) throw notFound('Person konnte nicht angelegt werden.')

    if (art !== 'neu') {
      await conn.query(
        'UPDATE personen SET ecKreis = ?, ecMitglied = ? WHERE personID = ?',
        [ecKreisID, eingabe.ecMitglied, personID]
      )
    }

    // Kontaktdaten ergänzen, vorhandene unberührt lassen.
    if (eingabe.email) {
      const da = await conn.query(
        'SELECT eMailID FROM eMails WHERE personID = ? AND eMail = ?',
        [personID, eingabe.email]
      )
      if (da.length === 0) {
        await conn.query('INSERT INTO eMails (eMail, personID) VALUES (?, ?)', [
          eingabe.email,
          personID
        ])
      }
    }
    if (eingabe.telefon) {
      const da = await conn.query(
        'SELECT telefonID FROM telefone WHERE personID = ? AND telefon = ?',
        [personID, eingabe.telefon]
      )
      if (da.length === 0) {
        await conn.query(
          'INSERT INTO telefone (telefon, personID) VALUES (?, ?)',
          [eingabe.telefon, personID]
        )
      }
    }
    if (eingabe.strasse && eingabe.plz && eingabe.ort) {
      const da = await conn.query(
        'SELECT adressID FROM adressen WHERE personID = ? AND strasse = ? AND plz = ? AND ort = ?',
        [personID, eingabe.strasse, eingabe.plz, eingabe.ort]
      )
      if (da.length === 0) {
        await conn.query(
          'INSERT INTO adressen (personID, strasse, plz, ort) VALUES (?, ?, ?, ?)',
          [personID, eingabe.strasse, eingabe.plz, eingabe.ort]
        )
      }
    }

    return { personID, art, vorherigerKreis }
  })
}
