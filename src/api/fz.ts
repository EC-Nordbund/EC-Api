import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import { createFZAll } from '../fzList'
import sendMail from '../helpers/mail'

export default (app: Express): void => {
  app.get<emptyObj, any, emptyObj>('/v6/fz/all', async (req, res) => {
    try {
      await checkAuth(req)

      const r = await createFZAll()

      await sendMail(
        'fz@ec-nordbund.de',
        { to: '2pi_r2@gmx.de' },
        'test',
        'test',
        false,
        [
          {
            content: r,
            filename: 'all.xlsx'
          }
        ]
      )
      // res.send(Buffer.from(r))
      res.json('DONE')
    } catch (error) {
      errorHandler(error, res)
    }
  })
}
