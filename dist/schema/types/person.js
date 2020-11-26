"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._person = new graphql_1.GraphQLObjectType({
    name: 'person',
    fields: () => ({
        personID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        vorname: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        nachname: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        gebDat: {
            type: new graphql_1.GraphQLNonNull(_1.date),
        },
        geschlecht: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        alter: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            args: {
                wann: {
                    type: graphql_1.GraphQLString,
                },
            },
            resolve(parent, args) {
                if (args.wann === null) {
                    args.wann = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
                }
                let older = parent.gebDat;
                let newer = new Date(args.wann);
                let tmpDate = newer.getFullYear() - older.getFullYear();
                let tmpGebDatArr = args.wann.split('-');
                tmpGebDatArr[0] -= tmpDate;
                let tmpGebDat = new Date(tmpGebDatArr.join('-'));
                if (tmpGebDat < older) {
                    return tmpDate - 1;
                }
                else {
                    return tmpDate;
                }
            },
        },
        adressen: {
            type: new graphql_1.GraphQLList(_1.adresse),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM adressen WHERE personID = ${parent.personID}`);
            },
        },
        emails: {
            type: new graphql_1.GraphQLList(_1.email),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM eMails WHERE personID = ${parent.personID}`);
            },
        },
        telefone: {
            type: new graphql_1.GraphQLList(_1.telefon),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM telefone WHERE personID = ${parent.personID}`);
            },
        },
        anmeldungen: {
            type: new graphql_1.GraphQLList(_1.anmeldung),
            resolve(parent, args, context) {
                return mysql_1.query(`SELECT * FROM anmeldungen WHERE personID = ${parent.personID}`);
            },
        },
        fzs: {
            type: new graphql_1.GraphQLList(_1.fz),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'fz',
                })) {
                    return mysql_1.query(`SELECT * FROM fz WHERE personID = ${parent.personID}`);
                }
                else {
                    return [];
                }
            },
        },
        fzAntraege: {
            type: new graphql_1.GraphQLList(_1.fzAntrag),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'fzAntrag',
                })) {
                    return mysql_1.query(`SELECT * FROM fzAntrag WHERE personID = ${parent.personID}`);
                }
                else {
                    return [];
                }
            },
        },
        datumDesLetztenFZ: {
            type: _1.date,
            resolve(parent, args, context) {
                return mysql_1.query(`SELECT fzVon FROM fz WHERE personID = ${parent.personID} ORDER BY gesehenAm DESC LIMIT 1`).then(rows => {
                    if (rows.length === 0) {
                        return null;
                    }
                    else {
                        return rows[0].fzVon;
                    }
                });
            },
        },
        hatFZ: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            args: {
                wann: {
                    type: graphql_1.GraphQLString,
                },
            },
            resolve(parent, args) {
                if (args.wann === null) {
                    args.wann = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
                }
                return mysql_1.query(`SELECT gesehenAm  FROM fz WHERE personID = ${parent.personID} ORDER BY gesehenAm DESC LIMIT 1`)
                    .then(rows => {
                    if (rows.length === 0) {
                        return null;
                    }
                    else {
                        return rows[0].gesehenAm;
                    }
                })
                    .then(fzDate => {
                    let wannArr = args.wann.split('-');
                    wannArr[0] -= 5;
                    return fzDate > new Date(wannArr.join('-'));
                });
            },
        },
        ecKreis: {
            type: _1.ecKreis,
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'ecKreis',
                })) {
                    if (parent.ecKreis === null) {
                        return null;
                    }
                    else {
                        return mysql_1.query(`SELECT * FROM ecKreis WHERE ecKreisID = ${parent.ecKreis}`).then(rows => rows[0]);
                    }
                }
                else {
                    return null;
                }
            },
        },
        ecMitglied: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'ecMitglied',
                })) {
                    return parent.ecMitglied;
                }
                else {
                    return -1;
                }
            },
        },
        juleica: {
            type: new graphql_1.GraphQLList(_1.juleica),
            resolve(parent, _, context) {
                return mysql_1.query(`SELECT * FROM juleica WHERE personID = ${parent.personID}`);
            },
        },
        tags: {
            type: new graphql_1.GraphQLList(_1.personTag),
            resolve(parent, _, context) {
                return mysql_1.query(`SELECT * FROM tagsPersonen WHERE personID = ${parent.personID}`);
            },
        },
        ak: {
            type: new graphql_1.GraphQLList(_1.personAK),
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'ak',
                })) {
                    return mysql_1.query(`SELECT akID FROM akPerson WHERE personID = ${parent.personID} GROUP BY akID`).then(v => v.map(el => ({
                        akID: el.akID,
                        personID: parent.personID,
                    })));
                }
                else {
                    return [];
                }
            },
        },
        bisherigeRollen: {
            type: new graphql_1.GraphQLList(graphql_1.GraphQLInt),
            resolve(parent, _, context) {
                return mysql_1.query(`SELECT DISTINCT position FROM anmeldungen WHERE personID = ${parent.personID}`);
            },
        },
        Notizen: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        erstellt: {
            type: new graphql_1.GraphQLNonNull(_1.timeStamp),
        },
        letzteAenderung: {
            type: new graphql_1.GraphQLNonNull(_1.timeStamp),
        },
    }),
});
