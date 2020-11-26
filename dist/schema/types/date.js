"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const gb = v => (v < 10 ? '0' + v : v);
exports._date = new graphql_1.GraphQLObjectType({
    name: 'DateType',
    description: 'Ein Datum',
    fields: () => ({
        day: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            description: 'Tag des Datums.',
            resolve(val) {
                return val.getDate();
            }
        },
        month: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            description: 'Monat des Datums.',
            resolve(val) {
                return val.getMonth() + 1;
            }
        },
        year: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            description: 'Jahr des Datum.',
            resolve(val) {
                return val.getFullYear();
            }
        },
        german: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            description: 'TT.MM.YYYY layout des Datum.',
            resolve(val) {
                return `${gb(val.getDate())}.${gb(val.getMonth() + 1)}.${val.getFullYear()}`;
            }
        },
        input: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            description: 'YYYY-MM-TT layout des Datum.',
            resolve(val) {
                return `${val.getFullYear()}-${gb(val.getMonth() + 1)}-${gb(val.getDate())}`;
            }
        }
    })
});
