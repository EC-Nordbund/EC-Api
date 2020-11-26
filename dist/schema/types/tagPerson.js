"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const _1 = require(".");
const mysql_1 = require("../mysql");
exports._personTag = new graphql_1.GraphQLObjectType({
    name: 'personenTag',
    fields: () => ({
        tag: {
            type: _1.tag,
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM tag WHERE tagID = ${parent.tagID}`).then(v => v[0]);
            }
        },
        person: {
            type: _1.person,
            resolve(parent) {
                return mysql_1.query(`SELECT * FROM personen WHERE personID = ${parent.personID}`).then(v => v[0]);
            }
        },
        notiz: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        }
    })
});
