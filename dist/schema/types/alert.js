"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
exports._alert = new graphql_1.GraphQLObjectType({
    name: 'alert',
    fields: () => ({
        alertID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        content: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        von: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        }
    })
});
