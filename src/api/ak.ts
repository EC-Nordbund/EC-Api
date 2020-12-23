import { Express } from 'express'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { ecError, errorHandler } from '../helpers/error'
import { getMySQL, query } from '../helpers/mysql'
import sql from 'sql-escape-tag'

export default (app: Express): void => {
  /**
   * POST /v6/ak
   *
   * Fügt einen neuen AK hinzu
   *
   * @name addAK
   */
  app.post<emptyObj, { ak_id: number }, { bezeichnung: string }>(
    '/v6/ak',
    async (req, res) => {
      try {
        await checkAuth(req)
        const con = await getMySQL()
        await con.query(
          sql`INSERT INTO ak (bezeichnung) VALUES (${req.body.bezeichnung})`
        )
        const ak = await con.query(
          sql`SELECT akID FROM ak WHERE bezeichnung = ${req.body.bezeichnung}`
        )
        con.release()
        res.json({
          ak_id: ak[0].akID
        })
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )

  /**
   * PUT /v6/ak/:ak_id
   *
   * Ändert die Daten des angegeben AK
   *
   * @name editAK
   */
  app.put<{ ak_id: number }, emptyObj, { bezeichnung: string }>(
    '/v6/ak/:ak_id',
    async (req, res) => {
      try {
        await checkAuth(req)
        await query(
          sql`UPDATE ak SET bezeichnung = ${req.body.bezeichnung} WHERE akID = ${req.params.ak_id}`
        )
        res.json({})
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )

  /**
   * PUT /v6/ak/:ak_id/personen/:personen_id
   *
   * Fügt einen neunen Status für die Person und AK hinzu
   *
   * @name addPersonAK
   */
  app.put<
    { ak_id: number; person_id: number },
    emptyObj,
    { date: string; status: number }
  >('/v6/ak/:ak_id/personen/:person_id', async (req, res) => {
    try {
      await checkAuth(req)
      await query(
        sql`INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${req.params.person_id}, ${req.params.ak_id}, ${req.body.date}, ${req.body.status})`
      )
      res.json({})
    } catch (error) {
      errorHandler(error, res)
    }
  })

  /**
   * GET /v6/ak
   *
   * Gibt einen Array aller AK's zurück
   *
   * @name getAKs
   */
  app.get<emptyObj, Array<{ akID: number; bezeichnung: string }>, emptyObj>(
    '/v6/ak',
    async (req, res) => {
      try {
        await checkAuth(req)
        const aks = await query(sql`SELECT * FROM ak`)
        res.json(aks)
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )

  /**
   * GET /v6/ak/:ak_id
   *
   * @todo nested properties fehlen
   *
   * Gibt den AK mit der ID ak_id zurück.
   *
   * @name getAK
   */
  app.get<{ ak_id: number }, { akID: number; bezeichnung: string }, emptyObj>(
    '/v6/ak/:ak_id',
    async (req, res) => {
      try {
        await checkAuth(req)
        const ak = await query(
          sql`SELECT * FROM ak WHERE akID = ${req.params.ak_id}`
        )
        if (ak.length === 0) {
          throw new ecError('Kein AK mit dieser ID gefunden', 404)
        }
        res.json(ak[0])
      } catch (error) {
        errorHandler(error, res)
      }
    }
  )
}
