import { notFound } from './error'
import { TNLISTEN } from '../vorlagen/katalog'
import { ladeVorlage as ladeDateivorlage } from '../vorlagen/store'

/**
 * Ausliefern der TN-Listen-Vorlagen fuers Portal.
 *
 * Die fuenf xlsx sind seit 09/2026 Dateivorlagen (`tnliste.<name>`): sie
 * liegen in der Datenbank, sobald jemand sie in EC-Verwaltung hochgeladen
 * hat, sonst kommen sie aus ./templates. Verwaltung und Portal lesen
 * dieselbe Quelle -- die Vorlagen existieren damit genau einmal. Das Rendern
 * bleibt im Client (xlsx-template), wo es erprobt ist.
 */

/** Nur genau diese Namen, keine Pfadangaben -- sonst waere das ein Directory Traversal. */
const ERLAUBT = /^[a-zA-Z0-9_-]+$/

/** Katalog wie das fruehere templates/list.json: name/label. */
export function ladeKatalog(): { name: string; label: string }[] {
  return TNLISTEN.map((t) => ({ name: t.name, label: t.label }))
}

export async function ladeVorlage(name: string): Promise<Buffer> {
  if (!ERLAUBT.test(name) || !TNLISTEN.some((t) => t.name === name)) {
    throw notFound('Unbekannte Vorlage.')
  }
  try {
    return (await ladeDateivorlage(`tnliste.${name}`)).inhalt
  } catch {
    throw notFound(`Vorlage "${name}" nicht gefunden.`)
  }
}
