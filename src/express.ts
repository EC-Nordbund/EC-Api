import { schema } from './schema';
import { appVersion } from './version';
import { ApolloServer } from 'apollo-server-express';
// import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';

export const getApp = (dev: boolean) => {
  const apollo = new ApolloServer({ schema })
  const app = express()
    .use(cors())
    .use('/check', (req, res) => {
      res.end('{online: true}')
    })
    .use('/version', (req, res) => {
      res.end(`{"version": "${appVersion}"}`)
    })

  apollo.applyMiddleware({ app, path: '/graphql' })

  return app
}
