import XlsxTemplate from 'xlsx-template'
import worker from 'comlink:../workers/generation'
import { ecError } from '../helpers/error'
import { extrahiereKeys, type Befehl } from '../schutzkonzept/platzhalter'
import { KatalogEintrag, MIME, ladeBeispiel } from './katalog'
import type { Datei } from './store'

/**
 * Pruefung einer hochgeladenen Vorlage.
 *
 * Zwei Stufen: harte Ablehnung (400) fuer alles, was die Datei unbrauchbar
 * macht (falscher Typ, kaputtes ZIP, Skript im Mailtext), und Warnungen fuer
 * Platzhalter, die der Code nicht kennt -- die Verwaltung zeigt sie und laesst
 * "trotzdem speichern" zu, weil die echten Briefe Ausdruecke enthalten
 * koennen, die hier nicht vorhersehbar sind.
 *
 * Bewusst KEINE Sperre fuer EXEC, HTML oder Funktionsaufrufe in docx: die
 * Vorlagen laden ausschliesslich Personen der Verwaltung hoch, und denen wird
 * -- wie schon bei den Schutzkonzept-Vorlagen (schutzkonzept/platzhalter.ts)
 * -- vertraut. Eine Vorlage darf rechnen, formatieren und mit EXEC eigene
 * Hilfsvariablen anlegen. Was der Worker zusaetzlich absichert (Zeitlimit je
 * Befehl, zufaelliger XML-Delimiter), richtet sich gegen Tippfehler und
 * Anmeldedaten, nicht gegen die Hochladenden.
 */

const ZIP_MAGIC = 0x04034b50

/** MIME-Typen, die der Browser fuer die jeweilige Art schicken darf. */
const ERLAUBTE_MIME: Record<KatalogEintrag['art'], string[]> = {
  docx: [MIME.docx, 'application/octet-stream'],
  xlsx: [MIME.xlsx, 'application/octet-stream'],
  pdf: [MIME.pdf, 'application/octet-stream'],
  md: [MIME.md, 'text/plain', 'text/x-markdown', 'application/octet-stream', '']
}

const ART_NAME: Record<KatalogEintrag['art'], string> = {
  docx: 'Word-Datei (.docx)',
  xlsx: 'Excel-Datei (.xlsx)',
  pdf: 'PDF-Datei',
  md: 'Textdatei (Markdown)'
}

/** Erste Sicht auf die Bytes: passt der Inhalt zur Art? */
function pruefeFormat(eintrag: KatalogEintrag, datei: Datei): void {
  if (!ERLAUBTE_MIME[eintrag.art].includes(datei.mimetype)) {
    throw new ecError(
      `„${eintrag.name}" erwartet eine ${ART_NAME[eintrag.art]}, hochgeladen wurde „${datei.mimetype}".`,
      400
    )
  }
  const b = datei.inhalt
  if (eintrag.art === 'docx' || eintrag.art === 'xlsx') {
    if (b.length < 4 || b.readUInt32LE(0) !== ZIP_MAGIC) {
      throw new ecError(`Das ist keine ${ART_NAME[eintrag.art]}.`, 400)
    }
  } else if (eintrag.art === 'pdf') {
    if (b.length < 5 || b.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new ecError('Das ist keine PDF-Datei.', 400)
    }
  }
}

/* --------------------------------------------------------------- docx -- */

async function pruefeDocx(
  eintrag: KatalogEintrag,
  datei: Datei
): Promise<string[]> {
  let befehle: Befehl[]
  try {
    befehle = await worker.befehle(
      new Uint8Array(datei.inhalt),
      eintrag.delimiter ?? '+++'
    )
  } catch (err) {
    throw new ecError(
      `Die Word-Datei ließ sich nicht lesen: ${String((err as any)?.message ?? err).slice(0, 200)}`,
      400
    )
  }
  const beispiel = await ladeBeispiel(eintrag)
  if (!beispiel) return []
  const bekannt = new Set(Object.keys(beispiel))
  const unbekannt = extrahiereKeys(befehle).filter((k) => !bekannt.has(k))
  if (!unbekannt.length) return []
  return [
    `Unbekannte Platzhalter: ${unbekannt.join(', ')}. Der Code füllt hier nur: ${[...bekannt].join(', ')}. Ein unbekannter Platzhalter lässt das Dokument beim Erzeugen scheitern.`
  ]
}

