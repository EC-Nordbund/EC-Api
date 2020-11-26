"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    vorte: {
        description: 'Returnt Liste der vorteen',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.vorte),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM vOrte`);
        })
    },
    vort: {
        args: sonstiges_1.addAuth({
            vOrtID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der vorteen'
            }
        }),
        type: types_1.vorte,
        description: 'vorte mit einer bestimmten ID',
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM vOrte WHERE vOrtID = ${args.vOrtID}`).then(res => res[0]);
        })
    }
};
