"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._veranstaltung = new graphql_1.GraphQLObjectType({
    name: 'veranstaltung',
    fields: () => ({
        veranstaltungsID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        kurzBezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        hauptleiter: {
            type: _1.anmeldung,
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM anmeldungen WHERE veranstaltungsID = ${parent.veranstaltungsID} AND position = 6`).then((v) => v[0] || null);
            }
        },
        anmeldungen: {
            type: new graphql_1.GraphQLList(_1.anmeldung),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM anmeldungen WHERE veranstaltungsID = ${parent.veranstaltungsID} ORDER BY anmeldeZeitpunkt`);
            }
        },
        veranstaltungsort: {
            type: new graphql_1.GraphQLNonNull(_1.vorte),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM vOrte WHERE vOrtID = ${parent.veranstaltungsort}`).then(v => v[0]);
            }
        },
        begin: {
            type: new graphql_1.GraphQLNonNull(_1.date)
        },
        ende: {
            type: _1.date
        },
        minTNAlter: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        maxTNAlter: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        anzahlPlaetze: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent) {
                return parent.anzahlPlätze;
            }
        },
        anzahlPlaetzeW: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent) {
                return parent.anzahlPlätzeWeiblich;
            }
        },
        anzahlPlaetzeM: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent) {
                return parent.anzahlPlätzeMännlich;
            }
        },
        preisFruehbucher: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        preisNormal: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        preisLastMinute: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        preisAnzahlungNormal: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        preisAnzahlungFruehbucher: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        preisAnzahlungLastMinute: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        fruehbucherBis: {
            type: _1.date
        },
        lastMinuteAb: {
            type: _1.date
        },
        kannVorortBezahltWerden: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean)
        },
        hatGWarteliste: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean)
        },
        xlsxZuschuesse: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        xlsxLeiter: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        xlsxMitarbeiter: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        xlsxKueche: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        infoBrief: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        infoBriefGeschlecht: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        bestaetigungsBrief: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        bestaetigungsBriefGeschlecht: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        }
    })
});
