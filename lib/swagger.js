/* eslint-disable */
import swaggerJSDoc from 'swagger-jsdoc'

const moduleID = 'swagger-config'

export default (options) => {
  return {
    name: 'swagger',
    resolveId(id) {
      if (moduleID === id) {
        return id
      }
    },
    load(id) {
      if (moduleID === id) {
        return `export default ${JSON.stringify(swaggerJSDoc(options))}`
      }
    }
  }
}
