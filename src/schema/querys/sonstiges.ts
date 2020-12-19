import {
  GraphQLList,
  GraphQLString,
  GraphQLBoolean,
  GraphQLNonNull
} from 'graphql'

import { alert } from '../types'
import { query } from '../mysql'

export default {
  alerts: {
    type: new GraphQLList(alert),
    description: 'Gibt liste der Letzten 10 Alerts aus.',
    resolve() {
      return query('SELECT * from alertWidget ORDER BY alertID DESC LIMIT 10')
    }
  }
}
