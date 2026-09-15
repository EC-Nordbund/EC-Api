import { queryP } from '../helpers/mysql'
import { dateObj } from '../portal/date'
import type { AntragStatus, Zeitraum } from './config'

/**
 * Was ist wann reserviert.
 *
 * Zwei inklusive Tagesintervalle ueberschneiden sich, wenn
 *   a.von <= bis AND a.bis >= von.
 * Alle Vergleiche laufen in SQL auf DATE-Spalten mit YYYY-MM-DD-Parametern --
 * MySQL laeuft in UTC, Node in Ortszeit, und ein Date-Objekt aus dem Treiber
 * laege im Sommer zwei Stunden daneben.
 *
 * Bewusst konservativ: alles, was das Fenster beruehrt, wird addiert -- auch
 * zwei Reservierungen, die sich untereinander nicht ueberschneiden. Fuer den
 * Antragsteller reicht "frei / angefragt / reserviert"; der Materialwart
 * bekommt im Antrag die einzelnen Ueberschneidungen und im Belegungsplan die
 * Einzelreservierungen und entscheidet selbst (Vorrang fuer Nordbund-
 * Veranstaltungen ist seine Sache, nicht die des Systems).
 */

export interface Reservierung {
  reserviert: number
  angefragt: number
}

/**
 * Reservierte (genehmigt) und angefragte (offen) Menge je Material im
 * Fenster. `ausser` nimmt einen Antrag heraus -- fuer die Konfliktsicht auf
 * einen Antrag zaehlt der selbst nicht mit.
 */
export async function verfuegbarkeit(
  materialIDs: number[] | null,
  zeitraum: Zeitraum,
  ausserAntragID?: number
): Promise<Map<number, Reservierung>> {
  const params: unknown[] = [zeitraum.bis, zeitraum.von]
  let filter = ''
  if (ausserAntragID) {
    filter += ' AND a.materialAntragID <> ?'
    params.push(ausserAntragID)
  }
  if (materialIDs) {
    if (!materialIDs.length) return new Map()
    filter += ` AND p.materialID IN (${materialIDs.map(() => '?').join(',')})`
    params.push(...materialIDs)
  }
  const rows = await queryP<{
    materialID: number
    reserviert: number | string
    angefragt: number | string
  }>(
    `SELECT p.materialID,
            SUM(CASE WHEN a.status = 'genehmigt' THEN COALESCE(p.mengeGenehmigt, 0) ELSE 0 END) AS reserviert,
            SUM(CASE WHEN a.status = 'offen' THEN p.menge ELSE 0 END) AS angefragt
       FROM materialAntragPosition p
       JOIN materialAntrag a ON a.materialAntragID = p.materialAntragID
      WHERE a.status IN ('offen','genehmigt')
        AND a.von <= ? AND a.bis >= ?${filter}
      GROUP BY p.materialID`,
    params
  )
  const je = new Map<number, Reservierung>()
  for (const r of rows) {
    je.set(r.materialID, {
      reserviert: Number(r.reserviert) || 0,
      angefragt: Number(r.angefragt) || 0
    })
  }
  return je
}

export interface Konflikt {
  materialID: number
  materialAntragID: number
  status: AntragStatus
  von: string
  bis: string
  vonObj: ReturnType<typeof dateObj>
  bisObj: ReturnType<typeof dateObj>
  menge: number
  anlass: string
  antragsteller: string
}

/**
 * Fuer den Materialwart: alle anderen Antraege (offen oder genehmigt), die
 * sich mit diesem Antrag in Zeitraum UND Material ueberschneiden -- je
 * Position eine Liste. `menge` ist bei genehmigten Antraegen die genehmigte,
 * bei offenen die beantragte Menge.
 */
export async function konflikteFuerAntrag(
  materialAntragID: number
): Promise<Map<number, Konflikt[]>> {
  const rows = await queryP<any>(
    `SELECT p.materialID, a.materialAntragID, a.status,
            DATE_FORMAT(a.von, '%Y-%m-%d') AS von,
            DATE_FORMAT(a.bis, '%Y-%m-%d') AS bis,
            CASE WHEN a.status = 'genehmigt' THEN COALESCE(p.mengeGenehmigt, 0) ELSE p.menge END AS menge,
            a.anlass, CONCAT(pe.vorname, ' ', pe.nachname) AS antragsteller
       FROM materialAntrag me
       JOIN materialAntragPosition mp ON mp.materialAntragID = me.materialAntragID
       JOIN materialAntragPosition p ON p.materialID = mp.materialID
       JOIN materialAntrag a ON a.materialAntragID = p.materialAntragID
       JOIN portalUser pu ON pu.portalUserID = a.portalUserID
       JOIN personen pe ON pe.personID = pu.personID
      WHERE me.materialAntragID = ?
        AND a.materialAntragID <> me.materialAntragID
        AND a.status IN ('offen','genehmigt')
        AND a.von <= me.bis AND a.bis >= me.von
      ORDER BY p.materialID, a.von`,
    [materialAntragID]
  )
  const je = new Map<number, Konflikt[]>()
  for (const r of rows) {
    const menge = Number(r.menge) || 0
    if (menge === 0) continue
    const liste = je.get(r.materialID) ?? []
    liste.push({
      materialID: r.materialID,
      materialAntragID: r.materialAntragID,
      status: r.status,
      von: r.von,
      bis: r.bis,
      vonObj: dateObj(r.von),
      bisObj: dateObj(r.bis),
      menge,
      anlass: r.anlass,
      antragsteller: r.antragsteller
    })
    je.set(r.materialID, liste)
  }
  return je
}

