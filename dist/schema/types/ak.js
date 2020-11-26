"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._ak = new graphql_1.GraphQLObjectType({
    name: 'ak',
    fields: () => ({
        akID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        bezeichnung: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        personen: {
            type: new graphql_1.GraphQLList(_1.personAK),
            async resolve(parent, _, context) {
                if (context.user.checkAlowedFileds({
                    table: 'personen',
                    field: 'ak',
                })) {
                    const persons = await mysql_1.query(`SELECT personID FROM akPerson WHERE akID = ${parent.akID} GROUP BY personID`);
                    return persons.map(person => ({
                        personID: person.personID,
                        akID: parent.akID,
                    }));
                }
                else {
                    return [];
                }
            },
        },
    }),
});
