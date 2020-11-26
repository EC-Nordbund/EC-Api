"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    personen: {
        description: 'Returnt Liste von Personen',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.person),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM personen`);
        })
    },
    person: {
        description: 'Returnt gewählte Person anhand der genannten ID',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'ID der abgefragten Person.',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
            }
        }),
        type: types_1.person,
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM personen WHERE personID = ${args.personID}`).then(res => res[0]);
        })
    },
    moeglicheDublikate: {
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(new graphql_1.GraphQLObjectType({
            name: 'dublikate',
            fields: {
                personA: {
                    type: types_1.person
                },
                personB: {
                    type: types_1.person
                }
            }
        })),
        resolve: sonstiges_1.handleAuth((_, args) => {
            // Check for pos Dubs
            // remove all nodubs
            // Order Persons
            return [];
        })
    }
};
