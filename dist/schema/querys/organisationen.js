"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    orgas: {
        description: 'Returnt Liste der vorteen',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.organisation),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM organisationen`);
        })
    },
    orga: {
        args: sonstiges_1.addAuth({
            organisationsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der vorteen'
            }
        }),
        type: types_1.organisation,
        description: 'vorte mit einer bestimmten ID',
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM organisationen WHERE organisationsID = ${args.organisationsID}`).then(res => res[0]);
        })
    }
};
