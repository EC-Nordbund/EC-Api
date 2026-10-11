import { randomBytes } from 'crypto'
import vm from 'vm'
import { Response } from 'node-fetch'

import { createReport, listCommands } from 'docx-templates'
import { UserOptions } from 'docx-templates/lib/types'
import {
  gotenberg,
  pipe,
  office,
  please,
  convert,
  set,
  timeout
} from 'gotenberg-js-client'
import { type Befehl, istVerboten } from '../schutzkonzept/platzhalter'

/** docx-templates erwartet einen echten ArrayBuffer, keine Sicht darauf. */
function alsArrayBuffer(v: Uint8Array): ArrayBuffer {
  return v.buffer.slice(
    v.byteOffset,
    v.byteOffset + v.byteLength
  ) as ArrayBuffer
}

/**
 * Nur Schluessel, die die Auswertung ueberhaupt lesen darf. Tabellenzeilen
 * werden mitgefiltert; `$` ist den Schleifenvariablen vorbehalten.
 */
function sichereDaten(v: unknown): any {
  if (Array.isArray(v)) return v.map(sichereDaten)
  if (v === null || typeof v !== 'object') return v
  const aus: Record<string, unknown> = {}
  for (const [k, w] of Object.entries(v)) {
    if (k.startsWith('$') || istVerboten(k)) continue
    aus[k] = sichereDaten(w)
  }
  return aus
}

type config = Omit<UserOptions, 'template' | 'queryVars'>

type DATA = Record<string, any>
type Template = UserOptions['template']

export class Gotenberg {
  constructor(protected url: string) {}

  public async fillDocToPdf(
    file: Template,
    data: DATA[],
    config?: config
  ): Promise<NodeJS.ReadableStream>
  public async fillDocToPdf(
    file: Template,
    data: [DATA],
    config: config,
    onlyDocx: true
  ): Promise<ArrayBufferLike>
  public async fillDocToPdf(
    file: Template,
    data: DATA[],
    config: config = {},
    onlyDocx = false
  ) {
    const query = typeof config.data === 'function'

    const docx = await Promise.all(
      data.map((v) =>
        createReport({
          ...config,
          template: file,
          ...(query ? { queryVars: v } : { data: v })
        }).then((v) => v.buffer)
      )
    )

    if (onlyDocx && data.length === 1) {
      return docx[0] as any
    }

    return pipe(
      gotenberg(this.url),
      convert,
      office,
      set(timeout(30)),
      please
    )(docx.map((v, i) => [`${i}.docx`, Buffer.from(v)]))
  }
}

const gotenbergInst = new Gotenberg('http://gotenberg:3000')

const toBuffer = (stream: NodeJS.ReadableStream) => {
  return new Response(stream).buffer().then((v) => v.buffer)
}

/** Ein Zufallswert, der in keinem Text vorkommt (siehe schutzkonzeptPdf). */
const zufallsDelimiter = () => `#LX${randomBytes(12).toString('hex')}#`

/**
 * Auswertung der Befehle einer Standardvorlage (Briefe, FZ-Antrag,
 * QR-Blatt) mit Zeitlimit.
 *
 * Das ist der Sandbox-Pfad von docx-templates selbst (vm.Script in einem
 * eigenen Kontext), nur mit `timeout`: die Vorlagen werden seit 09/2026 in
 * EC-Verwaltung hochgeladen, und eine versehentliche Endlosschleife in einem
 * Befehl legte sonst den einzigen Dokument-Worker und damit jeden
 * Briefversand lahm. Den Hochladenden wird vertraut (vorlagen/pruefung.ts),
 * das Zeitlimit faengt nur Tippfehler ab.
 */
const laufzeitbegrenzt: UserOptions['runJs'] = ({ sandbox }) => {
  const context = vm.createContext(sandbox)
  const result = new vm.Script(sandbox.__code__ ?? '').runInContext(context, {
    timeout: 2000
  })
  // vm.createContext liefert den Typ Context; fuer docx-templates ist es
  // dasselbe Objekt wie die uebergebene Sandbox.
  return { modifiedSandbox: context as typeof sandbox, result }
}

/**
 * Optionen fuer die Standardvorlagen (`+++`-Delimiter wie bisher).
 *
 * Der zufaellige literalXmlDelimiter schuetzt vor Anmeldedaten mit `||`
 * darin (Bemerkungen, Gesundheitsinformationen): mit dem Standardwert fuegte
 * docx-templates den Rest des Textes als rohes XML in den Brief ein.
 */
