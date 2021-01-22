import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { errorHandler } from '../helpers/error'
import { query } from '../helpers/mysql'
import sql from 'sql-escape-tag'

export default (app: Express): void => {
  /**
   * GET /v6/personen
   *
   * Gibt einen Array aller Personen aus
   *
   * @name getPersonen
   * @encryptedcache
   */
  app.get<emptyObj, { personen: Array<any> }, emptyObj>(
    '/v6/personen',
    async (req, res) => {
      try {
        await checkAuth(req)
        const personen = (
          await query(
            sql`SELECT personID, vorname, nachname, gebDat, geschlecht FROM personen`
          )
        ).map((v) => ({ ...v, gebDat: v.gebDat.toISOString().split('T')[0] }))
        res.json({
          personen
        })
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )
}