/* --------------------------------------------------------------- xlsx -- */

/** Gibt es den Punktpfad im Beispiel? Arrays werden ueber das erste Element geprueft. */
function pfadVorhanden(obj: unknown, pfad: string): boolean {
  let akt: any = obj
  for (const teil of pfad.split('.')) {
    if (Array.isArray(akt)) akt = akt[0]
    if (akt === null || typeof akt !== 'object' || !(teil in akt)) return false
    akt = akt[teil]
  }
  return true
}

/**
 * xlsx-template legt die geteilten Zeichenketten der Arbeitsmappe offen und
 * erkennt Platzhalter mit derselben Funktion, die spaeter auch substitute()
 * benutzt -- die Pruefung sieht also genau das, was beim Fuellen passiert.
 */
async function pruefeXlsx(
  eintrag: KatalogEintrag,
  datei: Datei
): Promise<string[]> {
  let mappe: XlsxTemplate
  try {
    mappe = new XlsxTemplate(datei.inhalt)
  } catch (err) {
    throw new ecError(
      `Die Excel-Datei ließ sich nicht lesen: ${String((err as any)?.message ?? err).slice(0, 200)}`,
      400
    )
  }
  const beispiel = await ladeBeispiel(eintrag)
  if (!beispiel) return []

  const unbekannt = new Set<string>()
  for (const s of mappe.sharedStrings) {
    for (const p of mappe.extractPlaceholders(s)) {
      // Die Typdefinition nennt `placeholder` optional und `key` Pflicht;
      // die Implementierung liefert es genau umgekehrt.
      const name = p.name ?? ''
      const key: string | undefined = p.key
      const marke = p.placeholder ?? `\${${name}}`
      if (p.type === 'table') {
        const liste = (beispiel as any)[name]
        if (!Array.isArray(liste) || (key && !pfadVorhanden(liste, key))) {
          unbekannt.add(marke)
        }
      } else if (p.type === 'normal') {
        const pfad = key ? `${name}.${key}` : name
        if (!pfadVorhanden(beispiel, pfad)) unbekannt.add(marke)
      }
    }
  }
  if (!unbekannt.size) return []
  return [
    `Unbekannte Platzhalter: ${[...unbekannt].join(', ')}. Sie bleiben beim Füllen leer.`
  ]
}

/* ----------------------------------------------------------------- md -- */

function pruefeMarkdown(datei: Datei): string[] {
  const text = datei.inhalt.toString('utf8')
  if (/<script|javascript:|\son\w+\s*=/i.test(text)) {
    throw new ecError(
      'Der Text enthält Skript-Anteile (<script>, javascript: oder on…=). Bitte entfernen.',
      400
    )
  }
  if (text.includes('�')) {
    throw new ecError(
      'Die Datei ist nicht UTF-8-kodiert (ungültige Zeichen). Bitte als UTF-8 speichern.',
      400
    )
  }
  return []
}

/**
 * Datei pruefen. Wirft bei harten Fehlern, liefert sonst die Warnungen.
 * Nicht fuer "uebernehmen": was heute schon im Container laeuft, wird
 * unveraendert gesichert.
 */
export async function pruefeDatei(
  eintrag: KatalogEintrag,
  datei: Datei
): Promise<string[]> {
  pruefeFormat(eintrag, datei)
  switch (eintrag.art) {
    case 'docx':
      return pruefeDocx(eintrag, datei)
    case 'xlsx':
      return pruefeXlsx(eintrag, datei)
    case 'md':
      return pruefeMarkdown(datei)
    default:
      return []
  }
}
