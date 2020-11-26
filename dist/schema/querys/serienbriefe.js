"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    serienbriefe: {
        description: 'Returnt Liste der serienbriefen',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.serienbrief),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM serienbriefe`);
        })
    },
    serienbrief: {
        args: sonstiges_1.addAuth({
            sbID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der serienbriefen'
            }
        }),
        type: types_1.serienbrief,
        description: 'serienbrief mit einer bestimmten ID',
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM serienbriefe WHERE sbID = ${args.sbID}`).then(res => res[0]);
        })
    }
};