const standardOptionen = (delimiter?: string | [string, string]): config => ({
  ...(delimiter ? { cmdDelimiter: delimiter } : {}),
  literalXmlDelimiter: zufallsDelimiter(),
  runJs: laufzeitbegrenzt
})

export default {
  /**
   * Vorlage (DOCX als Bytes) mit Daten fuellen und als PDF liefern.
   *
   * Die Vorlagen kommen aus vorlagen/store.ts (Datenbank oder Dateisystem),
   * nicht mehr ueber einen Dateinamen -- der Worker liest keine Dateien.
   * Die Bytes muessen als eigene Kopie ankommen (new Uint8Array(buffer)):
   * comlink klont sie in den Worker-Thread.
   */
  async docxZuPdf(
    vorlage: Uint8Array,
    data: Record<string, any>,
    delimiter?: string | [string, string]
  ): Promise<ArrayBufferLike> {
    return toBuffer(
      await gotenbergInst.fillDocToPdf(
        Buffer.from(vorlage),
        [data],
        standardOptionen(delimiter)
      )
    )
  },
  /** Wie docxZuPdf, aber das gefuellte DOCX selbst statt eines PDFs. */
  async docxFuellen(
    vorlage: Uint8Array,
    data: Record<string, any>,
    delimiter?: string | [string, string]
  ): Promise<ArrayBufferLike> {
    return gotenbergInst.fillDocToPdf(
      Buffer.from(vorlage),
      [data],
      standardOptionen(delimiter),
      true
    )
  },
  /**
   * Befehle einer Vorlage mit beliebigem Delimiter (Standard `+++`); wirft
   * bei kaputter DOCX. Grundlage der Platzhalter-Pruefung beim Upload.
   */
  async befehle(
    vorlage: Uint8Array,
    delimiter: string | [string, string] = '+++'
  ): Promise<Befehl[]> {
    const cmds = await listCommands(alsArrayBuffer(vorlage), delimiter)
    return cmds.map((c) => ({ type: c.type, code: c.code }))
  },
  /**
   * Schutzkonzept: Vorlage kommt aus der Datenbank statt aus einer Datei.
   *
   * Die Vorlage stammt von der Schutzkonzept-Verwaltung und darf alles, was
   * docx-templates kann (Ausdruecke, EXEC, FOR, IF) -- siehe
   * schutzkonzept/platzhalter.ts. Die eingesetzten Antworten der EC-Kreise
   * dagegen gehen nur als Werte hinein: Schluessel wie `__code__` fliegen
   * vorher aus den Daten, weil docx-templates die Daten in denselben Kontext
   * legt wie den auszufuehrenden Code (sichereDaten).
   *
   * Ein unbekannter Platzhalter wird leer statt das ganze PDF abzubrechen --
   * der Builder warnt vorher beim Abgleich der Vorlage mit dem Formular.
   * Der errorHandler steht hier im Worker, weil Funktionen nicht durch
   * comlink reisen koennen.
   */
  async schutzkonzeptPdf(
    vorlage: Uint8Array,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    return toBuffer(
      await gotenbergInst.fillDocToPdf(
        Buffer.from(vorlage),
        [sichereDaten(data)],
        {
          cmdDelimiter: ['{{', '}}'],
          errorHandler: () => '',
          // Standard ist "||": steht das in einer Antwort eines Kreises, fuegte
          // docx-templates den Rest als rohes XML ins Dokument ein. Ein
          // Zufallswert kommt in keinem Text vor.
          literalXmlDelimiter: `#LX${randomBytes(12).toString('hex')}#`,
          // Zeilenumbrueche aus mehrzeiligen Antworten: die Standardvariante
          // verschluckt LibreOffice (= Gotenberg) -- "Zeile1Zeile2".
          processLineBreaksAsNewText: true
        }
      )
    )
  },
  /** Befehle einer `{{ }}`-Vorlage; wirft bei kaputter DOCX. */
  async schutzkonzeptBefehle(vorlage: Uint8Array): Promise<Befehl[]> {
    const cmds = await listCommands(alsArrayBuffer(vorlage), ['{{', '}}'])
    return cmds.map((c) => ({ type: c.type, code: c.code }))
  }
}
