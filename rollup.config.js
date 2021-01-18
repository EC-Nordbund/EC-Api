/* eslint-disable */
import esbuild from 'rollup-plugin-esbuild'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { apiExtractor } from './apiExtractor'
import { terser } from "rollup-plugin-terser";

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
    // file: 'dist/bundle.js',
    dir: 'dist',
    format: 'cjs'
  },
  plugins: [
    resolve(),
    commonjs(),
    (() => {
      const importPrefix = 'comlink:'
      return {
        name: 'comlink',
        async resolveId(id, importer) {
          if (id.startsWith(importPrefix)) {
            const res = await this.resolve(id.slice(importPrefix.length).split('?')[0], importer)

            return importPrefix + res.id + '?' + (id.split('?')[1] || '')
          }
        },
        resolveFileUrl({ relativePath }) {
          return JSON.stringify('./dist/' + relativePath)
        },
        async load(id) {
          if (id.startsWith(importPrefix)) {
            const status = id.split('?')[1]

            if (status === '') {
              const fileID = this.emitFile({
                type: 'chunk',
                id: id.split('?')[0] + '?worker'
              })

              return `
                import { Worker } from 'worker_threads';
                import { wrap } from 'comlink'
                import nodeEndpoint from 'comlink/dist/esm/node-adapter'

                const worker = new Worker(import.meta.ROLLUP_FILE_URL_${fileID});

                const api = wrap(nodeEndpoint(worker));

                export default api
              `
            } else if (status === 'worker') {
              return `
                import { parentPort } from 'worker_threads'
                import { expose } from 'comlink'
                import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'

                import api from ${JSON.stringify(id.slice(importPrefix.length).split('?')[0])}
                
                expose(api, nodeEndpoint(parentPort))
              `
            }
          }
        }
      }
    })(),
    apiExtractor(),
    esbuild({
      target: 'es2018'
    }),
    {
      transform(code) {
        let changed = false
        let nCode = code
        const reg = /sql`([\s0-9a-zA-Z'"_()$[\].{}=*,><;+-]*)`/g

        // UPDATE users SET last_login = NOW() WHERE user_id = ${ users[0].user_id }
        //  = NOW() WHERE user_id = ${ users[0].user_id }

        let n
        do {
          n = reg.exec(code)

          if (n) {
            // console.log(n[1])


            let sql = n[1]
            let sql2 = ''

            while (sql2.length !== sql.length) {
              sql2 = sql;
              sql = sql.split('\n').join(' ').split('  ').join(' ').trim()
            }

            changed = true
            nCode = nCode.replace(n[1], sql)
          }
        } while (n)

        if (changed) {
          return nCode
        }
      }
    },
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
    'sql-escape-tag',
    'swagger-ui-express',
    'express-rate-limit',
    'web-push'
  ]
}
