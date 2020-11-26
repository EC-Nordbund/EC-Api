"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const users_1 = require("../../users");
exports.default = {
    alerts: {
        type: new graphql_1.GraphQLList(types_1.alert),
        description: 'Gibt liste der Letzten 10 Alerts aus.',
        resolve() {
            return mysql_1.query('SELECT * from alertWidget ORDER BY alertID DESC LIMIT 10');
        }
    },
    getDSE: {
        type: graphql_1.GraphQLString,
        args: sonstiges_1.addAuth({
            force: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
                description: 'Zwingen die aktuelle DSE anzuzeigen'
            }
        }),
        description: 'Ausgabe der DSE für eine bestimmten User',
        async resolve(parent, args) {
            const userID = users_1.getUser(args.authToken).userID;
            const currVersion = await mysql_1.query(`SELECT * FROM DSGVO_Person WHERE personID = ${userID} ORDER BY ts DESC LIMIT 1`);
            const dse = await mysql_1.query(`SELECT * FROM dse WHERE guelitgAb < CURRENT_TIMESTAMP ORDER BY guelitgAb DESC LIMIT 1`).then(v => v[0]);
            if (args.force) {
                return dse.text;
            }
            else {
                if (currVersion.length === 0) {
                    return dse.text;
                }
                else {
                    if (currVersion[0].dseID < dse.DSEID) {
                        return dse.text;
                    }
                    else {
                        if (new Date().getTime() -
                            currVersion[0].ts.getTime() >=
                            24 * 60 * 60 * 1000 * 6 * 30.5) {
                            return dse.text;
                        }
                        else {
                            return null;
                        }
                    }
                }
            }
        }
    }
};
