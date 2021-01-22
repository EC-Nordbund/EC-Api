import esbuild from 'rollup-plugin-esbuild'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { apiExtractor } from './rollup-plugins/apiExtractor'
import { terser } from "rollup-plugin-terser";
import { minifySql } from './rollup-plugins/minifySql'
import { comlink } from './rollup-plugins/comlink'

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
    dir: 'dist',
    format: 'cjs'
  },
  plugins: [
    {
      resolveFileUrl({ relativePath }) {
        return JSON.stringify('./dist/' + relativePath);
      },
    },
    resolve(),
    commonjs(),
    comlink({ type: 'node' }),
    apiExtractor(),
    esbuild({
      target: 'es2018'
    }),
    minifySql(),
    json(),
    terser()
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
    'swagger-ui-express',
    'express-rate-limit',
    'web-push'
  ]
}

