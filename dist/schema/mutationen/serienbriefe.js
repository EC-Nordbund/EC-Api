"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    serienbriefAdd: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            docx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlecht: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO serienbriefe(bezeichnung, docxDocument, geschlechterspizifischeAttribute) VALUES ("${args.bezeichnung}","${args.docx}","${args.geschlecht}")`);
        }, 'serienbrief'),
    },
    serienbriefEdit: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            sbID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            docx: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlecht: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE serienbriefe SET bezeichnung="${args.bezeichnung}", docxDocument="${args.docx}", geschlechterspizifischeAttribute="${args.geschlecht}"`);
        }, 'serienbrief'),
    },
};
