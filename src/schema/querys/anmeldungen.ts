import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
} from 'graphql'
import { query } from '../mysql'
import { anmeldung } from '../types'

const wpTokens: Array<string> = [process.env.WP_TOKEN || '']

import { addAuth, handleAuth } from '../sonstiges'
import { checkToken } from '../../users/jwt'

export default {
  anmeldungen: {
    args: addAuth({}),
    type: new GraphQLList(anmeldung),
    resolve: handleAuth(() => {
      return query(`SELECT * FROM anmeldungen`)
    }),
  },
  anmeldung: {
    args: addAuth({
      anmeldeID: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    type: anmeldung,
    resolve: handleAuth((_, args) => {
      return query(
        `SELECT * FROM anmeldungen WHERE anmeldeID = '${args.anmeldeID}'`
      ).then((res) => res[0])
    }),
  },
  anmeldeStatus: {
    type: new GraphQLNonNull(GraphQLInt),
    args: addAuth({
      anmeldeID: {
        type: new GraphQLNonNull(GraphQLString),
      },
      isWP: {
        type: new GraphQLNonNull(GraphQLBoolean),
      },
    }),
    async resolve(_, args) {
      let allowed = false
      if (args.isWP) {
        allowed = wpTokens.indexOf(args.authToken) !== -1
      } else {
        allowed = !!(await checkToken(args.authToken))
      }

      if (allowed) {
        const result = query(
          `SELECT wartelistenPlatz, abmeldeZeitpunkt FROM anmeldungen WHERE anmeldeID='${args.anmeldeID}'`
        )

        if (result[0].abmeldeZeitpunkt) {
          return -2
        }

        return result[0].wartelistenPlatz
      } else {
        return -1
      }
    },
  },
}
