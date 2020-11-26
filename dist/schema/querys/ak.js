"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    aks: {
        args: sonstiges_1.addAuth(),
        description: 'Comming Soon...',
        type: new graphql_1.GraphQLList(types_1.ak),
        resolve: sonstiges_1.handleAuth(() => {
            return mysql_1.query(`SELECT * FROM ak`);
        })
    },
    ak: {
        args: sonstiges_1.addAuth({
            akID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt)
            }
        }),
        description: 'Comming Soon...',
        type: types_1.ak,
        resolve: sonstiges_1.handleAuth((_, args) => {
            return mysql_1.query(`SELECT * FROM ak WHERE akID = ${args.akID}`).then(res => res[0]);
        })
    }
};
