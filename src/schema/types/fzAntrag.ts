import {
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLInt,
  GraphQLString
} from 'graphql'
import { date } from '.'

export const _fzAntrag = new GraphQLObjectType({
  name: 'fzAntrag',
  fields: () => ({
    fzAntragID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    erzeugt: {
      type: date
    },
    erzeugt_durch: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})
