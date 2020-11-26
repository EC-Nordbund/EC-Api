"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
exports._adresse = new graphql_1.GraphQLObjectType({
    name: 'adresse',
    fields: () => ({
        adressID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
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
        isOld: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean)
        },
        lastUsed: {
            type: new graphql_1.GraphQLNonNull(_1.timeStamp)
        }
    })
});
