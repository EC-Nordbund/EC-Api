"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
exports._telefon = new graphql_1.GraphQLObjectType({
    name: 'telefon',
    description: 'Telefonnummer',
    fields: () => ({
        telefonID: {
            description: 'ID der Telefonnummer',
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        telefon: {
            description: 'Telefonnummer',
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
