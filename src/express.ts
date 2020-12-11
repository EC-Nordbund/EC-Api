import { schema } from './schema';
import { appVersion } from './version';
import { ApolloServer } from 'apollo-server-express';
import cors from 'cors';
import express from 'express';
import compression from 'compression'

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

  apollo.applyMiddleware({ app, path: '/graphql' })

  return app
}
