"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    addAK: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            bezeichnung: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async function (_, args) {
            await mysql_1.query(`INSERT INTO ak (bezeichnung) VALUES ('${args.bezeichnung}')`);
            const ak = await mysql_1.query(`SELECT akID FROM ak WHERE bezeichnung = '${args.bezeichnung}'`);
            return ak[0].akID;
        }, 'addAK'),
    },
    editAK: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            akID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            bezeichnung: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async function (_, args) {
            await mysql_1.query(`UPDATE ak SET bezeichnung = '${args.bezeichnung}' WHERE akID = ${args.akID}`);
            return true;
        }, 'editAK'),
    },
    updateAKStatus: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            personID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            akID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            date: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            status: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${args.personID}, ${args.akID}, '${args.date}', ${args.status})`);
        }, 'updateAKStatus'),
    },
};
