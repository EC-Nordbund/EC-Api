"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
const graphql_1 = require("graphql");
const mysql_1 = require("../mysql");
exports._user = new graphql_1.GraphQLObjectType({
    name: 'user',
    fields: () => ({
        userID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
        },
        userName: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
        },
        person: {
            type: new graphql_1.GraphQLNonNull(_1.person),
            resolve(_) {
                return mysql_1.query(`SELECT * FROM personen WHERE personID = ${_.personID}`).then(v => v[0]);
            }
        },
        ablaufDatum: {
            type: new graphql_1.GraphQLNonNull(_1.date),
            resolve(_) {
                return new Date(_.ablaufDatum);
            }
        },
        userGroup: {
            type: new graphql_1.GraphQLNonNull(_1.userGroup)
        }
    })
});
