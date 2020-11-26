"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    addAlert: {
        type: graphql_1.GraphQLBoolean,
        description: 'Meldung in Dashboard hinzufügen',
        args: sonstiges_1.addAuth({
            msg: {
                description: 'Nachricht die angezeigt werden soll',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            von: {
                description: 'Autor der Nachricht',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO alertWidget (content, von) VALUES ('${args.msg}', '${args.von}');`)
                .then(v => true)
                .catch(err => {
                throw err;
            });
        }, 'addAlert'),
    },
};