export interface BelegungMaterial {
  materialID: number
  name: string
  bereich: string
  kategorie: string | null
  bestand: number
  aktiv: boolean
  freigegeben: boolean
  /** Hoechste gleichzeitig genehmigte Menge an einem Tag des Fensters. */
  maxBelegt: number
  ueberbucht: boolean
  reservierungen: Array<{
    materialAntragID: number
    status: AntragStatus
    von: string
    bis: string
    vonObj: ReturnType<typeof dateObj>
    bisObj: ReturnType<typeof dateObj>
    menge: number
    anlass: string
    antragsteller: string
  }>
}

/**
 * Belegungsplan: je Material die Einzelreservierungen (offen und genehmigt)
 * im Fenster. Materialien mit Reservierungen zuerst, der Rest darunter --
 * so sieht der Materialwart auch, was gar nicht nachgefragt wird.
 *
 * `maxBelegt` ist die echte Spitze: per Sweep ueber Start-/Endtage der
 * genehmigten Reservierungen, nicht die konservative Summe.
 */
export async function belegung(
  zeitraum: Zeitraum
): Promise<BelegungMaterial[]> {
  const material = await queryP<any>(
    `SELECT m.materialID, m.name, m.bereich, m.bestand, m.aktiv, m.freigegeben,
            k.bezeichnung AS kategorie
       FROM material m
       LEFT JOIN materialKategorie k ON k.materialKategorieID = m.materialKategorieID
      ORDER BY k.sortierung, k.bezeichnung, m.name`
  )
  const rows = await queryP<any>(
    `SELECT p.materialID, a.materialAntragID, a.status,
            DATE_FORMAT(a.von, '%Y-%m-%d') AS von,
            DATE_FORMAT(a.bis, '%Y-%m-%d') AS bis,
            CASE WHEN a.status = 'genehmigt' THEN COALESCE(p.mengeGenehmigt, 0) ELSE p.menge END AS menge,
            a.anlass, CONCAT(pe.vorname, ' ', pe.nachname) AS antragsteller
       FROM materialAntragPosition p
       JOIN materialAntrag a ON a.materialAntragID = p.materialAntragID
       JOIN portalUser pu ON pu.portalUserID = a.portalUserID
       JOIN personen pe ON pe.personID = pu.personID
      WHERE a.status IN ('offen','genehmigt')
        AND a.von <= ? AND a.bis >= ?
      ORDER BY p.materialID, a.von, a.materialAntragID`,
    [zeitraum.bis, zeitraum.von]
  )

  const je = new Map<number, BelegungMaterial['reservierungen']>()
  for (const r of rows) {
    const menge = Number(r.menge) || 0
    if (menge === 0) continue
    const liste = je.get(r.materialID) ?? []
    liste.push({
      materialAntragID: r.materialAntragID,
      status: r.status,
      von: r.von,
      bis: r.bis,
      vonObj: dateObj(r.von),
      bisObj: dateObj(r.bis),
      menge,
      anlass: r.anlass,
      antragsteller: r.antragsteller
    })
    je.set(r.materialID, liste)
  }

  const ergebnis: BelegungMaterial[] = material.map((m: any) => {
    const reservierungen = je.get(m.materialID) ?? []
    return {
      materialID: m.materialID,
      name: m.name,
      bereich: m.bereich,
      kategorie: m.kategorie ?? null,
      bestand: m.bestand,
      aktiv: m.aktiv === 1,
      freigegeben: m.freigegeben === 1,
      maxBelegt: spitze(reservierungen),
      ueberbucht: spitze(reservierungen) > m.bestand,
      reservierungen
    }
  })
  return ergebnis.sort(
    (a, b) =>
      Number(b.reservierungen.length > 0) - Number(a.reservierungen.length > 0)
  )
}

/** Hoechste Summe gleichzeitig genehmigter Mengen (Sweep ueber die Tage). */
function spitze(reservierungen: BelegungMaterial['reservierungen']): number {
  const ereignisse: Array<[string, number]> = []
  for (const r of reservierungen) {
    if (r.status !== 'genehmigt') continue
    ereignisse.push([r.von, r.menge])
    // Ende inklusiv: der Abgang zaehlt erst am Folgetag. Als String-Vergleich
    // reicht es, das Ende NACH allen Anfaengen desselben Tages einzusortieren.
    ereignisse.push([r.bis + '~', -r.menge])
  }
  ereignisse.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let laufend = 0
  let max = 0
  for (const [, delta] of ereignisse) {
    laufend += delta
    if (laufend > max) max = laufend
  }
  return max
}
