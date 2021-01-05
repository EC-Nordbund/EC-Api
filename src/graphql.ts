import { createFZ } from './helpers/fz'
import sql from 'sql-escape-tag'
import sendMail from './helpers/mail'
import { getMySQL, query } from './helpers/mysql'
import { addAuth, handleAuth } from './helpers/sonstiges'
import { checkToken } from './helpers/jwt'

const wpTokens: Array<string> = [process.env.WP_TOKEN || '']
import {
  GraphQLBoolean,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLFloat,
  GraphQLInt,
  GraphQLString,
  GraphQLList
} from 'graphql'
import { versions } from './config/nichtErlaubteVersionen'
import { changePWD, login } from './users/users'
import mail from './helpers/mail'

const ak = new GraphQLObjectType({
  name: 'ak',
  fields: () => ({
    akID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    personen: {
      type: new GraphQLList(personAK),
      async resolve(parent) {
        const persons = await query(
          `SELECT personID FROM akPerson WHERE akID = ${parent.akID} GROUP BY personID`
        )
        return persons.map((person) => ({
          personID: person.personID,
          akID: parent.akID
        }))
      }
    }
  })
})

const adresse = new GraphQLObjectType({
  name: 'adresse',
  fields: () => ({
    adressID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    strasse: {
      type: new GraphQLNonNull(GraphQLString)
    },
    plz: {
      type: new GraphQLNonNull(GraphQLString)
    },
    ort: {
      type: new GraphQLNonNull(GraphQLString)
    },
    isOld: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    lastUsed: {
      type: new GraphQLNonNull(timestamp)
    }
  })
})

const akStatus = new GraphQLObjectType({
  name: 'akStatus',
  fields: () => ({
    akPersonID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    person: {
      type: new GraphQLNonNull(person),
      async resolve(parent) {
        const person = await query(
          `SELECT * FROM personen WHERE personID = ${parent.personID}`
        )
        return person[0]
      }
    },
    ak: {
      type: new GraphQLNonNull(ak),
      async resolve(parent) {
        const ak = await query(`SELECT * FROM ak WHERE akID = ${parent.akID}`)
        return ak[0]
      }
    },
    date: {
      type: new GraphQLNonNull(date)
    },
    neuerStatus: {
      type: new GraphQLNonNull(GraphQLInt)
    }
  })
})

