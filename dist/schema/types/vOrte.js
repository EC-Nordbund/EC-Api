"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const mysql_1 = require("../mysql");
const _1 = require(".");
exports._vorte = new graphql_1.GraphQLObjectType({
    name: 'vorteType',
    fields: () => ({
        vOrtID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        veranstaltungen: {
            type: new graphql_1.GraphQLList(_1.veranstaltung),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM veranstaltungen WHERE veranstaltungsort = ${parent.vOrtID} `);
            }
        },
        organisation: {
            type: _1.organisation,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return mysql_1.query(`SELECT * FROM organisationen WHERE organisationsID = ${parent.organisitationID}`).then(v => v[0]);
                }
                else {
                    return null;
                }
            }
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        strasse: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        plz: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        ort: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        land: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        notizen: {
            type: graphql_1.GraphQLString,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return parent.notizen;
                }
                else {
                    return null;
                }
            }
        },
        anzahl_max: {
            type: graphql_1.GraphQLInt,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return parent.anzahl_max;
                }
                else {
                    return null;
                }
            }
        },
        anzahl_min: {
            type: graphql_1.GraphQLInt,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return parent.anzahl_min;
                }
                else {
                    return null;
                }
            }
        },
        vollverpflegung: {
            type: graphql_1.GraphQLBoolean,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return parent.vollverpflegung;
                }
                else {
                    return null;
                }
            }
        },
        selbstversorger: {
            type: graphql_1.GraphQLBoolean,
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return parent.selbstversorger;
                }
                else {
                    return null;
                }
            }
        },
        kontakte: {
            type: new graphql_1.GraphQLList(_1.vortKontakt),
            resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'vOrte',
                    field: 'extended'
                })) {
                    return mysql_1.query(`SELECT * FROM vOrtKontakt WHERE vOrt=${parent.vOrtID}`);
                }
                else {
                    return [];
                }
            }
        }
    })
});
