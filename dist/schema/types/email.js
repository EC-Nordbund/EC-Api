"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
exports._email = new graphql_1.GraphQLObjectType({
    name: 'email',
    fields: () => ({
        eMailID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        eMail: {
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
