/* eslint-disable */
const apiMethods = []

export function apiExtractor() {
  return {
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

        let nPath = '${this.url}' + path

        for (let i = 0; i < params.length; i++) {
          nPath = nPath.replace(
            params[i],
            '${pathParams.' + params[i].slice(1) + '}'
          )
        }

        const normalCache = /@cache/.test(doc)

        apiMethods.push(
          `${doc}\n${/@name\s([a-zA-Z]*)/.exec(doc)?.[1] || path.replace(/\\|\/|:/g, '_')
          }(${pathParams === 'emptyObj' ? '' : `pathParams: ${pathParams}, `}${reqBody === 'emptyObj' ? '' : `bodyParams: ${reqBody}`
          }${normalCache ? `${pathParams === 'emptyObj' && reqBody === 'emptyObj' ? '' : ','}options: {noCache: boolean} = {noCache: false}` : ''}):Promise<${resBody}>{
            ${normalCache ? `const f =` : 'return'} fetch(\`${nPath}\`,{method: '${method}',headers: {'content-type': 'application/json'${doc.indexOf('@noauth') === -1
            ? ',authorization: this.getAuthToken()'
            : ''
          }}${reqBody === 'emptyObj' ? '' : ',body: JSON.stringify(bodyParams)'
          }}).then(this.errorHandler)
            ${normalCache ? `
            if(options.noCache) {return f}
            const key = JSON.stringify([\`${nPath}\`, ${pathParams === 'emptyObj' ? '' : 'pathParams,'}${reqBody === 'emptyObj' ? '' : 'bodyParams'}])
            return this.handleCache(f, key)`: ``}
           }`
        )
      } while (m)
    },
    async generateBundle() {
      const code = `import { get as idb_get, set as idb_set } from 'idb-keyval';
import Vue from 'vue'

type emptyObj = Record<string, never>

export class api {
  constructor(private url: string) {}

  private getAuthToken(): string {
    return Vue.prototype.$authToken
  }

  private async errorHandler(res: Response) {
    if (res.status !== 200) throw await res.text()
    return res.json()
  }

  private async handleCache(network: Promise<any>, key: string): Promise<any> {
    return new Promise((res, rej) => {
      const cached_val_promise = idb_get(key)

      let finished = false

      cached_val_promise.then(cached => {
        if(!finished) {
          finished = true;
          if(cached === undefined || (cached.valid_until - (new Date()).getTime() < 0)) {
            // Not valid cache
            if(!navigator.onLine) {
              // When offline use this cache even it is old.
              res(cached.value)  
            } else {
              fail = 'Keine Daten Lokal gespeichert'
              res(network)
            }
          } else {
            res(cached.value)
          }
        }
      })

      network.then(net => {
        if(!finished) {
          finished = true
          res(net)
        }
      })

      network.then(net => {
        idb_set(key, {
          valid_until: (new Date().getTime()) + ${14 * 24 * 60 * 60 * 1000},
          value: net
        })
      })

      let fail = ''

      network.catch((v) => {
        if(fail) {
          rej(fail + '\\n' + v)
        }
        fail = v
      })

      cached_val_promise.catch((v) => {
        if(fail) {
          rej(v + '\\n' + fail)
        }
        fail = v
      })
    })

    


  }

  ${apiMethods.join('\n\n')}
}
`

      this.emitFile({
        id: 'api.ts',
        type: 'asset',
        fileName: 'api.ts',
        source: code
      })
    }
  }
}
