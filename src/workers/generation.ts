import { Gotenberg } from 'docx-templates-to-pdf'
import { promises } from 'fs'

const gotenberg = new Gotenberg('http://gotenberg:3000')

export default {
  async generateDocumentsPDF(
    filename: string,
    data: Record<string, any>[]
  ): Promise<NodeJS.ReadableStream> {
    const file = await promises.readFile(filename)

    return gotenberg.fillDocToPdf(file, data)
  },
  async generateDocumentPDF(
    filename: string,
    data: Record<string, any>
  ): Promise<NodeJS.ReadableStream> {
    const file = await promises.readFile(filename)

    return gotenberg.fillDocToPdf(file, [data])
  },
  async generateDocument(
    filename: string,
    data: Record<string, any>
  ): Promise<ArrayBufferLike> {
    const file = await promises.readFile(filename)

    return gotenberg.fillDocToPdf(file, [data], {}, true)
  }
}
