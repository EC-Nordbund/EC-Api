import { query } from '../mysql';
import {
  adresse,
  email,
  person,
  telefon,
  timeStamp,
  veranstaltung
} from '.';
import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString
} from 'graphql';

export const _anmeldung = new GraphQLObjectType({
  name: 'anmeldung',
  fields: () => ({
    anmeldeID: {
      type: new GraphQLNonNull(GraphQLString),
    },
    person: {
      type: new GraphQLNonNull(person),
      async resolve(parent) {
        const person = await query(`SELECT * FROM personen WHERE personID = ${parent.personID}`)
        return person[0]
      },
    },
    veranstaltung: {
      type: new GraphQLNonNull(veranstaltung),
      async resolve(parent) {
        const veranstaltung = await query(`SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${parent.veranstaltungsID}`)
        return veranstaltung[0]
      },
    },
    position: {
      type: new GraphQLNonNull(GraphQLInt),
    },
    adresse: {
      type: new GraphQLNonNull(adresse),
      async resolve(parent) {
        const adresse = await query(`SELECT * FROM adressen WHERE adressID = ${parent.adressID}`)
        return adresse[0]
      },
    },
    email: {
      type: new GraphQLNonNull(email),
      async resolve(parent) {
        const email = await query(`SELECT * FROM eMails WHERE eMailID = ${parent.eMailID}`)
        return email[0]
      },
    },
    telefon: {
      type: new GraphQLNonNull(telefon),
      async resolve(parent) {
        const telefon = await query(`SELECT * FROM telefone WHERE telefonID = ${parent.telefonID}`)
        return telefon[0]
      },
    },
    wartelistenPlatz: {
      type: new GraphQLNonNull(GraphQLInt),
    },
    bisherBezahlt: {
      type: new GraphQLNonNull(GraphQLFloat)
    },
    anmeldeZeitpunkt: {
      type: new GraphQLNonNull(timeStamp),
    },
    abmeldeZeitpunkt: {
      type: timeStamp,
    },
    abmeldeGebuehr: {
      type: GraphQLInt
    },
    wegDerAbmeldung: {
      type: GraphQLString
    },
    rueckbezahlt: {
      type: GraphQLFloat
    },
    kommentarAbmeldung: {
      type: GraphQLString
    },
    vegetarisch: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    lebensmittelAllergien: {
      type: new GraphQLNonNull(GraphQLString)
    },
    gesundheitsinformationen: {
      type: new GraphQLNonNull(GraphQLString)
    },
    bemerkungen: {
      type: new GraphQLNonNull(GraphQLString)
    },
    radfahren: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    fahrgemeinschaften: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    klettern: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    sichEntfernen: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    bootFahren: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    schwimmen: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    DSGVO_einverstaendnis: {
      type: new GraphQLNonNull(timeStamp),
    },
    infoBrief: {
      type: timeStamp,
    },
    bestaetigungsBrief: {
      type: timeStamp,
    },
    extra_json: {
      type: new GraphQLNonNull(GraphQLString),
    },
  }),
})
