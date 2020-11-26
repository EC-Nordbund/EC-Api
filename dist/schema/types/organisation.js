"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._organisationen = new graphql_1.GraphQLObjectType({
    name: 'oraType',
    fields: () => ({
        organisationsID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        ansprechpartner: {
            type: graphql_1.GraphQLString
        },
        vOrte: {
            type: new graphql_1.GraphQLList(_1.vorte),
            async resolve(parent) {
                return await mysql_1.query(`SELECT * FROM vOrte WHERE organisitationID = ${parent.organisationsID}`);
            }
        },
        strasse: {
            type: graphql_1.GraphQLString
        },
        plz: {
            type: graphql_1.GraphQLString
        },
        ort: {
            type: graphql_1.GraphQLString
        },
        land: {
            type: graphql_1.GraphQLString
        },
        telefon: {
            type: graphql_1.GraphQLString
        },
        email: {
            type: graphql_1.GraphQLString
        },
        notizen: {
            type: graphql_1.GraphQLString
        }
    })
});
