import { schema } from './schema';
import { appVersion } from './version';
import { ApolloServer } from 'apollo-server-express';
import { json } from "body-parser";
import cors from 'cors';
import express from 'express';
import compression from 'compression'
import { createSQLContext, getSQLContext } from './schema/mysql';
import { checkToken, createToken2 } from './users/jwt';
// 
// const wait = (t) => new Promise((res, rej) => {
//   setTimeout(() => { res(t) }, t)
// })

export const getApp = (dev: boolean) => {
  const apollo = new ApolloServer({ schema })
  const app = express()
    .use(compression())
    .use(cors())
    .use('/time', (req, res) => {
      res.end(`{"time": ${new Date().getTime()}}`)
    })
    .use('/check', (req, res) => {
      res.end('{online: true}')
    })
    .use('/version', (req, res) => {
      res.end(`{"version": "${appVersion}"}`)
    })
    .use('/api-v4', json())
    .use('/api-v4', async (req, res, next) => {
      const authToken = req.headers.authorization

      if (!authToken) {
        res.status(401)
        res.end('{}')
        return
      }

      try {
        await checkToken(authToken)
      } catch (ex) {
        res.status(401)
        res.end('{}')
        console.error(ex)
        return
      }

      next()
    })
    .post('/api-v4/anmeldetoken', async (req, res, next) => {
      const veranstaltungsID: number = req.body.id

      const data = await Promise.all([2, 3, 4, 5, 6].map(v => `${veranstaltungsID}|${v}`).map(v => createToken2({ d: v }, process.env.NUXT_SECRET_TOKEN || 'fdsöljdslfj98', '100d')))
      console.log(data)

      res.json({
        data
      })
    })
    .post('/api-v4/sign', async (req, res, next) => {
      res.write('testdata')
      res.end(await createToken2(req.body.data, req.body.key, '100d'))
    })
    .use('/api-v5', async (req, res, next) => {
      const authToken = req.headers.authorization

      if (!authToken) {
        res.status(401)
        res.end('{}')
        return
      }

      try {
        const userID = (await checkToken(authToken)).userID
      } catch (ex) {
        res.status(401)
        res.end('{}')
        console.error(ex)
        return
      }

      await createSQLContext(req)

      next()
    })
    .use('/api-v5', async (req, res, next) => {
      getSQLContext(req).release()
    })

  apollo.applyMiddleware({ app, path: '/graphql' })

  return app
}
