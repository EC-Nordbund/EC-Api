"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const mysql_1 = require("../mysql");
const users_1 = require("../../users");
const types_1 = require("../types");
const wpTokens = [process.env.WP_TOKEN];
const sonstiges_1 = require("../sonstiges");
exports.default = {
    anmeldungen: {
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({}),
        type: new graphql_1.GraphQLList(types_1.anmeldung),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM anmeldungen`);
        })
    },
    anmeldung: {
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            anmeldeID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
            }
        }),
        type: types_1.anmeldung,
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM anmeldungen WHERE anmeldeID = '${args.anmeldeID}'`).then(res => res[0]);
        })
    },
    anmeldeStatus: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        args: sonstiges_1.addAuth({
            anmeldeID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
            },
            isWP: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean)
            }
        }),
        resolve(_, args) {
            let allowed = false;
            if (args.isWP) {
                allowed = wpTokens.indexOf(args.token) !== -1;
            }
            else {
                allowed =
                    users_1.getUser(args.token).userGroup.mutationRechte.indexOf('anmelden') !==
                        -1;
            }
            if (allowed) {
                return mysql_1.query(`SELECT wartelistenPlatz, abmeldeZeitpunkt FROM anmeldungen WHERE anmeldeID='${args.anmeldeID}'`)
                    .then(row => row[0])
                    .then(row => {
                    if (row.abmeldeZeitpunkt) {
                        return -2;
                    }
                    else {
                        return row.wartelistenPlatz;
                    }
                });
            }
            else {
                return -1;
            }
        }
    }
};