const anmeldung = new GraphQLObjectType({
  name: 'anmeldung',
  fields: () => ({
    anmeldeID: {
      type: new GraphQLNonNull(GraphQLString)
    },
    person: {
      type: new GraphQLNonNull(person),
      async resolve(parent) {
        const person = await query(
          `SELECT * FROM personen WHERE personID = ${parent.personID}`
        )
        return person[0]
      }
    },
    veranstaltung: {
      type: new GraphQLNonNull(veranstaltung),
      async resolve(parent) {
        const veranstaltung = await query(
          `SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${parent.veranstaltungsID}`
        )
        return veranstaltung[0]
      }
    },
    position: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    adresse: {
      type: new GraphQLNonNull(adresse),
      async resolve(parent) {
        const adresse = await query(
          `SELECT * FROM adressen WHERE adressID = ${parent.adressID}`
        )
        return adresse[0]
      }
    },
    email: {
      type: new GraphQLNonNull(email),
      async resolve(parent) {
        const email = await query(
          `SELECT * FROM eMails WHERE eMailID = ${parent.eMailID}`
        )
        return email[0]
      }
    },
    telefon: {
      type: new GraphQLNonNull(telefon),
      async resolve(parent) {
        const telefon = await query(
          `SELECT * FROM telefone WHERE telefonID = ${parent.telefonID}`
        )
        return telefon[0]
      }
    },
    wartelistenPlatz: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bisherBezahlt: {
      type: new GraphQLNonNull(GraphQLFloat)
    },
    anmeldeZeitpunkt: {
      type: new GraphQLNonNull(timestamp)
    },
    abmeldeZeitpunkt: {
      type: timestamp
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
      type: new GraphQLNonNull(timestamp)
    },
    infoBrief: {
      type: timestamp
    },
    bestaetigungsBrief: {
      type: timestamp
    },
    extra_json: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const gb = (v) => (v < 10 ? '0' + v : v)

const date = new GraphQLObjectType({
  name: 'DateType',

  fields: () => ({
    day: {
      type: new GraphQLNonNull(GraphQLInt),

      resolve(val: Date) {
        return val.getDate()
      }
    },
    month: {
      type: new GraphQLNonNull(GraphQLInt),

      resolve(val: Date) {
        return val.getMonth() + 1
      }
    },
    year: {
      type: new GraphQLNonNull(GraphQLInt),

      resolve(val: Date) {
        return val.getFullYear()
      }
    },
    german: {
      type: new GraphQLNonNull(GraphQLString),

      resolve(val: Date) {
        return `${gb(val.getDate())}.${gb(
          val.getMonth() + 1
        )}.${val.getFullYear()}`
      }
    },
    input: {
      type: new GraphQLNonNull(GraphQLString),

      resolve(val: Date) {
        return `${val.getFullYear()}-${gb(val.getMonth() + 1)}-${gb(
          val.getDate()
        )}`
      }
    }
  })
})

const ecKreis = new GraphQLObjectType({
  name: 'ecKreis',
  fields: () => ({
    ecKreisID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    website: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const email = new GraphQLObjectType({
  name: 'email',
  fields: () => ({
    eMailID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    eMail: {
      type: new GraphQLNonNull(GraphQLString)
    },
    isOld: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    lastUsed: {
      type: new GraphQLNonNull(timestamp)
    }
  })
})

const fz = new GraphQLObjectType({
  name: 'fz',
  fields: () => ({
    fzID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    gesehenVon: {
      type: new GraphQLNonNull(person),
      async resolve(parent) {
        const person = await query(
          `SELECT * FROM personen WHERE personID = ${parent.gesehenVon}`
        )
        return person[0]
      }
    },
    fzVon: {
      type: new GraphQLNonNull(date)
    },
    gesehenAm: {
      type: new GraphQLNonNull(date)
    },
    kommentar: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const fzAntrag = new GraphQLObjectType({
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

const juleica = new GraphQLObjectType({
  name: 'juleica',
  fields: () => ({
    juleicanummer: {
      type: new GraphQLNonNull(GraphQLString)
    },
    gueltig_bis: {
      type: date
    }
  })
})

const organisationen = new GraphQLObjectType({
  name: 'oraType',
  fields: () => ({
    organisationsID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    ansprechpartner: {
      type: GraphQLString
    },
    vOrte: {
      type: new GraphQLList(vorte),
      async resolve(parent) {
        return await query(
          `SELECT * FROM vOrte WHERE organisitationID = ${parent.organisationsID}`
        )
      }
    },
    strasse: {
      type: GraphQLString
    },
    plz: {
      type: GraphQLString
    },
    ort: {
      type: GraphQLString
    },
    land: {
      type: GraphQLString
    },
    telefon: {
      type: GraphQLString
    },
    email: {
      type: GraphQLString
    },
    notizen: {
      type: GraphQLString
    }
  })
})

const person = new GraphQLObjectType({
  name: 'person',
  fields: () => ({
    personID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    vorname: {
      type: new GraphQLNonNull(GraphQLString)
    },
    nachname: {
      type: new GraphQLNonNull(GraphQLString)
    },
    gebDat: {
      type: new GraphQLNonNull(date)
    },
    geschlecht: {
      type: new GraphQLNonNull(GraphQLString)
    },
    alter: {
      type: new GraphQLNonNull(GraphQLInt),
      args: {
        wann: {
          type: GraphQLString
        }
      },
      resolve(parent: { gebDat: Date }, args) {
        if (args.wann === null) {
          args.wann = `${new Date().getFullYear()}-${
            new Date().getMonth() + 1
          }-${new Date().getDate()}`
        }

        const older: Date = parent.gebDat
        const newer: Date = new Date(args.wann)

        const tmpDate = newer.getFullYear() - older.getFullYear()

        const tmpGebDatArr = args.wann.split('-')
        tmpGebDatArr[0] -= tmpDate

        const tmpGebDat = new Date(tmpGebDatArr.join('-'))

        if (tmpGebDat < older) {
          return tmpDate - 1
        } else {
          return tmpDate
        }
      }
    },
    adressen: {
      type: new GraphQLList(adresse),
      resolve(parent: any) {
        return query(
          `SELECT * FROM adressen WHERE personID = ${parent.personID}`
        )
      }
    },
    emails: {
      type: new GraphQLList(email),
      resolve(parent: any) {
        return query(`SELECT * FROM eMails WHERE personID = ${parent.personID}`)
      }
    },
    telefone: {
      type: new GraphQLList(telefon),
      resolve(parent: any) {
        return query(
          `SELECT * FROM telefone WHERE personID = ${parent.personID}`
        )
      }
    },
    anmeldungen: {
      type: new GraphQLList(anmeldung),
      resolve(parent: any) {
        return query(
          `SELECT * FROM anmeldungen WHERE personID = ${parent.personID}`
        )
      }
    },
    fzs: {
      type: new GraphQLList(fz),
      resolve(parent: any) {
        return query(`SELECT * FROM fz WHERE personID = ${parent.personID}`)
      }
    },
    fzAntraege: {
      type: new GraphQLList(fzAntrag),
      resolve(parent: any) {
        return query(
          `SELECT * FROM fzAntrag WHERE personID = ${parent.personID}`
        )
      }
    },
    datumDesLetztenFZ: {
      type: date,
      resolve(parent: any) {
        return query(
          `SELECT fzVon FROM fz WHERE personID = ${parent.personID} ORDER BY gesehenAm DESC LIMIT 1`
        ).then((rows) => {
          if (rows.length === 0) {
            return null
          } else {
            return rows[0].fzVon
          }
        })
      }
    },
    hatFZ: {
      type: new GraphQLNonNull(GraphQLBoolean),
      args: {
        wann: {
          type: GraphQLString
        }
      },
      resolve(parent: any, args) {
        if (args.wann === null) {
          args.wann = `${new Date().getFullYear()}-${
            new Date().getMonth() + 1
          }-${new Date().getDate()}`
        }
        return query(
          `SELECT gesehenAm  FROM fz WHERE personID = ${parent.personID} ORDER BY gesehenAm DESC LIMIT 1`
        )
          .then((rows) => {
            if (rows.length === 0) {
              return null
            } else {
              return rows[0].gesehenAm
            }
          })
          .then((fzDate) => {
            const wannArr = args.wann.split('-')
            wannArr[0] -= 5
            return fzDate > new Date(wannArr.join('-'))
          })
      }
    },
    ecKreis: {
      type: ecKreis,
      resolve(parent: any) {
        if (parent.ecKreis === null) {
          return null
        } else {
          return query(
            `SELECT * FROM ecKreis WHERE ecKreisID = ${parent.ecKreis}`
          ).then((rows) => rows[0])
        }
      }
    },
    ecMitglied: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    juleica: {
      type: new GraphQLList(juleica),
      resolve(parent: any) {
        return query(
          `SELECT * FROM juleica WHERE personID = ${parent.personID}`
        )
      }
    },
    tags: {
      type: new GraphQLList(personTag),
      resolve(parent: any) {
        return query(
          `SELECT * FROM tagsPersonen WHERE personID = ${parent.personID}`
        )
      }
    },
    ak: {
      type: new GraphQLList(personAK),
      resolve(parent: any) {
        return query(
          `SELECT akID FROM akPerson WHERE personID = ${parent.personID} GROUP BY akID`
        ).then((v) =>
          v.map((el) => ({
            akID: el.akID,
            personID: parent.personID
          }))
        )
      }
    },
    bisherigeRollen: {
      type: new GraphQLList(GraphQLInt),
      resolve(parent: any) {
        return query(
          `SELECT DISTINCT position FROM anmeldungen WHERE personID = ${parent.personID}`
        )
      }
    },
    Notizen: {
      type: new GraphQLNonNull(GraphQLString)
    },
    erstellt: {
      type: new GraphQLNonNull(timestamp)
    },
    letzteAenderung: {
      type: new GraphQLNonNull(timestamp)
    }
  })
})

const personAK = new GraphQLObjectType({
  name: 'personenAK',
  fields: () => ({
    ak: {
      type: ak,
      resolve(parent: { akID: number; personID: number }) {
        return query(`SELECT * FROM ak WHERE akID = ${parent.akID}`).then(
          (v) => v[0]
        )
      }
    },
    person: {
      type: person,
      resolve(parent: { akID: number; personID: number }) {
        return query(
          `SELECT * FROM personen WHERE personID = ${parent.personID}`
        ).then((v) => v[0])
      }
    },
    currentStatus: {
      type: new GraphQLNonNull(GraphQLInt),
      resolve(parent) {
        return query(
          `SELECT neuerStatus FROM akPerson WHERE akID = ${parent.akID} AND personID = ${parent.personID} ORDER BY date DESC LIMIT 1`
        ).then((v) => v[0].neuerStatus)
      }
    },
    allUpdates: {
      type: new GraphQLList(akStatus),
      resolve(parent) {
        return query(
          `SELECT * FROM akPerson WHERE akID = ${parent.akID} AND personID = ${parent.personID}`
        )
      }
    }
  })
})

const tag = new GraphQLObjectType({
  name: 'tag',
  fields: () => ({
    tagID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const personTag = new GraphQLObjectType({
  name: 'personenTag',
  fields: () => ({
    tag: {
      type: tag,
      resolve(parent: { tagID: number; personID: number }) {
        return query(`SELECT * FROM tag WHERE tagID = ${parent.tagID}`).then(
          (v) => v[0]
        )
      }
    },
    person: {
      type: person,
      resolve(parent: { tagID: number; personID: number }) {
        return query(
          `SELECT * FROM personen WHERE personID = ${parent.personID}`
        ).then((v) => v[0])
      }
    },
    notiz: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const telefon = new GraphQLObjectType({
  name: 'telefon',

  fields: () => ({
    telefonID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    telefon: {
      type: new GraphQLNonNull(GraphQLString)
    },
    isOld: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    lastUsed: {
      type: new GraphQLNonNull(timestamp)
    }
  })
})

const timestamp = new GraphQLObjectType({
  name: 'TimeStampType',
  fields: () => ({
    day: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getDate()
        } else {
          return null
        }
      }
    },
    month: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getMonth() + 1
        } else {
          return null
        }
      }
    },
    year: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getFullYear()
        } else {
          return null
        }
      }
    },
    h: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getHours()
        } else {
          return null
        }
      }
    },
    min: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getMinutes()
        } else {
          return null
        }
      }
    },
    s: {
      type: GraphQLInt,
      resolve(val: Date) {
        if (val instanceof Date) {
          return val.getSeconds()
        } else {
          return null
        }
      }
    },
    german: {
      type: GraphQLString,
      resolve(val: Date) {
        if (val instanceof Date) {
          return `${gb(val.getDate())}.${gb(
            val.getMonth() + 1
          )}.${val.getFullYear()} - ${gb(val.getHours())}:${gb(
            val.getMinutes()
          )}`
        } else {
          return null
        }
      }
    }
  })
})

const user = new GraphQLObjectType({
  name: 'user',
  fields: () => ({
    userID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    userName: {
      type: new GraphQLNonNull(GraphQLString),
      resolve(_) {
        return _.userName || _.username
      }
    },
    person: {
      type: new GraphQLNonNull(person),
      resolve(_) {
        return query(
          `SELECT * FROM personen WHERE personID = ${_.personID}`
        ).then((v) => v[0])
      }
    },
    ablaufDatum: {
      type: new GraphQLNonNull(date),
      resolve(_) {
        return new Date(_.ablaufDatum)
      }
    }
  })
})

const veranstaltung = new GraphQLObjectType({
  name: 'veranstaltung',
  fields: () => ({
    veranstaltungsID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    kurzBezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    hauptleiter: {
      type: anmeldung,
      resolve(parent) {
        return query(
          `SELECT * FROM anmeldungen WHERE veranstaltungsID = ${parent.veranstaltungsID} AND position = 6`
        ).then((v: any) => v[0] || null)
      }
    },
    anmeldungen: {
      type: new GraphQLList(anmeldung),
      resolve(parent) {
        return query(
          `SELECT * FROM anmeldungen WHERE veranstaltungsID = ${parent.veranstaltungsID} ORDER BY anmeldeZeitpunkt`
        )
      }
    },
    veranstaltungsort: {
      type: new GraphQLNonNull(vorte),
      resolve(parent) {
        return query(
          `SELECT * FROM vOrte WHERE vOrtID = ${parent.veranstaltungsort}`
        ).then((v) => v[0])
      }
    },
    begin: {
      type: new GraphQLNonNull(date)
    },
    ende: {
      type: date
    },
    minTNAlter: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    maxTNAlter: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    anzahlPlaetze: {
      type: new GraphQLNonNull(GraphQLInt),
      resolve(parent) {
        return parent.anzahlPlätze
      }
    },
    anzahlPlaetzeW: {
      type: new GraphQLNonNull(GraphQLInt),
      resolve(parent) {
        return parent.anzahlPlätzeWeiblich
      }
    },
    anzahlPlaetzeM: {
      type: new GraphQLNonNull(GraphQLInt),
      resolve(parent) {
        return parent.anzahlPlätzeMännlich
      }
    },
    preisFruehbucher: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    preisNormal: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    preisLastMinute: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    preisAnzahlungNormal: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    preisAnzahlungFruehbucher: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    preisAnzahlungLastMinute: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    fruehbucherBis: {
      type: date
    },
    lastMinuteAb: {
      type: date
    },
    kannVorortBezahltWerden: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    hatGWarteliste: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    xlsxZuschuesse: {
      type: new GraphQLNonNull(GraphQLString)
    },
    xlsxLeiter: {
      type: new GraphQLNonNull(GraphQLString)
    },
    xlsxMitarbeiter: {
      type: new GraphQLNonNull(GraphQLString)
    },
    xlsxKueche: {
      type: new GraphQLNonNull(GraphQLString)
    },
    infoBrief: {
      type: new GraphQLNonNull(GraphQLString)
    },
    infoBriefGeschlecht: {
      type: new GraphQLNonNull(GraphQLString)
    },
    bestaetigungsBrief: {
      type: new GraphQLNonNull(GraphQLString)
    },
    bestaetigungsBriefGeschlecht: {
      type: new GraphQLNonNull(GraphQLString)
    }
  })
})

const vorte = new GraphQLObjectType({
  name: 'vorteType',
  fields: () => ({
    vOrtID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    veranstaltungen: {
      type: new GraphQLList(veranstaltung),
      resolve(parent) {
        return query(
          `SELECT * FROM veranstaltungen WHERE veranstaltungsort = ${parent.vOrtID} `
        )
      }
    },
    organisation: {
      type: organisationen,
      resolve(parent) {
        return query(
          `SELECT * FROM organisationen WHERE organisationsID = ${parent.organisitationID}`
        ).then((v) => v[0])
      }
    },
    bezeichnung: {
      type: new GraphQLNonNull(GraphQLString)
    },
    strasse: {
      type: new GraphQLNonNull(GraphQLString)
    },
    plz: {
      type: new GraphQLNonNull(GraphQLString)
    },
    ort: {
      type: new GraphQLNonNull(GraphQLString)
    },
    land: {
      type: new GraphQLNonNull(GraphQLString)
    },
    notizen: {
      type: GraphQLString
    },
    anzahl_max: {
      type: GraphQLInt
    },
    anzahl_min: {
      type: GraphQLInt
    },
    vollverpflegung: {
      type: GraphQLBoolean
    },
    selbstversorger: {
      type: GraphQLBoolean
    },
    kontakte: {
      type: new GraphQLList(vortKontakt)
    }
  })
})

const vortKontakt = new GraphQLObjectType({
  name: 'vOrtKontakt',
  fields: () => ({
    vOrtKontaktID: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    ansprechpartner: {
      type: new GraphQLNonNull(GraphQLString)
    },
    typ: {
      type: GraphQLString
    },
    telefon: {
      type: GraphQLString
    },
    email: {
      type: GraphQLString
    },
    notizen: {
      type: GraphQLString
    }
  })
})

export const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'rootQuery',

    fields: {
      ecKreise: {
        args: addAuth({}),
        type: new GraphQLList(ecKreis),
        resolve: handleAuth(() => query(`SELECT * FROM ecKreis`))
      },
      personen: {
        args: addAuth(),
        type: new GraphQLList(person),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM personen`)
        })
      },
      person: {
        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        type: person,
        resolve: handleAuth((_, args) => {
          return query(
            `SELECT * FROM personen WHERE personID = ${args.personID}`
          ).then((res) => res[0])
        })
      },
      veranstaltungen: {
        args: addAuth(),
        type: new GraphQLList(veranstaltung),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM veranstaltungen`)
        })
      },
      veranstaltung: {
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der Veranstaltungen'
          }
        }),
        type: veranstaltung,

        resolve: handleAuth((_, args) => {
          return query(
            `SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${args.veranstaltungsID}`
          ).then((res) => res[0])
        })
      },
      aks: {
        args: addAuth(),

        type: new GraphQLList(ak),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM ak`)
        })
      },
      ak: {
        args: addAuth({
          akID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),

        type: ak,
        resolve: handleAuth((_, args) => {
          return query(`SELECT * FROM ak WHERE akID = ${args.akID}`).then(
            (res) => res[0]
          )
        })
      },
      anmeldungen: {
        args: addAuth({}),
        type: new GraphQLList(anmeldung),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM anmeldungen`)
        })
      },
      anmeldung: {
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        type: anmeldung,
        resolve: handleAuth((_, args) => {
          return query(
            `SELECT * FROM anmeldungen WHERE anmeldeID = '${args.anmeldeID}'`
          ).then((res) => res[0])
        })
      },
      anmeldeStatus: {
        type: new GraphQLNonNull(GraphQLInt),
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          },
          isWP: {
            type: new GraphQLNonNull(GraphQLBoolean)
          }
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
        }
      },
      getMyUserData: {
        type: user,
        args: addAuth(),

        resolve(_, args) {
          return checkToken(args.authToken)
        }
      },
      vorte: {
        args: addAuth(),
        type: new GraphQLList(vorte),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM vOrte`)
        })
      },
      vort: {
        args: addAuth({
          vOrtID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der vorteen'
          }
        }),
        type: vorte,

        resolve: handleAuth((_, args) => {
          return query(
            `SELECT * FROM vOrte WHERE vOrtID = ${args.vOrtID}`
          ).then((res) => res[0])
        })
      },
      orgas: {
        args: addAuth(),
        type: new GraphQLList(organisationen),
        resolve: handleAuth(() => {
          return query(`SELECT * FROM organisationen`)
        })
      },
      orga: {
        args: addAuth({
          organisationsID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der vorteen'
          }
        }),
        type: organisationen,

        resolve: handleAuth((_, args) => {
          return query(
            `SELECT * FROM organisationen WHERE organisationsID = ${args.organisationsID}`
          ).then((res) => res[0])
        })
      }
    }
  }),
  mutation: new GraphQLObjectType({
    name: 'mutationRoot',

    fields: {
      addAK: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async function (_, args) {
          await query(
            `INSERT INTO ak (bezeichnung) VALUES ('${args.bezeichnung}')`
          )
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
            `INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${args.personID}, ${args.akID})`
          )
        })
      },
      logIn: {
        type: new GraphQLNonNull(GraphQLString),

        args: {
          username: {
            type: new GraphQLNonNull(GraphQLString)
          },
          password: {
            type: new GraphQLNonNull(GraphQLString)
          },
          version: {
            type: new GraphQLNonNull(GraphQLString)
          }
        },
        resolve(_, args) {
          if (versions.includes(args.version)) {
            throw 'Version nicht erlaubt'
          }
          return login(args.username, args.password)
        }
      },
      passwordWechseln: {
        type: GraphQLBoolean,

        args: addAuth({
          oldPWD: {
            type: new GraphQLNonNull(GraphQLString)
          },
          newPWD: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        async resolve(_, args) {
          return changePWD(args.authToken, args.oldPWD, args.newPWD)
        }
      },
      feedback: {
        type: GraphQLBoolean,

        args: {
          gesamt: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          handhabung: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          funktionswunsch: {
            type: new GraphQLNonNull(GraphQLString)
          },
          bug: {
            type: new GraphQLNonNull(GraphQLString)
          },
          sonstiges: {
            type: new GraphQLNonNull(GraphQLString)
          }
        },
        resolve(_, args) {
          return mail(
            'feedback@ec-nordbund.de',
            { to: 'app@ec-nordbund.de' },
            'Feedback',
            `Gesamtbewertung: ${args.gesamt}/5<br/>
          Handhabung: ${args.handhabung}/5<br/>
          Funktionswunsch: ${args.funktionswunsch}<br/>
          Bug: ${args.bug}<br/>
          Sonstiges: ${args.sonstiges}`
          )
        }
      },
      useAdresse: {
        type: GraphQLBoolean,

        args: addAuth({
          adressID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Adresse'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE adressen SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${args.adressID}`
          )
        })
      },
      markAdressAsOld: {
        type: GraphQLBoolean,

        args: addAuth({
          adressID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Adresse'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE adressen SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${args.adressID}`
          )
        })
      },
      useEmail: {
        type: GraphQLBoolean,

        args: addAuth({
          emailID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Email'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE eMails SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${args.emailID}`
          )
        })
      },
      markEmailAsOld: {
        type: GraphQLBoolean,

        args: addAuth({
          emailID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Email'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE eMails SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${args.emailID}`
          )
        })
      },
      useTelefon: {
        type: GraphQLBoolean,

        args: addAuth({
          telefonID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Telfonnummer'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE telefone SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${args.telefonID}`
          )
        })
      },
      markTelefonAsOld: {
        type: GraphQLBoolean,

        args: addAuth({
          telefonID: {
            type: new GraphQLNonNull(GraphQLInt),
            description: 'ID der benutzen Telfonnummer'
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE telefone SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${args.telefonID}`
          )
        })
      },
      addAdresse: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          strasse: {
            type: new GraphQLNonNull(GraphQLString)
          },
          plz: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ort: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`INSERT INTO adressen (personID, strasse, plz, ort) VALUES (${args.personID}, ${args.strasse}, ${args.plz}, ${args.ort})`
          )

          const adresse = await query(
            sql`SELECT adressID FROM adressen WHERE personID = ${args.personID} AND strasse = ${args.strasse} AND plz = ${args.plz} AND ort = ${args.ort}`
          )

          return adresse[0].adressID
        })
      },
      addEmail: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          email: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`INSERT INTO eMails (personID, eMail) VALUES (${args.personID}, ${args.email})`
          )
          const email = await query(
            sql`SELECT eMailID FROM eMails WHERE personID = ${args.personID} AND eMail = ${args.email}`
          )

          return email[0].eMailID
        })
      },
      addTelefon: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          telefon: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`INSERT INTO telefone (personID, telefon) VALUES (${args.personID}, ${args.telefon})`
          )

          const telefon = await query(
            sql`SELECT telefonID FROM telefone WHERE personID = ${args.personID} AND telefon = ${args.telefon}`
          )

          return telefon[0].telefonID
        })
      },
      editAdresse: {
        type: GraphQLBoolean,

        args: addAuth({
          adressID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          strasse: {
            type: new GraphQLNonNull(GraphQLString)
          },
          plz: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ort: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`UPDATE adressen SET strasse = ${args.strasse}, plz = ${args.plz}, ort = ${args.ort} WHERE adressID = ${args.adressID}`
          )

          return true
        })
      },
      editEmail: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          emailID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          email: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`UPDATE eMails SET eMail = ${args.email} WHERE eMailID=${args.emailID}`
          )

          return true
        })
      },
      editTelefon: {
        type: new GraphQLNonNull(GraphQLInt),

        args: addAuth({
          telefonID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          telefon: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`UPDATE telefone SET telefon = ${args.telefon} WHERE telefonID=${args.telefonID}`
          )

          return true
        })
      },
      deleteAdresse: {
        type: GraphQLBoolean,

        args: addAuth({
          adressID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(`DELETE FROM adressen WHERE adressID = ${args.adressID}`)
        })
      },
      deleteEMail: {
        type: GraphQLBoolean,

        args: addAuth({
          emailID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(`DELETE FROM eMails WHERE eMailID = ${args.emailID}`)
        })
      },
      deleteTelefon: {
        type: GraphQLBoolean,

        args: addAuth({
          telefonID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `DELETE FROM telefone WHERE telefonID = ${args.telefonID}`
          )
        })
      },
      mergeAdresse: {
        type: GraphQLBoolean,

        args: addAuth({
          adressID_richtig: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          adressID_falsch: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            `UPDATE anmeldungen SET adressID = ${args.adressID_richtig} WHERE adressID = ${args.adressID_falsch}`
          )
          await query(`DELETE adresse WHERE adressID = ${args.adressID_falsch}`)
        })
      },
      mergeTelefon: {
        type: GraphQLBoolean,

        args: addAuth({
          telefonID_richtig: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          telefonID_falsch: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            `UPDATE anmeldungen SET telefonID = ${args.telefonID_richtig} WHERE telefonID = ${args.telefonID_falsch}`
          )
          await query(
            `DELETE telefone WHERE telefonID = ${args.telefonID_falsch}`
          )
        })
      },
      editPersonStamm: {
        type: GraphQLBoolean,

        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          vorname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          nachname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          gebDat: {
            type: new GraphQLNonNull(GraphQLString)
          },
          geschlecht: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`UPDATE personen SET vorname = ${args.vorname}, nachname = ${args.nachname}, gebDat = ${args.gebDat}, geschlecht = ${args.geschlecht} WHERE personID = ${args.personID}`
          )

          return true
        })
      },
      addPerson: {
        type: new GraphQLNonNull(GraphQLInt),
        args: addAuth({
          vorname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          nachname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          gebDat: {
            type: new GraphQLNonNull(GraphQLString)
          },
          geschlecht: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`INSERT INTO personen (vorname, nachname, gebDat, geschlecht) VALUES (${args.vorname}, ${args.nachname}, ${args.gebDat}, ${args.geschlecht})`
          )
          const person = await query(
            sql`SELECT personID FROM personen WHERE vorname = ${args.vorname} AND nachname = ${args.nachname} AND gebDat = ${args.gebDat}`
          )
          return person[0].personID
        })
      },
      addFZ: {
        type: GraphQLBoolean,

        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          gesehenAm: {
            type: new GraphQLNonNull(GraphQLString)
          },
          fzVon: {
            type: new GraphQLNonNull(GraphQLString)
          },
          gesehenVon: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          kommentar: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await query(
            sql`INSERT INTO fz (personID, gesehenAm, gesehenVon, kommentar, fzVon) VALUES (${args.personID}, ${args.gesehenAm}, ${args.gesehenVon}, ${args.kommentar}, ${args.fzVon})`
          )
          await query(
            sql`DELETE FROM fzAntrag WHERE personID = ${args.personID}`
          )
          return true
        })
      },
      addFZAntrag: {
        type: GraphQLBoolean,
        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          email: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async (_, args) => {
          await createFZ(args.personID, args.email)
          await query(
            `INSERT INTO fzAntrag (personID) VALUES (${args.personID})`
          )
        })
      },
      editSonstiges: {
        type: GraphQLBoolean,
        args: addAuth({
          personID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          juLeiCaNr: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ecMitglied: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          ecKreis: {
            type: GraphQLInt
          },
          Fuehrerschein: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          Rettungsschwimmer: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          ErsteHilfe: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          notizen: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          query(
            `UPDATE personen SET juLeiCaNr="${args.juLeiCaNr}",ecKreis=${
              args.ecKreis ? args.ecKreis : null
            },ecMitglied=${args.ecMitglied}, Fuehrerschein=${
              args.Fuehrerschein
            },Rettungsschwimmer=${args.Rettungsschwimmer},ErsteHilfe=${
              args.ErsteHilfe
            },Notizen="${args.notizen}" WHERE personID=${args.personID}`
          )
        })
      },
      mergePersons: {
        type: GraphQLBoolean,

        args: addAuth({
          personID_richtig: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          personID_falsch: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth(async (_, args: any) => {
          await mergePersonen(args)
          return true
        })
      },
      addOrganisation: {
        type: GraphQLBoolean,
        args: addAuth({
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `INSERT INTO organisationen (bezeichnung) VALUES ('${args.bezeichnung}')`
          )
        })
      },
      editOrganisation: {
        type: GraphQLBoolean,
        args: addAuth({
          organisationsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ansprechpartner: {
            type: GraphQLString
          },
          strasse: {
            type: GraphQLString
          },
          plz: {
            type: GraphQLString
          },
          ort: {
            type: GraphQLString
          },
          land: {
            type: GraphQLString
          },
          telefon: {
            type: GraphQLString
          },
          email: {
            type: GraphQLString
          },
          notizen: {
            type: GraphQLString
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE organisationen SET bezeichnung="${args.bezeichnung}",ansprechpartner="${args.ansprechpartner}",strasse="${args.strasse}",plz="${args.plz}",ort="${args.plz}",land="${args.land}",telefon="${args.telefon}",email="${args.email}",notizen="${args.notizen}" WHERE organisationsID = ${args.organisationsID}`
          )
        })
      },
      veranstaltungAdd: {
        type: GraphQLBoolean,
        args: addAuth({
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          begin: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ende: {
            type: GraphQLString
          },
          veranstaltungsortID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          minTNAlter: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          maxTNAlter: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(`INSERT INTO veranstaltungen (bezeichnung, begin, ende, veranstaltungsort, minTNAlter, maxTNAlter) VALUES ("${
            args.bezeichnung
          }", "${args.begin}", ${args.ende ? '"' + args.ende + '"' : 'null'},
        ${args.veranstaltungsortID},
        ${args.minTNAlter},
        ${args.maxTNAlter})`)
        })
      },
      veranstaltungenStamm: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          kurzBezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          begin: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ende: {
            type: GraphQLString
          },
          veranstaltungsortID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          minTNAlter: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          maxTNAlter: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET bezeichnung = "${
              args.bezeichnung
            }", kurzBezeichnung = ${args.kurzBezeichnung}, begin = "${
              args.begin
            }", ende=${
              args.ende ? '"' + args.ende + '"' : 'null'
            }, veranstaltungsort = ${args.veranstaltungsortID}, minTNAlter=${
              args.minTNAlter
            }, maxTNAlter=${args.maxTNAlter} WHERE veranstaltungsID= ${
              args.veranstaltungsID
            }`
          )
        })
      },
      veranstaltungenPreise: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisFruehbucher: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisAnzahlungFruehbucher: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisNormal: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisAnzahlungNormal: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisLastMinute: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          preisAnzahlungLastMinute: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          fruehbucherBis: {
            type: new GraphQLNonNull(GraphQLString)
          },
          lastMinuteAb: {
            type: new GraphQLNonNull(GraphQLString)
          },
          kannVorortBezahltWerden: {
            type: new GraphQLNonNull(GraphQLBoolean)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(`UPDATE veranstaltungen SET preisFruehbucher=${args.preisFruehbucher}, preisAnzahlungFruehbucher=${args.preisAnzahlungFruehbucher}, preisNormal=${args.preisNormal}, preisAnzahlungNormal=${args.preisAnzahlungNormal}, preisLastMinute=${args.preisLastMinute}, preisAnzahlungLastMinute=${args.preisAnzahlungLastMinute},
      kannVorortBezahltWerden = ${args.kannVorortBezahltWerden},
      fruehbucherBis="${args.fruehbucherBis}", lastMinuteAb="${args.lastMinuteAb}" WHERE veranstaltungsID= ${args.veranstaltungsID}`)
        })
      },
      veranstaltungenWarteliste: {
        type: GraphQLBoolean,
        args: {
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          hatGeschlechterSpezifischeWarteliste: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          anzahlPlaetze: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          anzahlPlaetzeM: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          anzahlPlaetzeW: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        },
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET hatGWarteliste = ${args.hatGeschlechterSpezifischeWarteliste}, anzahlPlätze=${args.anzahlPlaetze}, anzahlPlätzeWeiblich=${args.anzahlPlaetzeW}, anzahlPlätzeMännlich=${args.anzahlPlaetzeM} WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltungenTNListeZuschuesse: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          xlsx: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET xlsxZuschuesse="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltungenTNListeLeiter: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          xlsx: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET xlsxLeiter="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltungenTNListeMitarbeiter: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          xlsx: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET xlsxMitarbeiter="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltungenTNListeKueche: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          xlsx: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET xlsxKueche="${args.xlsx}" WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltungBestaetigungsbrief: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          brief: {
            type: new GraphQLNonNull(GraphQLString)
          },
          geschlechter: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET bestaetigungsBrief="${args.brief}", bestaetigungsBriefGeschlecht="${args.geschlechter}" WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      veranstaltunginfobrief: {
        type: GraphQLBoolean,
        args: addAuth({
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          brief: {
            type: new GraphQLNonNull(GraphQLString)
          },
          geschlechter: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE veranstaltungen SET infoBrief="${args.brief}", infoBriefGeschlecht="${args.geschlechter}" WHERE veranstaltungsID=${args.veranstaltungsID}`
          )
        })
      },
      addVeranstaltungsort: {
        type: GraphQLBoolean,
        args: addAuth({
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          strasse: {
            type: new GraphQLNonNull(GraphQLString)
          },
          plz: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ort: {
            type: new GraphQLNonNull(GraphQLString)
          },
          land: {
            type: new GraphQLNonNull(GraphQLString)
          },
          organisationsID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `INSERT INTO vOrte(bezeichnung, strasse, plz, ort, land, organisitationID) VALUES("${args.bezeichnung}", "${args.strasse}", "${args.plz}", "${args.ort}", "${args.land}", "${args.organisationsID}")`
          )
        })
      },
      veranstaltungsortEditStamm: {
        type: GraphQLBoolean,
        args: addAuth({
          vOrtID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          bezeichnung: {
            type: new GraphQLNonNull(GraphQLString)
          },
          strasse: {
            type: new GraphQLNonNull(GraphQLString)
          },
          plz: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ort: {
            type: new GraphQLNonNull(GraphQLString)
          },
          land: {
            type: new GraphQLNonNull(GraphQLString)
          },
          organisationsID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE vOrte SET bezeichnung = "${args.bezeichnung}", strasse = "${args.strasse}",  plz= "${args.plz}", ort = "${args.ort}",land  = "${args.land}", organisitationID=${args.organisationsID} WHERE vOrtID = ${args.vOrtID}`
          )
        })
      },
      veranstaltungsortEditSonstiges: {
        type: GraphQLBoolean,
        args: addAuth({
          vOrtID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          anzahl_min: {
            type: GraphQLInt
          },
          anzahl_max: {
            type: GraphQLInt
          },
          selbstversorger: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          vollverpflegung: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          notizen: {
            type: GraphQLString
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE vOrte SET anzahl_min=${args.anzahl_min}, anzahl_max=${
              args.anzahl_max
            }, notizen = ${
              args.notizen ? '"' + args.notizen + '"' : null
            }, vollverpflegung=${args.vollverpflegung}, selbstversorger=${
              args.selbstversorger
            } WHERE vOrtID = ${args.vOrtID}`
          )
        })
      },
      veranstaltungsortAddKontakt: {
        type: GraphQLBoolean,
        args: addAuth({
          vOrtID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          ansprechpartner: {
            type: new GraphQLNonNull(GraphQLString)
          },
          typ: {
            type: new GraphQLNonNull(GraphQLString)
          },
          telefon: {
            type: new GraphQLNonNull(GraphQLString)
          },
          email: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `INSERT INTO vOrtKontakt (vOrt, ansprechpartner, typ, telefon, email) VALUES (${args.vOrtID}, "${args.ansprechpartner}", "${args.typ}", "${args.telefon}", "${args.email}")`
          )
        })
      },
      veranstaltungsortEditKontakt: {
        type: GraphQLBoolean,
        args: addAuth({
          vOrtKontaktID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          ansprechpartner: {
            type: new GraphQLNonNull(GraphQLString)
          },
          typ: {
            type: new GraphQLNonNull(GraphQLString)
          },
          telefon: {
            type: new GraphQLNonNull(GraphQLString)
          },
          email: {
            type: new GraphQLNonNull(GraphQLString)
          },
          notizen: {
            type: GraphQLString
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE vOrtKontakt SET ansprechpartner="${args.ansprechpartner}", typ="${args.typ}", telefon="${args.telefon}", email="${args.email}", notizen="${args.notizen}" WHERE vOrtKontaktID= ${args.vOrtKontaktID}`
          )
        })
      },
      veranstaltungsortDeleteKontakt: {
        type: GraphQLBoolean,
        args: addAuth({
          vOrtKontaktID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `DELETE FROM vOrtKontakt WHERE vOrtKontaktID = ${args.vOrtKontaktID}`
          )
        })
      },
      anmeldungBesonderheiten: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
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
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE anmeldungen SET vegetarisch = ${args.vegetarisch}, lebensmittelAllergien="${args.lebensmittelAllergien}", gesundheitsinformationen="${args.gesundheitsinformationen}", bemerkungen="${args.bemerkungen}" WHERE anmeldeID="${args.anmeldeID}"`
          )
        })
      },
      anmeldungBezahlt: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          },
          betrag: {
            type: new GraphQLNonNull(GraphQLFloat)
          }
        }),
        resolve: handleAuth((_, args) => {
          return query(
            `UPDATE anmeldungen SET bisherBezahlt = ${args.betrag} WHERE anmeldeID="${args.anmeldeID}"`
          )
        })
      },
      anmeldungRueckbezahlt: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          },
          betrag: {
            type: new GraphQLNonNull(GraphQLFloat)
          }
        }),
        resolve: handleAuth((_, args) => {
          query(
            `UPDATE anmeldungen SET rueckbezahlt = ${args.betrag} WHERE anmeldeID="${args.anmeldeID}"`
          )
        })
      },
      anmeldungKontakt: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          },
          adressID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          emailID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          telefonID: {
            type: new GraphQLNonNull(GraphQLInt)
          }
        }),
        resolve: handleAuth((_, args) => {
          query(
            `UPDATE anmeldungen SET adressID=${args.adressID}, eMailID=${args.emailID}, telefonID=${args.telefonID} WHERE anmeldeID = '${args.anmeldeID}'`
          )
        })
      },
      abmelden: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          },
          gebuehr: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          weg: {
            type: new GraphQLNonNull(GraphQLString)
          },
          kommentar: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          query(
            `UPDATE anmeldungen SET wartelistenPlatz=-1,abmeldeZeitpunkt=CURRENT_TIMESTAMP,abmeldeGebuehr=${args.gebuehr},wegDerAbmeldung="${args.weg}", kommentarAbmeldung="${args.kommentar}" WHERE anmeldeID = "${args.anmeldeID}"`
          )
          sendMail(
            'automated@ec-nordbund.de',
            {
              to:
                '2pi_r2@gmx.de; BirgitHerbert@t-online.de; an-gela@gmx.net; referent@ec-nordbund.de'
            },
            `Neue Abmeldung`,
            `<h1>Neue Abmeldung</h1><p>Es gibt eine Abmeldung mit der AnmeldeID: ${args.anmeldeID}<br>Klicke <a href="https://verwaltung.ec-nordbund.de/#/anmeldungen/${args.anmeldeID}/home">HIER</a> um die Anmeldung einzusehen.</p>`
          )
        })
      },
      nachruecken: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth((_, args) => {
          query(
            sql`SELECT wartelistenPlatz, veranstaltungsID, geschlecht FROM anmeldungen, personen WHERE personen.personID = anmeldungen.personID AND anmeldeID = ${args.anmeldeID}`
          )
            .then((row) => row[0])
            .then((r) => {
              query(
                sql`SELECT hatGWarteliste FROM veranstaltungen WHERE veranstaltungsID=${r.veranstaltungsID}`
              )
                .then((row) => row[0])
                .then((v) => {
                  if (v.hatGWarteliste) {
                    query(
                      sql`UPDATE anmeldungen SET wartelistenPlatz=0 WHERE anmeldeID=${args.anmeldeID}`
                    ).then(() => {
                      query(
                        sql`UPDATE anmeldungen SET wartelistenPlatz=wartelistenPlatz-1 WHERE wartelistenPlatz > ${r.wartelistenPlatz} AND personen.personID = anmeldungen.personID AND personen.geschlecht = ${r.geschlecht}`
                      )
                    })
                  } else {
                    query(
                      `UPDATE anmeldungen SET wartelistenPlatz=0 WHERE anmeldeID="${args.anmeldeID}"`
                    ).then(() => {
                      query(
                        `UPDATE anmeldungen SET wartelistenPlatz=wartelistenPlatz-1 WHERE wartelistenPlatz > ${r.wartelistenPlatz}`
                      )
                    })
                  }
                })
            })
        })
      },
      anmelden: {
        type: new GraphQLObjectType({
          name: 'anmeldeReturn',
          fields: {
            status: {
              type: new GraphQLNonNull(GraphQLInt)
            },
            anmeldeID: {
              type: GraphQLString
            }
          }
        }),
        args: {
          isWP: {
            type: new GraphQLNonNull(GraphQLBoolean)
          },
          token: {
            type: new GraphQLNonNull(GraphQLString)
          },
          vorname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          nachname: {
            type: new GraphQLNonNull(GraphQLString)
          },
          gebDat: {
            type: new GraphQLNonNull(GraphQLString)
          },
          geschlecht: {
            type: new GraphQLNonNull(GraphQLString)
          },
          position: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          veranstaltungsID: {
            type: new GraphQLNonNull(GraphQLInt)
          },
          eMail: {
            type: new GraphQLNonNull(GraphQLString)
          },
          telefon: {
            type: new GraphQLNonNull(GraphQLString)
          },
          strasse: {
            type: new GraphQLNonNull(GraphQLString)
          },
          plz: {
            type: new GraphQLNonNull(GraphQLString)
          },
          ort: {
            type: new GraphQLNonNull(GraphQLString)
          },
          anmeldeZeitpunkt: {
            type: new GraphQLNonNull(GraphQLString)
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
          schwimmen: {
            type: new GraphQLNonNull(GraphQLInt)
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
          extra_json: {
            type: new GraphQLNonNull(GraphQLString)
          }
        },
        async resolve(_, args) {
          let allowed = false
          if (args.isWP) {
            allowed = wpTokens.indexOf(args.token) !== -1
          } else {
            allowed = !!(await checkToken(args.token))
          }

          if (allowed) {
            const vData = await query(
              `SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${args.veranstaltungsID}`
            ).then((row) => row[0])

            const anmeldeID_start =
              args.vorname.substr(0, 2) +
              args.nachname.substr(0, 2) +
              vData.kurzBezeichnung +
              vData.begin.getFullYear().toString().substr(2, 2)
            const anmeldeID_ende = args.position

            const genFour = (m) => {
              return (
                Math.floor(Math.random() * 10).toString() +
                Math.floor(Math.random() * 10).toString() +
                Math.floor(Math.random() * 10).toString() +
                (2 * Math.floor(Math.random() * 5) + (m ? 1 : 0)).toString()
              )
            }
            const checkAnmeldeID = (id: string) => {
              return query(
                `SELECT anmeldeID FROM anmeldungen WHERE anmeldeID = '${id}'`
              ).then((v) => v.length === 0)
            }

            let anmeldeID =
              anmeldeID_start +
              genFour(args.geschlecht === 'm') +
              anmeldeID_ende
            while (!checkAnmeldeID(anmeldeID)) {
              anmeldeID =
                anmeldeID_start +
                genFour(args.geschlecht === 'm') +
                anmeldeID_ende
            }

            let persons = await query(
              `SELECT personID FROM personen WHERE vorname="${args.vorname}"AND  nachname="${args.nachname}" AND gebDat="${args.gebDat}"`
            )
            if (persons.length === 0) {
              // check in dublikaten Table
              const dubs = await query(
                `SELECT zielPersonID FROM dublikate WHERE vorname="${args.vorname}"AND  nachname="${args.nachname}" AND gebDat="${args.gebDat}"`
              )

              if (dubs.length === 0) {
                await query(
                  `INSERT INTO personen (vorname, nachname, gebDat, geschlecht) VALUES ("${args.vorname}", "${args.nachname}", "${args.gebDat}", "${args.geschlecht}")`
                )
                persons = await query(
                  `SELECT personID FROM personen WHERE vorname="${args.vorname}"AND  nachname="${args.nachname}" AND gebDat="${args.gebDat}"`
                )
              } else {
                persons = [{ personID: dubs[0].zielPersonID }]
              }
            }
            const personID = persons[0].personID

            let eMails = await query(
              `SELECT eMailID FROM eMails WHERE eMail="${args.eMail}" AND personID=${personID}`
            )
            const mailExisted = eMails.length !== 0
            if (eMails.length === 0) {
              await query(
                `INSERT INTO eMails(eMail, personID) VALUES ("${args.eMail}",${personID})`
              )
              eMails = await query(
                `SELECT eMailID FROM eMails WHERE eMail="${args.eMail}" AND personID=${personID}`
              )
            }
            const eMailID = eMails[0].eMailID

            let telefone = await query(
              `SELECT telefonID FROM telefone WHERE telefon="${args.telefon}" AND personID=${personID}`
            )
            if (telefone.length === 0) {
              await query(
                `INSERT INTO telefone(telefon, personID) VALUES ("${args.telefon}",${personID})`
              )
              telefone = await query(
                `SELECT telefonID FROM telefone WHERE telefon="${args.telefon}" AND personID=${personID}`
              )
            }
            const telefonID = telefone[0].telefonID

            let adressen = await query(
              `SELECT adressID FROM adressen WHERE personID=${personID} AND strasse="${args.strasse}" AND plz="${args.plz}" AND ort="${args.ort}"`
            )
            if (adressen.length === 0) {
              await query(
                `INSERT INTO adressen (personID, strasse, plz, ort) VALUES (${personID},"${args.strasse}","${args.plz}","${args.ort}")`
              )
              adressen = await query(
                `SELECT adressID FROM adressen WHERE personID=${personID} AND strasse="${args.strasse}" AND plz="${args.plz}" AND ort="${args.ort}"`
              )
            }
            const adressID = adressen[0].adressID

            if (args.veranstaltungsID === 42) {
              console.log(args)
              console.log('MA-Ort Anmeldung')
              let generateFlag = false

              const wann: Date = new Date(new Date().getTime() + 788923800)

              const fzData = await query(
                `SELECT fzVon FROM fz WHERE personID = ${personID} ORDER BY fzVon DESC LIMIT 1`
              )

              if (fzData.length === 0) {
                generateFlag = true
              } else {
                const fzVon = fzData[0].fzVon
                const wannArr = [
                  wann.getFullYear(),
                  wann.getMonth() + 1,
                  wann.getDate()
                ]
                wannArr[0] -= 5
                const fzMinDate = new Date(wannArr.join('-'))
                if (fzMinDate > fzVon) {
                  generateFlag = true
                }
              }

              if (generateFlag) {
                await createFZ(personID, args.eMail, adressID, 42)
                await query(
                  `INSERT INTO fzAntrag(personID, erzeugt_durch) VALUES (${personID}, 'ecKreis ${args.gesundheitsinformationen}')`
                )

                const ecKreisID: number = (
                  await query(
                    sql`SELECT ecKreisID FROM ecKreis WHERE lower(bezeichnung) = ${args.gesundheitsinformationen}`
                  )
                )[0].ecKreisID

                await query(
                  sql`UPDATE personen SET ecKreis = ${ecKreisID} WHERE personID = ${personID}`
                )
              } else {
                if (mailExisted) {
                  sendMail(
                    'fz@ec-nordbund.de',
                    {
                      to: args.eMail,
                      bcc: 'datenschutz@ec-nordbund.de'
                    },
                    `Du hast bereits ein FZ (PID: ${personID})`,
                    `Moin,\nDein FZ ist vom ${fzData[0].fzVon
                      .toISOString()
                      .split('T')[0]
                      .split('-')
                      .reverse()
                      .join('.')} also noch gültig.`
                  )
                }
              }
              return {
                status: 0,
                anmeldeID: personID.toString()
              }
            }

            const vorhandeneAnmeldungen = await query(
              `SELECT anmeldeID FROM anmeldungen WHERE personID=${personID} AND veranstaltungsID=${args.veranstaltungsID}`
            )

            if (vorhandeneAnmeldungen.length > 0) {
              return {
                status: -2,
                anmeldeID: vorhandeneAnmeldungen[0].anmeldeID
              }
            } else {
              let wartelistenplatz = 0
              if (args.position === 1) {
                const maxWListPlatz: Array<any> = await query(
                  `SELECT personen.geschlecht AS geschlecht, MAX(anmeldungen.wartelistenPlatz) AS maxWlistPos FROM anmeldungen, personen WHERE personen.personID = anmeldungen.personID AND anmeldungen.veranstaltungsID = ${args.veranstaltungsID} GROUP BY personen.geschlecht`
                )
                const anzahlPersonen: Array<any> = await query(
                  `SELECT COUNT(personen.personID) AS anzahlPersonen, personen.geschlecht AS geschlecht FROM personen, anmeldungen WHERE personen.personID = anmeldungen.personID AND anmeldungen.veranstaltungsID = ${args.veranstaltungsID} AND anmeldungen.wartelistenPlatz = 0 GROUP BY personen.geschlecht`
                )

                let maxWlistMännlich = 0
                let maxWlistWeiblich = 0
                let anzahlMännlich = 0
                let anzahlWeiblich = 0

                maxWListPlatz.forEach((per) => {
                  switch (per.geschlecht) {
                    case 'm':
                      maxWlistMännlich = per.maxWlistPos
                      break
                    case 'w':
                      maxWlistWeiblich = per.maxWlistPos
                      break
                  }
                })

                const maxWlistGesamt = Math.max(
                  maxWlistMännlich,
                  maxWlistWeiblich
                )

                anzahlPersonen.forEach((per) => {
                  switch (per.geschlecht) {
                    case 'm':
                      anzahlMännlich = per.anzahlPersonen
                      break
                    case 'w':
                      anzahlWeiblich = per.anzahlPersonen
                      break
                  }
                })

                const anzahlGesamt = anzahlMännlich + anzahlWeiblich

                const hatGWarteliste = vData.hatGWarteliste
                const anzahlPlätze = vData.anzahlPlätze
                const anzahlPlätzeWeiblich = vData.anzahlPlätzeWeiblich
                const anzahlPlätzeMännlich = vData.anzahlPlätzeMännlich

                const myGeschlecht = args.geschlecht

                if (hatGWarteliste) {
                  if (myGeschlecht === 'm') {
                    if (maxWlistMännlich > 0) {
                      wartelistenplatz = maxWlistMännlich + 1
                    } else {
                      if (anzahlMännlich < anzahlPlätzeMännlich) {
                        if (anzahlGesamt < anzahlPlätze) {
                          wartelistenplatz = 0
                        } else {
                          wartelistenplatz = 1
                        }
                      } else {
                        wartelistenplatz = 1
                      }
                    }
                  } else {
                    if (maxWlistWeiblich > 0) {
                      wartelistenplatz = maxWlistWeiblich + 1
                    } else {
                      if (anzahlWeiblich < anzahlPlätzeWeiblich) {
                        if (anzahlGesamt < anzahlPlätze) {
                          wartelistenplatz = 0
                        } else {
                          wartelistenplatz = 1
                        }
                      } else {
                        wartelistenplatz = 1
                      }
                    }
                  }
                } else {
                  if (maxWlistGesamt > 0) {
                    wartelistenplatz = maxWlistGesamt + 1
                  } else {
                    if (anzahlGesamt < anzahlPlätze) {
                      wartelistenplatz = 0
                    } else {
                      wartelistenplatz = 1
                    }
                  }
                }
              } else {
                let generateFlag = false

                let wann: Date
                if (vData.ende === null) {
                  wann = vData.begin
                } else {
                  wann = vData.ende
                }

                const fzData = await query(
                  `SELECT fzVon FROM fz WHERE personID = ${personID} ORDER BY fzVon DESC LIMIT 1`
                )

                if (fzData.length === 0) {
                  generateFlag = true
                } else {
                  const fzVon = fzData[0].fzVon
                  const wannArr = [
                    wann.getFullYear(),
                    wann.getMonth() + 1,
                    wann.getDate()
                  ]
                  wannArr[0] -= 5
                  const fzMinDate = new Date(wannArr.join('-'))
                  if (fzMinDate > fzVon) {
                    generateFlag = true
                  }
                }

                if (generateFlag) {
                  await createFZ(
                    personID,
                    args.eMail,
                    adressID,
                    args.veranstaltungsID
                  )
                  await query(
                    `INSERT INTO fzAntrag(personID, erzeugt_durch) VALUES (${personID}, 'veranstaltung ${args.veranstaltungsID}')`
                  )
                }
              }
              await Promise.all([
                query(
                  `UPDATE adressen SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${adressID}`
                ),
                query(
                  `UPDATE eMails SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${eMailID}`
                ),
                query(
                  `UPDATE telefone SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${telefonID}`
                ),
                query(
                  `UPDATE personen SET letzteAenderung=CURRENT_TIMESTAMP WHERE personID=${personID}`
                )
              ])
              await query(`
                INSERT INTO anmeldungen(
                  anmeldeID,
                  veranstaltungsID,
                  personID,
                  position,
                  adressID,
                  eMailID,
                  telefonID,
                  wartelistenPlatz,
                  anmeldeZeitpunkt,
                  vegetarisch,
                  lebensmittelAllergien,
                  gesundheitsinformationen,
                  bemerkungen,
                  radfahren, 
                  schwimmen,
                  fahrgemeinschaften,
                  klettern,
                  sichEntfernen,
                  bootFahren,
                  extra_json
                ) VALUES (
                  "${anmeldeID}", 
                  ${args.veranstaltungsID}, 
                  ${personID}, 
                  ${args.position}, 
                  ${adressID}, 
                  ${eMailID}, 
                  ${telefonID}, 
                  ${wartelistenplatz},
                  "${args.anmeldeZeitpunkt}",
                  ${args.vegetarisch},
                  "${args.lebensmittelAllergien}",
                  "${args.gesundheitsinformationen}",
                  "${args.bemerkungen}", 
                  ${args.radfahren},
                  ${args.schwimmen},
                  ${args.fahrgemeinschaften},
                  ${args.klettern},
                  ${args.sichEntfernen},
                  ${args.bootFahren},
                  "${args.extra_json}"
                )`)
              if (vData.informAnmeldecenter && args.position === 1) {
                sendMail(
                  'automated@ec-nordbund.de',
                  { to: vData.informAnmeldecenter },
                  `Neue Anmeldung bei Veranstaltung ${vData.bezeichnung}`,
                  `<h1>Neue Anmeldung</h1><p>Es gibt eine Anmeldung mit der AnmeldeID: ${anmeldeID}<br>Klicke <a href="https://verwaltung.ec-nordbund.de/#/anmeldungen/${anmeldeID}/home">HIER</a> um die Anmeldung einzusehen.</p>`
                )
              }

              return {
                status: wartelistenplatz,
                anmeldeID: anmeldeID
              }
            }
          } else {
            return { status: -1 }
          }
        }
      },
      anmeldungBestaetigungsbrief: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async function (_, args) {
          await query(
            `UPDATE anmeldungen SET bestaetigungsBrief=CURRENT_TIMESTAMP WHERE anmeldeID = '${args.anmeldeID}'`
          )
          return true
        })
      },
      anmeldunginfobrief: {
        type: GraphQLBoolean,
        args: addAuth({
          anmeldeID: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }),
        resolve: handleAuth(async function (_, args) {
          await query(
            `UPDATE anmeldungen SET infoBrief=CURRENT_TIMESTAMP WHERE anmeldeID = '${args.anmeldeID}'`
          )
          return true
        })
      }
    }
  })
})

