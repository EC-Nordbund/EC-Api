import { randomBytes } from 'crypto'
import { promises } from 'fs'
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

export default {
  async generateDocumentsPDF(
    filename: string,
    data: Record<string, any>[]
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return toBuffer(await gotenbergInst.fillDocToPdf(file, data))
  },
  async generateDocumentPDF(
    filename: string,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return toBuffer(await gotenbergInst.fillDocToPdf(file, [data]))
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
  },
  async generateDocument(
    filename: string,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return gotenbergInst.fillDocToPdf(file, [data], {}, true)
  }
}
