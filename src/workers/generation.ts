import { Gotenberg } from 'docx-templates-to-pdf'
import { promises } from 'fs'
import { Response } from 'node-fetch'

const gotenberg = new Gotenberg('http://gotenberg:3000')

const toBuffer = (stream: NodeJS.ReadableStream) => {
  return new Response(stream).buffer().then((v) => v.buffer)
}

export default {
  async generateDocumentsPDF(
    filename: string,
    data: Record<string, any>[]
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return toBuffer(await gotenberg.fillDocToPdf(file, data))
  },
  async generateDocumentPDF(
    filename: string,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return toBuffer(await gotenberg.fillDocToPdf(file, [data]))
  },
  async generateDocument(
    filename: string,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return gotenberg.fillDocToPdf(file, [data], {}, true)
  }
}
