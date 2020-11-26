"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    ecKreise: {
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({}),
        type: new graphql_1.GraphQLList(types_1.ecKreis),
        resolve: sonstiges_1.handleAuth(() => mysql_1.query(`SELECT * FROM ecKreis`))
    }
};
