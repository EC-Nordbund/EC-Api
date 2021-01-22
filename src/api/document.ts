import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import worker from 'comlink:../workers/generation'

export default (app: Express): void => {
  /**
   * GET /v6/generate-document
   *
   * Gibt einen Array aller Personen aus
   *
   * @name genDoc
   * @rawfile
   * @ext pdf
   * @filename gen-${Date.now()}
   */
  app.get<{ target: 'pdf' | 'docx' }, emptyObj, { data: any; file: string }>(
    '/v6/generate-document/:target',
    async (req, res) => {
      try {
        await checkAuth(req)

        const targetDOCX = req.params.target === 'docx'

        if (targetDOCX) {
          const doc = await worker.generateDocument(
            req.body.file,
            req.body.data
          )

          res.end(doc)

          return
        } else {
          const doc = await worker.generateDocumentPDF(
            req.body.file,
            req.body.data
          )

          res.end(doc)
        }

        // worker.generateDocument()

        // worker.
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )
}
