/* eslint-disable */

import { readdirSync, statSync } from "fs"
import { join } from "path"

const moduleProto = 'import-folder:'

export default (options) => {
  return {
    name: 'folder-import',
    resolveId(id, importer) {
      if (id.startsWith(moduleProto)) {
        const parts = importer.split(/\\|\//)
        return moduleProto + join(parts.slice(0, parts.length - 1).join('/'), id.slice(moduleProto.length))
      }
    },
    load(id) {
      if (id.startsWith(moduleProto)) {
        const folder = id.slice(moduleProto.length)
        const e = readdirSync(folder).map((f, i) => {
          const obj = join(folder, f).replace(/\\|\//g, '/')

          if (statSync(obj).isFile()) {
            return `
              import file${i} from '${obj}'
              ret.push(file${i})
            `
          } else {
            return `
              import folder${i} from '${moduleProto}${obj}'
              ret.push(...folder${i})
            `
          }
        }).join('\n')

        const code = `
        const ret = []
        ${e}
        export default ret`
        console.log(code)
        return code
      }
    }
  }
}
