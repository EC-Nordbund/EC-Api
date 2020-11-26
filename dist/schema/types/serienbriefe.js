"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
exports._serienbrief = new graphql_1.GraphQLObjectType({
    name: 'Serienbrief',
    fields: () => ({
        sbID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        docxDocument: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        geschlechterspizifischeAttribute: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        }
    })
});
