import { ESLint } from 'eslint'

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

        apiMethods.push(
          `${doc}\n${/@name\s([a-zA-Z]*)/.exec(doc)?.[1] || path.replace(/\\|\/|:/g, '_')
          }(${pathParams === 'emptyObj' ? '' : `pathParams: ${pathParams}, `}${reqBody === 'emptyObj' ? '' : `bodyParams: ${reqBody}`
          }):Promise<${resBody}>{return fetch(\`${nPath}\`,{method: '${method}',headers: {'content-type': 'application/json'${doc.indexOf('@noauth') === -1
            ? ',authorization: this.getAuthToken()'
            : ''
          }}${reqBody === 'emptyObj' ? '' : ',body: JSON.stringify(bodyParams)'
          }}).then(this.errorHandler)\n  }`
        )
      } while (m)
    },
    async generateBundle() {
      const code = `import Vue from 'vue'

type emptyObj = Record<string, never>\n\n
export class api {
  constructor(private url: string) {}

  private getAuthToken(): string {
    return Vue.prototype.$authToken
  }

  private async errorHandler(res: Response) {
    if (res.status !== 200) throw await res.text()
    return res.json()
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
