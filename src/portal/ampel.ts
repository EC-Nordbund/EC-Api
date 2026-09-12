import { FZ_GUELTIG_JAHRE, FZ_WARNUNG_MONATE } from './config'
import { heute, plusJahre, plusMonate, toDateSafe } from './date'

export type Ampel = 'green' | 'yellow' | 'red'

/**
 * Farbe einer Person in den FZ-Listen.
 *
 * Vorlage ist die Faerbung der Monats-Mail (fz-mail-system/cron.php:22):
 *
 *   IF(fzVon+5J > now() - 6 MONTH, 'green',
 *      IF(fzVon+5J < now(), 'red', 'yellow'))
 *
 * Diese Fassung hat zwei Fehler, beide nachgerechnet:
 *
 * 1. Weil die Gruen-Bedingung zuerst greift, gilt ein Zeugnis noch bis zu
 *    sechs Monate NACH Ablauf als gruen. Ein FZ vom 01.06.2021 lief am
 *    01.06.2026 ab und wurde am 12.09.2026 weiter gruen ausgewiesen.
 * 2. Gelb ist bei vorhandenem Zeugnis unerreichbar -- es verlangt gleichzeitig
 *    `fzVon+5J <= heute-6M` und `fzVon+5J >= heute`. Der Hinweis in der Mail
 *    ("Personen, deren Zeugnis in Kuerze ablaeuft, sind gelb markiert",
 *    cron.php:213) beschreibt damit etwas, das nie eintritt.
 *
 * Gemeint war offensichtlich "laeuft erst in ueber sechs Monaten ab". Genau das
 * steht hier. cron.php:22 wird in derselben Auslieferung nachgezogen, sonst
 * sieht ein Ortsverantwortlicher im Portal rot, was im Excel gruen war.
 *
 * Fuer Personen ohne Zeugnis bleibt die Regel unveraendert: ein Antrag juenger
 * als acht Wochen ist gelb (laeuft noch), aelter ist rot.
 */
export function ampel(
  fzVon: Date | string | null | undefined,
  ersterAntrag: Date | string | null | undefined
): Ampel {
  const jetzt = heute()
  const fz = toDateSafe(fzVon)

  if (!fz) {
    const antrag = toDateSafe(ersterAntrag)
    if (!antrag) return 'red'
    const achtWochen = new Date(jetzt)
    achtWochen.setDate(achtWochen.getDate() - 56)
    return antrag > achtWochen ? 'yellow' : 'red'
  }

  const gueltigBis = plusJahre(fz, FZ_GUELTIG_JAHRE)
  if (gueltigBis < jetzt) return 'red'
  if (gueltigBis < plusMonate(jetzt, FZ_WARNUNG_MONATE)) return 'yellow'
  return 'green'
}

/** Ablaufdatum eines Zeugnisses, oder null wenn keines vorliegt. */
export function gueltigBis(
  fzVon: Date | string | null | undefined
): Date | null {
  const fz = toDateSafe(fzVon)
  return fz ? plusJahre(fz, FZ_GUELTIG_JAHRE) : null
}

/**
 * Gilt das Zeugnis noch am Stichtag?
 *
 * Fuer Veranstaltungen ist der Stichtag nicht "heute", sondern das Ende der
 * Freizeit -- ein Zeugnis, das waehrend der Freizeit ablaeuft, reicht nicht.
 * Dieselbe Regel wie hatFZ() in EC-Verwaltung
 * (pages/_/veranstaltungen/_id/_/anmeldungen.route.vue), dort mit zwei
 * dokumentierten Altfehlern: String-Vergleich von ISO gegen deutsches Format
 * und fehlendes Zero-Padding. Hier wird mit Date-Objekten gerechnet, damit sich
 * beides gar nicht erst stellen kann.
 *
 * `ende` ist bei Eintagesveranstaltungen NULL -> dann gilt `begin`.
 */
export function fzGueltigAmStichtag(
  fzVon: Date | string | null | undefined,
  ende: Date | string | null | undefined,
  begin: Date | string | null | undefined
): boolean {
  const bis = gueltigBis(fzVon)
  const stichtag = toDateSafe(ende) ?? toDateSafe(begin)
  if (!bis || !stichtag) return false
  return bis >= stichtag
}
