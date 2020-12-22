/* eslint-disable */
import esbuild from 'rollup-plugin-esbuild'
import json from '@rollup/plugin-json'

const apiMethods = []

export default {
  input: './src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [
    {
      name: 'api-extractor',
      transform(code, id) {
        if (id.indexOf('src\\api') === -1) return

        // const reg = /app\.([a-z]*)<([\sa-zA-Z0-9:\{\},_<>;]*)>\(\s*'(.*)'/gm
        const reg = /(\/\*\*[\s\*a-zA-Z@ÄÖÜäöü_:\/1-9']*\*\/)\s*app\.([a-z]*)<([\sa-zA-Z0-9:\{\},_<>;]*)>\(\s*'(.*)'/gm

        let m
        do {
          m = reg.exec(code)

          if (!m) {
            return
          }

          const doc = m[1]
          const method = m[2]
          const path = m[4]
          const [pathParams, resBody, reqBody] = m[3]
            .split(',')
            .map((v) => v.trim())

          const pathParamsMatcher = /\/(:[a-zA-Z_]+)/g

          let params = []

          let n
          do {
            n = pathParamsMatcher.exec(path)

            if (n) {
              params.push(n[1])
            }

          } while (n)

          let nPath = path

          for (let i = 0; i < params.length; i++) {
            nPath = nPath.replace(params[i], '${pathParams.' + params[i].slice(1) + '}')

          }

          apiMethods.push(`${doc.split('\n').map(v => v.trim()).join('\n')}\nexport function ${/@name\s([a-zA-Z]*)/.exec(doc)?.[1] || path.replace(/\\|\/|:/g, '_')}(${pathParams === 'emptyObj' ? '' : `pathParams: ${pathParams}, `}${reqBody === 'emptyObj' ? '' : `bodyParams: ${reqBody}`}):Promise<${resBody}> {\nreturn fetch(\`${nPath}\`, {method: '${method}',headers: {'content-type': 'application/json'${doc.indexOf('@noauth') === -1 ? ',authorization: getAuthToken()' : ''}}${reqBody === 'emptyObj' ? '' : ', body: JSON.stringify(bodyParams)'}}).then(errorHandler).then(res => res.json()) \n}`)
        } while (m)
      },
      generateBundle() {
        this.emitFile({
          id: 'api.ts',
          type: 'asset',
          fileName: 'api.ts',
          source:
            `/* eslint-disable */
// @ts-ignore
import Vue from 'vue'
// @ts-ignore
const getAuthToken: () => string = Vue.prototype.$authToken
const errorHandler = async (res: Response) => {
  if (res.status !== 200) throw await res.text()
  return res
}
type emptyObj = Record<string, never>\n`+
            apiMethods.join('\n')
        })
      }
    },
    esbuild({
      target: 'es2018'
    }),
    json()
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
    'swagger-ui-express',
    'express-rate-limit',
    'web-push'
  ]
}
