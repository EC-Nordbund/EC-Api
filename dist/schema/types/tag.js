"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
exports._tag = new graphql_1.GraphQLObjectType({
    name: 'tag',
    fields: () => ({
        tagID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        }
    })
});
