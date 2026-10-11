import { ladeVorlage } from './store'

/* eslint-disable @typescript-eslint/no-require-imports */
const remark = require('remark')
const remarkHtml = require('remark-html')
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Markdown-Vorlagen (Datenschutztexte, Fusszeile der Anmelde-Mails) zu HTML.
 *
 * Genau die Verarbeitung, die nuxt/mailContent.ts bis 09/2026 beim Start fuer
 * die vier .md-Dateien machte: Ueberschriften eine Stufe tiefer (`#` wird
 * `##`, damit der Mailtext nur eine h1 hat), dann remark-html. Vorschau in
 * der Verwaltung und Mail laufen durch dieselbe Funktion.
 *
 * Cache nach sha256 des Textes: die Texte aendern sich selten, die Mails
 * gehen bei jeder Anmeldung raus.
 */

const htmlCache = new Map<string, string>()

export function markdownZuHtml(text: string): string {
  return remark()
    .use(remarkHtml)
    .processSync('\n' + text.replace(/\n\s*#/, '\n##'))
    .toString()
}

/** HTML einer Markdown-Vorlage aus dem Store (DB oder Datei). */
export async function vorlageAlsHtml(schluessel: string): Promise<string> {
  const v = await ladeVorlage(schluessel)
  const c = htmlCache.get(v.sha256)
  if (c !== undefined) return c
  const html = markdownZuHtml(v.inhalt.toString('utf8'))
  htmlCache.set(v.sha256, html)
  return html
}
