import { query } from '../mysql'
import { addAuth, handleAuth } from '../sonstiges'

import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLString
} from 'graphql'

export default {
  serienbriefAdd: {
    type: GraphQLBoolean,
    args: addAuth({
      bezeichnung: {
        type: new GraphQLNonNull(GraphQLString)
      },
      docx: {
        type: new GraphQLNonNull(GraphQLString)
      },
      geschlecht: {
        type: new GraphQLNonNull(GraphQLString)
      }
    }),
    resolve: handleAuth((_, args) => {
      return query(
        `INSERT INTO serienbriefe(bezeichnung, docxDocument, geschlechterspizifischeAttribute) VALUES ("${args.bezeichnung}","${args.docx}","${args.geschlecht}")`
      )
    }, 'serienbrief')
  },
  serienbriefEdit: {
    type: GraphQLBoolean,
    args: addAuth({
      sbID: {
        type: new GraphQLNonNull(GraphQLInt)
      },
      bezeichnung: {
        type: new GraphQLNonNull(GraphQLString)
      },
      docx: {
        type: new GraphQLNonNull(GraphQLString)
      },
      geschlecht: {
        type: new GraphQLNonNull(GraphQLString)
      }
    }),
    resolve: handleAuth((_, args) => {
      return query(
        `UPDATE serienbriefe SET bezeichnung="${args.bezeichnung}", docxDocument="${args.docx}", geschlechterspizifischeAttribute="${args.geschlecht}"`
      )
    }, 'serienbrief')
  }
}
