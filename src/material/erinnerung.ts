import { queryP } from '../helpers/mysql'
import { ladeAntrag } from './antrag'
import {
  ERINNERUNG_OFFEN_TAGE,
  ERINNERUNG_OFFEN_VORLAUF_TAGE,
  ERINNERUNG_RUECKGABE_TAGE,
  schemaVorhanden
} from './config'
import { sendeErinnerungOffen, sendeErinnerungRueckgabe } from './mail'

/**
 * Taegliche Erinnerungen der Materialverwaltung.
 *
 *  - Rueckgabe ueberfaellig: genehmigt, `bis` liegt ERINNERUNG_RUECKGABE_TAGE
 *    zurueck, nicht alle Positionen zurueck -> Antragsteller UND Materialwarte.
 *  - Antrag unbearbeitet: offen, aelter als ERINNERUNG_OFFEN_TAGE oder der
 *    Ausleihbeginn ist naeher als ERINNERUNG_OFFEN_VORLAUF_TAGE -> Materialwarte.
 *
 * Idempotenz ueber `erinnert_am` (je Antrag und Zustand hoechstens einmal;
 * ein Statuswechsel setzt die Spalte zurueck). Gleiches Job-Muster wie
 * schutzkonzept/erinnerung.ts: stuendlich nachsehen, je Kalendertag einmal
 * laufen, nicht vor sechs Uhr, Timer mit unref.
 */

export interface LaufErgebnis {
  rueckgabe: number
  unbearbeitet: number
  fehler: number
}

export async function erinnerungenVerschicken(): Promise<LaufErgebnis> {
  const r: LaufErgebnis = { rueckgabe: 0, unbearbeitet: 0, fehler: 0 }

  const ueberfaellig = await queryP<{ materialAntragID: number }>(
    `SELECT a.materialAntragID FROM materialAntrag a
      WHERE a.status = 'genehmigt' AND a.erinnert_am IS NULL
        AND a.bis < CURDATE() - INTERVAL ? DAY
        AND EXISTS (SELECT 1 FROM materialAntragPosition p
                     WHERE p.materialAntragID = a.materialAntragID
                       AND COALESCE(p.mengeGenehmigt, 0) > 0 AND p.zurueck = 0)`,
    [ERINNERUNG_RUECKGABE_TAGE]
  )
  for (const { materialAntragID } of ueberfaellig) {
    try {
      // Erst markieren, dann verschicken: die Erinnerung geht an zwei
      // Empfaengerkreise. Bliebe der zweite Versand haengen, kaeme sonst der
      // erste am naechsten Tag noch einmal. Lieber eine Erinnerung zu wenig
      // als taeglich dieselbe.
      const a = await ladeAntrag(materialAntragID)
      await markiere(materialAntragID)
      await sendeErinnerungRueckgabe(a)
      r.rueckgabe++
    } catch (err) {
      r.fehler++
      console.error(
        '[material] Rueckgabe-Erinnerung fehlgeschlagen:',
        materialAntragID,
        err
      )
    }
  }

  const offen = await queryP<{ materialAntragID: number }>(
    `SELECT a.materialAntragID FROM materialAntrag a
      WHERE a.status = 'offen' AND a.erinnert_am IS NULL
        AND (a.erstellt < NOW() - INTERVAL ? DAY OR a.von < CURDATE() + INTERVAL ? DAY)`,
    [ERINNERUNG_OFFEN_TAGE, ERINNERUNG_OFFEN_VORLAUF_TAGE]
  )
  for (const { materialAntragID } of offen) {
    try {
      const a = await ladeAntrag(materialAntragID)
      await markiere(materialAntragID)
      await sendeErinnerungOffen(a)
      r.unbearbeitet++
    } catch (err) {
      r.fehler++
      console.error(
        '[material] Erinnerung unbearbeitet fehlgeschlagen:',
        materialAntragID,
        err
      )
    }
  }
  return r
}

async function markiere(materialAntragID: number): Promise<void> {
  await queryP(
    'UPDATE materialAntrag SET erinnert_am = NOW() WHERE materialAntragID = ?',
    [materialAntragID]
  )
}

/* ------------------------------------------------------------- Der Job -- */

const INTERVALL_MS = 60 * 60 * 1000
const ERSTER_LAUF_MS = 3 * 60 * 1000
const FRUEHESTE_STUNDE = 6

function stundeBerlin(jetzt: Date = new Date()): number {
  const teile = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(jetzt)
  return Number(teile.find((p) => p.type === 'hour')?.value ?? 0)
}

function heuteBerlin(jetzt: Date = new Date()): string {
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(jetzt)
  const t = (typ: string) => teile.find((p) => p.type === typ)?.value ?? ''
  return `${t('year')}-${t('month')}-${t('day')}`
}

export function starteMaterialErinnerungsJob(): void {
  let zuletzt = ''
  const tick = async () => {
    const heute = heuteBerlin()
    if (heute === zuletzt || stundeBerlin() < FRUEHESTE_STUNDE) return
    if (!(await schemaVorhanden())) return
    zuletzt = heute
    const r = await erinnerungenVerschicken()
    if (r.rueckgabe || r.unbearbeitet || r.fehler) {
      console.log(
        `[material] Erinnerungslauf ${heute}: ${r.rueckgabe} Rueckgabe, ${r.unbearbeitet} unbearbeitet, ${r.fehler} Fehler`
      )
    }
    if (r.fehler) zuletzt = ''
  }
  const sicher = () =>
    tick().catch((err) => {
      zuletzt = ''
      console.error('[material] Erinnerungslauf fehlgeschlagen:', err)
    })
  setTimeout(sicher, ERSTER_LAUF_MS).unref()
  setInterval(sicher, INTERVALL_MS).unref()
}
