import { queryP, withConnection } from '../helpers/mysql'
import { notFound } from './error'
import { dateObj, type DateObj } from './date'
import {
  ergaenzeKontakt,
  findePerson,
  legePersonAn,
  type NeuePersonEingabe
} from './mitglieder'

/**
 * Mitarbeit in EC-Kreisen (Tabelle ecKreisMitarbeit, sql/kreis-mitarbeit.sql).
 *
 * Getrennt von der Mitgliedschaft (personen.ecKreis, siehe mitglieder.ts):
 * Mitglied ist man in genau einem Kreis, mitarbeiten kann man in beliebig
 * vielen -- und das Fuehrungszeugnis wird dort vorgezeigt, wo man mitarbeitet.
 * Diese Tabelle entscheidet deshalb, wer in der FZ-Liste der FZ-Verantwortlichen
 * steht, fuer wen sie ein Zeugnis eintragen darf und wer in der Monats-Excel
 * des FZ-Systems (cron.php) auftaucht.
 *
 * Gepflegt wird sie von der FZ-Verantwortlichen im Portal, von der Verwaltung
 * (api/portal-account.ts) und durch die QR-Anmeldung (graphql.ts, `anmelden`).
 * Keine Historie: Entfernen ist ein DELETE.
 */

export type MitarbeitQuelle = 'portal' | 'qr' | 'verwaltung' | 'migration'

export interface MitarbeitKreis {
  ecKreisID: number
  bezeichnung: string
  seit: DateObj | null
  erzeugtDurch: string
}

/** Alle Kreise, in denen eine Person mitarbeitet (Verwaltung, Sonstiges-Tab). */
export function mitarbeitKreise(personID: number): Promise<MitarbeitKreis[]> {
  return queryP<any>(
    `SELECT m.ecKreisID, k.bezeichnung, m.seit, m.erzeugt_durch
       FROM ecKreisMitarbeit m
       JOIN ecKreis k ON k.ecKreisID = m.ecKreisID
      WHERE m.personID = ?
      ORDER BY k.bezeichnung`,
    [personID]
  ).then((rows) =>
    rows.map((r) => ({
      ecKreisID: r.ecKreisID,
      bezeichnung: r.bezeichnung,
      seit: dateObj(r.seit),
      erzeugtDurch: r.erzeugt_durch
    }))
  )
}

/**
 * Person als mitarbeitend eintragen. Idempotent: war sie schon eingetragen,
 * passiert nichts und es kommt `false` zurueck.
 */
export async function fuegeMitarbeitHinzu(
  personID: number,
  ecKreisID: number,
  quelle: MitarbeitQuelle
): Promise<boolean> {
  const kreis = await queryP(
    'SELECT 1 FROM ecKreis WHERE ecKreisID = ? LIMIT 1',
    [ecKreisID]
  )
  if (kreis.length === 0) throw notFound('EC-Kreis nicht gefunden.')
  const person = await queryP(
    'SELECT 1 FROM personen WHERE personID = ? AND anonymisiert = 0 LIMIT 1',
    [personID]
  )
  if (person.length === 0) throw notFound('Person nicht gefunden.')

  const r: any = await queryP(
    'INSERT IGNORE INTO ecKreisMitarbeit (personID, ecKreisID, erzeugt_durch) VALUES (?, ?, ?)',
    [personID, ecKreisID, quelle]
  )
  return Number(r?.affectedRows ?? 0) > 0
}

/** Aus der Mitarbeiterliste nehmen. Person und Mitgliedschaft bleiben. */
export async function entferneMitarbeit(
  personID: number,
  ecKreisID: number
): Promise<void> {
  const r: any = await queryP(
    'DELETE FROM ecKreisMitarbeit WHERE personID = ? AND ecKreisID = ?',
    [personID, ecKreisID]
  )
  if (!r || r.affectedRows === 0) {
    throw notFound(
      'Diese Person ist in deinem EC-Kreis nicht als mitarbeitend eingetragen.'
    )
  }
}

export interface MitarbeitAnlageErgebnis {
  personID: number
  /** neu angelegt, aus dem Bestand uebernommen, oder war schon eingetragen */
  art: 'neu' | 'uebernommen' | 'bereits'
}

/**
 * "+ Mitarbeiter/in" im Portal: Person aus dem Bestand holen oder anlegen und
 * als mitarbeitend eintragen.
 *
 * Bewusst KEIN Umzug: die Mitgliedschaft der Person -- wo auch immer -- bleibt
 * unangetastet, und eine neu angelegte Person wird nirgends Mitglied
 * (ecKreis NULL, Status "kein Mitglied"). Deshalb gibt es hier auch keine
 * Kreiswechsel-Mail an die Geschaeftsstelle; der Vorgang landet nur im Audit.
 */
export async function mitarbeiterAnlegenOderUebernehmen(
  eingabe: NeuePersonEingabe,
  ecKreisID: number
): Promise<MitarbeitAnlageErgebnis> {
  const kreis = await queryP(
    'SELECT 1 FROM ecKreis WHERE ecKreisID = ? LIMIT 1',
    [ecKreisID]
  )
  if (kreis.length === 0) throw notFound('EC-Kreis nicht gefunden.')

  return withConnection(async (conn) => {
    let art: MitarbeitAnlageErgebnis['art']
    let personID: number

    const bekannt = await findePerson(conn, eingabe)
    if (bekannt) {
      personID = bekannt.personID
      const r: any = await conn.query(
        'INSERT IGNORE INTO ecKreisMitarbeit (personID, ecKreisID, erzeugt_durch) VALUES (?, ?, ?)',
        [personID, ecKreisID, 'portal']
      )
      art = Number(r?.affectedRows ?? 0) > 0 ? 'uebernommen' : 'bereits'
    } else {
      personID = await legePersonAn(conn, eingabe, null)
      await conn.query(
        'INSERT INTO ecKreisMitarbeit (personID, ecKreisID, erzeugt_durch) VALUES (?, ?, ?)',
        [personID, ecKreisID, 'portal']
      )
      art = 'neu'
    }

    await ergaenzeKontakt(conn, personID, eingabe)

    return { personID, art }
  })
}
