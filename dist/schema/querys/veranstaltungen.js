"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    veranstaltungen: {
        description: 'Returnt Liste der Veranstaltungen',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.veranstaltung),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM veranstaltungen`);
        })
    },
    veranstaltung: {
        args: sonstiges_1.addAuth({
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der Veranstaltungen'
            }
        }),
        type: types_1.veranstaltung,
        description: 'Veranstaltung mit einer bestimmten ID',
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${args.veranstaltungsID}`).then(res => res[0]);
        })
    }
};
