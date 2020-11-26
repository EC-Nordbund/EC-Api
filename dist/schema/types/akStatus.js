"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._akStatus = new graphql_1.GraphQLObjectType({
    name: 'akStatus',
    fields: () => ({
        akPersonID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        person: {
            type: new graphql_1.GraphQLNonNull(_1.person),
            async resolve(parent) {
                const person = await mysql_1.query(`SELECT * FROM personen WHERE personID = ${parent.personID}`);
                return person[0];
            },
        },
        ak: {
            type: new graphql_1.GraphQLNonNull(_1.ak),
            async resolve(parent) {
                const ak = await mysql_1.query(`SELECT * FROM ak WHERE akID = ${parent.akID}`);
                return ak[0];
            },
        },
        date: {
            type: new graphql_1.GraphQLNonNull(_1.date),
        },
        neuerStatus: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
    }),
});
