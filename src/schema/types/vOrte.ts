import {
  GraphQLNonNull,
  GraphQLString,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLList,
  GraphQLBoolean,
} from 'graphql'

import { query } from '../mysql'

import { vortKontakt, organisation, veranstaltung } from '.'

export const _vorte = new GraphQLObjectType({
  name: 'vorteType',
  fields: () => ({
    vOrtID: {
      type: new GraphQLNonNull(GraphQLInt),
    },
    veranstaltungen: {
      type: new GraphQLList(veranstaltung),
      resolve(parent) {
        return query(
          `SELECT * FROM veranstaltungen WHERE veranstaltungsort = ${parent.vOrtID} `
        )
      },
    },
    organisation: {
      type: organisation,
      resolve(parent, _, context) {
        return query(
          `SELECT * FROM organisationen WHERE organisationsID = ${parent.organisitationID}`
        ).then((v) => v[0])
      },
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString),
    },
    strasse: {
      type: new GraphQLNonNull(GraphQLString),
    },
    plz: {
      type: new GraphQLNonNull(GraphQLString),
    },
    ort: {
      type: new GraphQLNonNull(GraphQLString),
    },
    land: {
      type: new GraphQLNonNull(GraphQLString),
    },
    notizen: {
      type: GraphQLString,
    },
    anzahl_max: {
      type: GraphQLInt,
    },
    anzahl_min: {
      type: GraphQLInt,
    },
    vollverpflegung: {
      type: GraphQLBoolean,
    },
    selbstversorger: {
      type: GraphQLBoolean,
    },
    kontakte: {
      type: new GraphQLList(vortKontakt),
    },
  }),
})
