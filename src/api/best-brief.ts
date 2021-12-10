import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import {
  createBriefVeranstaltung,
  createBriefAnmeldung
} from '../helpers/bestMail'

export default (app: Express): void => {
  app.get<{ target: string }, emptyObj, emptyObj>(
    '/v6/best-brief/anmeldung/:target',
    async (req, res) => {
      try {
        await checkAuth(req)

        const anmeldeID = req.params.target

        await createBriefAnmeldung(anmeldeID)
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )

  app.get<{ target: string }, emptyObj, emptyObj>(
    '/v6/best-brief/veranstaltung/:target',
    async (req, res) => {
      try {
        await checkAuth(req)

        const veranstaltung = parseInt(req.params.target)

        await createBriefVeranstaltung(veranstaltung)
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )
}
