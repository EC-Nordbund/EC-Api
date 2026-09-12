import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { notFound } from './error'

/**
 * Ausliefern der TN-Listen-Vorlagen.
 *
 * Die fuenf xlsx liegen bisher in EC-Verwaltung/public/templates und werden
 * dort clientseitig gefuellt. Wuerde das Portal sie kopieren, gaebe es
 * dieselben fuenf Binaerdateien in zwei Repos -- nicht diffbar, nicht testbar,
 * und die zweite Kopie veraltet unbemerkt beim ersten Layoutwechsel. Deshalb
 * liegen sie jetzt hier und werden ausgeliefert; das Rendern bleibt im Client
 * (xlsx-template), wo es erprobt ist.
 *
 * Naechster Schritt waere, auch EC-Verwaltung auf diese Quelle umzustellen --
 * dann existieren die Vorlagen genau einmal. Gehoert nicht in dieses Modul.
 */
const ORDNER = resolve('./templates')

/** Nur genau diese Namen, keine Pfadangaben -- sonst waere das ein Directory Traversal. */
const ERLAUBT = /^[a-zA-Z0-9_-]+$/

let katalog: Buffer | null = null

export function ladeKatalog(): Buffer {
  if (!katalog) {
    const p = join(ORDNER, 'list.json')
    if (!existsSync(p)) throw notFound('Vorlagenliste nicht gefunden.')
    katalog = readFileSync(p)
  }
  return katalog
}

const cache = new Map<string, Buffer>()

export function ladeVorlage(name: string): Buffer {
  if (!ERLAUBT.test(name)) throw notFound('Unbekannte Vorlage.')

  const vorhanden = cache.get(name)
  if (vorhanden) return vorhanden

  const p = join(ORDNER, `${name}.xlsx`)
  // Zusaetzlich zum Zeichensatz-Check: der aufgeloeste Pfad muss im Ordner
  // liegen. Guertel und Hosentraeger, weil hier ein Request-Parameter in einen
  // Dateipfad geht.
  if (!resolve(p).startsWith(ORDNER + '/') || !existsSync(p)) {
    throw notFound(`Vorlage "${name}" nicht gefunden.`)
  }

  const inhalt = readFileSync(p)
  cache.set(name, inhalt)
  return inhalt
}
