"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._fz = new graphql_1.GraphQLObjectType({
    name: 'fz',
    fields: () => ({
        fzID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        gesehenVon: {
            type: new graphql_1.GraphQLNonNull(_1.person),
            async resolve(parent) {
                const person = await mysql_1.query(`SELECT * FROM personen WHERE personID = ${parent.gesehenVon}`);
                return person[0];
            },
        },
        fzVon: {
            type: new graphql_1.GraphQLNonNull(_1.date),
        },
        gesehenAm: {
            type: new graphql_1.GraphQLNonNull(_1.date),
        },
        kommentar: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
    }),
});
