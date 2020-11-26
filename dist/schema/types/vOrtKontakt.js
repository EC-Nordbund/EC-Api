"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
exports._vortKontakt = new graphql_1.GraphQLObjectType({
    name: 'vOrtKontakt',
    fields: () => ({
        vOrtKontaktID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        ansprechpartner: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        typ: {
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
