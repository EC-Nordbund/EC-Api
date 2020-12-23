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

        let nPath = "${APIURL}" + path

        for (let i = 0; i < params.length; i++) {
          nPath = nPath.replace(
            params[i],
            '${pathParams.' + params[i].slice(1) + '}'
          )
        }

        apiMethods.push(
          `${doc
            .split('\n')
            .map((v) => v.trim())
            .join('\n')}\nexport function ${/@name\s([a-zA-Z]*)/.exec(doc)?.[1] || path.replace(/\\|\/|:/g, '_')
          }(${pathParams === 'emptyObj' ? '' : `pathParams: ${pathParams}, `}${reqBody === 'emptyObj' ? '' : `bodyParams: ${reqBody}`
          }):Promise<${resBody}> {\n  return fetch(\n    \`${nPath}\`,\n    {\n      method: '${method}',\n      headers: { 'content-type': 'application/json'${doc.indexOf('@noauth') === -1
            ? ', authorization: getAuthToken()'
            : ''
          } }${reqBody === 'emptyObj' ? '' : ',\n      body: JSON.stringify(bodyParams)'
          }\n    }\n  ).then(errorHandler)\n}`
        )
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
  return res.json()
}
const APIURL = 'https://api.ec-nordbund.de'
type emptyObj = Record<string, never>\n` + apiMethods.join('\n')
      })
    }
  }
}
