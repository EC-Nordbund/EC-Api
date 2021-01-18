import { readFileSync } from 'fs'

/* eslint-disable */
const apiMethods = []

export function apiExtractor() {
  return {
    name: 'api-extractor',
    transform(code, id) {
      if (id.indexOf('src\\api') === -1) return

      // const reg = /app\.([a-z]*)<([\sa-zA-Z0-9:\{\},_<>;]*)>\(\s*'(.*)'/gm
      const reg = /(\/\*\*[\s\*a-zA-Z@ÄÖÜäöü_:\/1-9'.]*\*\/)\s*app\.([a-z]*)<([\sa-zA-Z0-9:\{\},_<>;]*)>\(\s*'(.*)'/gm

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

        let nPath = '${this.url}' + path

        for (let i = 0; i < params.length; i++) {
          nPath = nPath.replace(
            params[i],
            '${pathParams.' + params[i].slice(1) + '}'
          )
        }


        const normalCache = /@cache/.test(doc)
        const secureCache = /@encryptedcache/.test(doc)

        apiMethods.push(
          `${doc}\npublic ${/@name\s([a-zA-Z]*)/.exec(doc)?.[1] || path.replace(/\\|\/|:/g, '_')
          }(${pathParams === 'emptyObj' ? '' : `pathParams: ${pathParams}, `} ${reqBody === 'emptyObj' ? '' : `bodyParams: ${reqBody}`
          } ${(normalCache || secureCache)
            ? `${pathParams === 'emptyObj' && reqBody === 'emptyObj' ? '' : ','
            }options: {noCache: boolean} = {noCache: false}`
            : ''
          }): Promise<${resBody}>{
        ${(normalCache || secureCache) ? `const f =` : 'return'
          } fetch(\`${nPath}\`,{method: '${method}',headers: this.getHeaders(${doc.indexOf('@noauth') !== -1})${reqBody === 'emptyObj' ? '' : ',body: JSON.stringify(bodyParams)'
          }}).then(this.errorHandler)
            ${(normalCache || secureCache)
            ? `if(options.noCache) {return f} const key = JSON.stringify([\`${nPath}\`, '${method}', ${pathParams === 'emptyObj' ? '' : 'pathParams,'
            }${reqBody === 'emptyObj' ? '' : 'bodyParams'}]); return this.handle${secureCache ? 'Secure' : ''}Cache(f, key)`
            : ``
          }}`
        )
      } while (m)
    },
    async generateBundle() {
      const code = `
import { Base } from './api-base'
type emptyObj = Record<string, never>

export class API extends Base {
  ${apiMethods.join('\n\n').replace(/,\s*,/gm, ',')}
}
`

      this.emitFile({
        id: 'api.ts',
        type: 'asset',
        fileName: 'api.ts',
        source: code
      })

      this.emitFile({
        id: 'api-base.ts',
        type: 'asset',
        fileName: 'api-base.ts',
        source: readFileSync('./api-base.ts')
      })
    }
  }
}
