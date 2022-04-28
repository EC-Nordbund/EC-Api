import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import { createFZAll } from '../fzList'

export default (app: Express): void => {
  app.get<emptyObj, Buffer, emptyObj>('/v6/fz/all', async (req, res) => {
    try {
      await checkAuth(req)

      const r = await createFZAll()

      res.send(Buffer.from(r))
      // res.end(r)
    } catch (error) {
      errorHandler(error, res)
    }
  })
}
