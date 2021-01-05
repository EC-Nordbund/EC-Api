/* eslint-disable */
import esbuild from 'rollup-plugin-esbuild'
import json from '@rollup/plugin-json'
import { apiExtractor } from './apiExtractor'

import comlink from '@surma/rollup-plugin-comlink'
import omt from '@surma/rollup-plugin-off-main-thread'

const nodeExternals = [
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
  'zlib'
]

export default {
  input: './src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [
    comlink(),
    omt(),
    apiExtractor(),
    esbuild({
      target: 'es2018'
    }),
    json()
  ],
  external: [
    ...nodeExternals,
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
    'swagger-ui-express',
    'express-rate-limit',
    'web-push'
  ]
}
