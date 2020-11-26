"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
exports._fzAntrag = new graphql_1.GraphQLObjectType({
    name: 'fzAntrag',
    fields: () => ({
        fzAntragID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        erzeugt: {
            type: _1.date
        }
    })
});
