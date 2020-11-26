"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
exports._juleica = new graphql_1.GraphQLObjectType({
    name: 'juleica',
    fields: () => ({
        juleicanummer: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        gueltig_bis: {
            type: _1.date,
        },
    }),
});
