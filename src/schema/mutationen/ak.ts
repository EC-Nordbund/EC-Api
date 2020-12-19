import { query } from '../mysql'
import { addAuth, handleAuth } from '../sonstiges'

import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLString
} from 'graphql'

export default {
  addAK: {
    type: new GraphQLNonNull(GraphQLInt),

    args: addAuth({
      bezeichnung: {
        type: new GraphQLNonNull(GraphQLString)
      }
    }),
    resolve: handleAuth(async function (_, args) {
      await query(`INSERT INTO ak (bezeichnung) VALUES ('${args.bezeichnung}')`)
      const ak = await query(
        `SELECT akID FROM ak WHERE bezeichnung = '${args.bezeichnung}'`
      )
      return ak[0].akID
    })
  },
  editAK: {
    type: GraphQLBoolean,

    args: addAuth({
      akID: {
        type: new GraphQLNonNull(GraphQLInt)
      },
      bezeichnung: {
        type: new GraphQLNonNull(GraphQLString)
      }
    }),
    resolve: handleAuth(async function (_, args) {
      await query(
        `UPDATE ak SET bezeichnung = '${args.bezeichnung}' WHERE akID = ${args.akID}`
      )
      return true
    })
  },
  updateAKStatus: {
    type: GraphQLBoolean,
    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt)
      },
      akID: {
        type: new GraphQLNonNull(GraphQLInt)
      },
      date: {
        type: new GraphQLNonNull(GraphQLString)
      },
      status: {
        type: new GraphQLNonNull(GraphQLInt)
      }
    }),
    resolve: handleAuth((_, args) => {
      return query(
        `INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${args.personID}, ${args.akID}, '${args.date}', ${args.status})`
      )
    })
  }
}
