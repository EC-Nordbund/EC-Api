"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    addOrganisation: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO organisationen (bezeichnung) VALUES ('${args.bezeichnung}')`);
        }, 'organisation'),
    },
    editOrganisation: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            organisationsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ansprechpartner: {
                type: graphql_1.GraphQLString,
            },
            strasse: {
                type: graphql_1.GraphQLString,
            },
            plz: {
                type: graphql_1.GraphQLString,
            },
            ort: {
                type: graphql_1.GraphQLString,
            },
            land: {
                type: graphql_1.GraphQLString,
            },
            telefon: {
                type: graphql_1.GraphQLString,
            },
            email: {
                type: graphql_1.GraphQLString,
            },
            notizen: {
                type: graphql_1.GraphQLString,
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE organisationen SET bezeichnung="${args.bezeichnung}",ansprechpartner="${args.ansprechpartner}",strasse="${args.strasse}",plz="${args.plz}",ort="${args.plz}",land="${args.land}",telefon="${args.telefon}",email="${args.email}",notizen="${args.notizen}" WHERE organisationsID = ${args.organisationsID}`);
        }, 'organisation'),
    },
};
