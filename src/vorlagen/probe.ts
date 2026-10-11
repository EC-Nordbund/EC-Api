import XlsxTemplate from 'xlsx-template'
import worker from 'comlink:../workers/generation'
import { ecError } from '../helpers/error'
import { mitRenderSlot } from '../schutzkonzept/formular'
import { PortalFehler } from '../portal/error'
import { KatalogEintrag, MIME, ladeBeispiel } from './katalog'
import { markdownZuHtml } from './markdown'

/**
 * Probe-Ausgabe fuer die Pflegemaske: die Vorlage mit den Beispieldaten aus
 * dem Katalog fuellen, so wie es der Code spaeter mit echten Daten tut.
 * Damit sieht man nach dem Upload sofort, ob Platzhalter und Layout stimmen
 * -- und nicht erst, wenn der erste echte Brief scheitert.
 */

export interface Probe {
  inhalt: Buffer
  mimetype: string
  dateiname: string
}

export async function erzeugeProbe(
  eintrag: KatalogEintrag,
  inhalt: Buffer
): Promise<Probe> {
  const basis = eintrag.schluessel.replace(/\./g, '-')

  if (eintrag.art === 'docx') {
    const daten = (await ladeBeispiel(eintrag)) ?? {}
    try {
      const pdf = await mitRenderSlot<ArrayBufferLike>(() =>
        worker.docxZuPdf(new Uint8Array(inhalt), daten, eintrag.delimiter)
      )
      return {
        inhalt: Buffer.from(pdf),
        mimetype: MIME.pdf,
        dateiname: `Probe-${basis}.pdf`
      }
    } catch (err: any) {
      if (err instanceof PortalFehler)
        throw new ecError(err.message, err.status)
      throw new ecError(
        `Die Probe ließ sich nicht erzeugen: ${String(err?.message ?? err).slice(0, 300)}`,
        400
      )
    }
  }

  if (eintrag.art === 'xlsx') {
    const daten = (await ladeBeispiel(eintrag)) ?? {}
    try {
      const mappe = new XlsxTemplate(inhalt)
      mappe.substitute(1, daten)
      return {
        inhalt: mappe.generate({ type: 'nodebuffer' }) as Buffer,
        mimetype: MIME.xlsx,
        dateiname: `Probe-${basis}.xlsx`
      }
    } catch (err: any) {
      throw new ecError(
        `Die Probe ließ sich nicht erzeugen: ${String(err?.message ?? err).slice(0, 300)}`,
        400
      )
    }
  }

  if (eintrag.art === 'md') {
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Probe ${eintrag.name}</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:2em auto;line-height:1.5}</style></head>
<body>${markdownZuHtml(inhalt.toString('utf8'))}</body></html>`
    return {
      inhalt: Buffer.from(html, 'utf8'),
      mimetype: 'text/html; charset=utf-8',
      dateiname: `Probe-${basis}.html`
    }
  }

  throw new ecError(
    'Für diese Vorlage gibt es keine Probe -- die Datei wird unverändert verschickt.',
    400
  )
}
