import folderImport from './lib/folderImport'
import esbuild from 'rollup-plugin-esbuild'
import json from '@rollup/plugin-json'
import swagger from './lib/swagger'

export default {
  input: './src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [
    esbuild({
      target: 'es2018'
    }),
    folderImport(),
    json(),
    swagger({
      swaggerDefinition: {
        openapi: '3.0.0',
        info: {
          title: 'EC-Nordbund API',
          version: '3.0.0'
        },
        securityDefinitions: {
          authToken: {
            type: 'apiKey',
            name: 'authToken',
            in: 'header'
          }
        }
      },
      apis: ['./src/new-api/*.ts']
    })
  ],
  external: [
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'timers',
    'tls',
    'trace_events',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'worker_threads',
    'zlib',
    'docx-templates-to-pdf',
    'apollo-server-express',
    'compression',
    'cors',
    'express',
    'graphql',
    'graphql-subscriptions',
    'js-sha3',
    'nodemailer',
    'promise-mysql',
    'depd',
    'jsonwebtoken',
    'body-parser',
    'sql-escape-tag',
    'swagger-ui-express'
  ]
}
