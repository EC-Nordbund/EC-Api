import { schema } from './graphql'
import { appVersion } from './config/version'
import { ApolloServer } from 'apollo-server-express'
import { json as jsonBody } from 'body-parser'
import cors from 'cors'
import express from 'express'
import compression from 'compression'
import user from './api/user'
import personen from './api/personen'
import ak from './api/ak'
import document from './api/document'
import bestBrief from './api/best-brief'
import expressRateLimit from 'express-rate-limit'
import * as http from 'http'

import nuxt from './nuxt'

const apollo = new ApolloServer({ schema })
const app = express()
  //.use(compression())
  .use(cors({origin: (o, cb) => cb(null, true)}))
  .use('/time', (req, res) => {
    res.end(`{"time": ${new Date().getTime()}}`)
  })
  .use('/check', (req, res) => {
    res.end('{online: true}')
  })
  .use('/version', (req, res) => {
    res.end(`{"version": "${appVersion}"}`)
  })
  .use('/v6', json())

  .use(
    '/v6',
    expressRateLimit({
      windowMs: 1000,
      max: 2
    })
  )//.use(json({ type: 'application/*+json'}))

nuxt(app)
user(app)
personen(app)
ak(app)
document(app)
bestBrief(app)

apollo.start().then(() => {
  apollo.applyMiddleware({ app, path: '/graphql' })

  http.createServer(app).listen(4000)
})
