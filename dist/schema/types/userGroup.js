"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
exports._userGroup = new graphql_1.GraphQLObjectType({
    name: 'userGroup',
    fields: () => ({
        userGroupID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        mutationRechte: {
            type: new graphql_1.GraphQLList(graphql_1.GraphQLString)
        },
        fieldAccess: {
            type: new graphql_1.GraphQLList(new graphql_1.GraphQLObjectType({
                name: 'field',
                fields: {
                    table: {
                        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
                    },
                    field: {
                        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
                    }
                }
            }))
        }
    })
});