/**
 * Zwei Personen zusammenführen
 *
 * @author Sebastian
 * @param args Argumente
 */
async function mergePersonen(args: {
  personID_richtig: number
  personID_falsch: number
}) {
  const con = await getMySQL()
  await con.query(
    sql`
      UPDATE IGNORE adressen
      SET personID = ${args.personID_richtig}
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE akPerson 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE anmeldungen 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE eMails 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE fz 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE fzAntrag 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE telefone 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE juleica 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE IGNORE tagsPersonen 
      SET personID = ${args.personID_richtig} 
      WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE fz 
      SET gesehenVon = ${args.personID_richtig} 
      WHERE gesehenVon = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE dublikate 
      SET zielPersonID = ${args.personID_richtig} 
      WHERE zielPersonID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      UPDATE anmeldungen as a 
      
      INNER JOIN telefone as e1 ON e1.telefonID = a.telefonID 
      INNER JOIN telefone as e2 ON e1.telefon = e2.telefon 
      
      SET a.telefonID = e2.telefonID 
      
      WHERE 
        e1.personID = ${args.personID_falsch} AND 
        e2.personID = ${args.personID_richtig};`
  )
  await con.query(
    sql`
      UPDATE anmeldungen as a 
      
      INNER JOIN eMails as e1 ON e1.eMailID = a.eMailID 
      INNER JOIN eMails as e2 ON e1.eMail = e2.eMail 
      
      SET a.eMailID = e2.emailID 
      
      WHERE 
        e1.personID = ${args.personID_falsch} AND 
        e2.personID = ${args.personID_richtig};`
  )
  await con.query(
    sql`
      UPDATE anmeldungen as a 
      
      INNER JOIN adressen as e1 ON e1.adressID = a.adressID 
      INNER JOIN adressen as e2 ON (
        e1.strasse = e2.strasse AND 
        e1.strasse = e2.strasse AND 
        e1.plz = e2.plz
      ) 
      
      SET a.adressID = e2.adressID 
      
      WHERE 
        e1.personID = ${args.personID_falsch} AND 
        e2.personID = ${args.personID_richtig};`
  )
  await con.query(
    sql`DELETE IGNORE FROM adressen WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`DELETE IGNORE FROM eMails WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`DELETE IGNORE FROM telefone WHERE personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`
      INSERT into dublikate 
      SELECT 
        vorname, 
        nachname, 
        gebDat, 
        ${args.personID_richtig} AS zielPersonID 
      FROM 
        personen 
      WHERE 
        personID = ${args.personID_falsch};`
  )
  await con.query(
    sql`DELETE FROM personen WHERE personID = ${args.personID_falsch};`
  )
  con.release()
}
