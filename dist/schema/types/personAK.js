"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
const mysql_1 = require("../mysql");
exports._personAK = new graphql_1.GraphQLObjectType({
    name: 'personenAK',
    fields: () => ({
        ak: {
            type: _1.ak,
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM ak WHERE akID = ${parent.akID}`).then(v => v[0]);
            }
        },
        person: {
            type: _1.person,
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM personen WHERE personID = ${parent.personID}`).then(v => v[0]);
            }
        },
        currentStatus: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent) {
                return mysql_1.query(`SELECT neuerStatus FROM akPerson WHERE akID = ${parent.akID} AND personID = ${parent.personID} ORDER BY date DESC LIMIT 1`).then(v => v[0].neuerStatus);
            }
        },
        allUpdates: {
            type: new graphql_1.GraphQLList(_1.akStatus),
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM akPerson WHERE akID = ${parent.akID} AND personID = ${parent.personID}`);
            }
        }
    })
});
