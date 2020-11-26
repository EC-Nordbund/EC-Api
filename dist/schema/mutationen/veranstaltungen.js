"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    veranstaltungAdd: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            begin: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ende: {
                type: graphql_1.GraphQLString,
            },
            veranstaltungsortID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            minTNAlter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            maxTNAlter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO veranstaltungen (bezeichnung, begin, ende, veranstaltungsort, minTNAlter, maxTNAlter) VALUES ("${args.bezeichnung}", "${args.begin}", ${args.ende ? '"' + args.ende + '"' : 'null'},
        ${args.veranstaltungsortID},
        ${args.minTNAlter},
        ${args.maxTNAlter})`);
        }, 'veranstaltungenAdd'),
    },
    veranstaltungenStamm: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            kurzBezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            begin: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ende: {
                type: graphql_1.GraphQLString,
            },
            veranstaltungsortID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            minTNAlter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            maxTNAlter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET bezeichnung = "${args.bezeichnung}", kurzBezeichnung = ${args.kurzBezeichnung}, begin = "${args.begin}", ende=${args.ende ? '"' + args.ende + '"' : 'null'}, veranstaltungsort = ${args.veranstaltungsortID}, minTNAlter=${args.minTNAlter}, maxTNAlter=${args.maxTNAlter} WHERE veranstaltungsID= ${args.veranstaltungsID}`);
        }, 'veranstaltungenStamm'),
    },
    veranstaltungenPreise: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisFruehbucher: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisAnzahlungFruehbucher: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisNormal: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisAnzahlungNormal: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisLastMinute: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            preisAnzahlungLastMinute: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            fruehbucherBis: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            lastMinuteAb: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            kannVorortBezahltWerden: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET preisFruehbucher=${args.preisFruehbucher}, preisAnzahlungFruehbucher=${args.preisAnzahlungFruehbucher}, preisNormal=${args.preisNormal}, preisAnzahlungNormal=${args.preisAnzahlungNormal}, preisLastMinute=${args.preisLastMinute}, preisAnzahlungLastMinute=${args.preisAnzahlungLastMinute},
      kannVorortBezahltWerden = ${args.kannVorortBezahltWerden},
      fruehbucherBis="${args.fruehbucherBis}", lastMinuteAb="${args.lastMinuteAb}" WHERE veranstaltungsID= ${args.veranstaltungsID}`);
        }, 'veranstaltungenPreise'),
    },
    veranstaltungenWarteliste: {
        type: graphql_1.GraphQLBoolean,
        args: {
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            hatGeschlechterSpezifischeWarteliste: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            anzahlPlaetze: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            anzahlPlaetzeM: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            anzahlPlaetzeW: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        },
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET hatGWarteliste = ${args.hatGeschlechterSpezifischeWarteliste}, anzahlPlätze=${args.anzahlPlaetze}, anzahlPlätzeWeiblich=${args.anzahlPlaetzeW}, anzahlPlätzeMännlich=${args.anzahlPlaetzeM} WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenWarteliste'),
    },
    veranstaltungenTNListeZuschuesse: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            xlsx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET xlsxZuschuesse="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenTNListe'),
    },
    veranstaltungenTNListeLeiter: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            xlsx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET xlsxLeiter="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenTNListe'),
    },
    veranstaltungenTNListeMitarbeiter: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            xlsx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET xlsxMitarbeiter="${args.xlsx}"  WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenTNListe'),
    },
    veranstaltungenTNListeKueche: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            xlsx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET xlsxKueche="${args.xlsx}" WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenTNListe'),
    },
    veranstaltungBestaetigungsbrief: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            brief: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlechter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET bestaetigungsBrief="${args.brief}", bestaetigungsBriefGeschlecht="${args.geschlechter}" WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenBriefe'),
    },
    veranstaltunginfobrief: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            brief: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlechter: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE veranstaltungen SET infoBrief="${args.brief}", infoBriefGeschlecht="${args.geschlechter}" WHERE veranstaltungsID=${args.veranstaltungsID}`);
        }, 'veranstaltungenBriefe'),
    },
};
