"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const gb = v => (v < 10 ? '0' + v : v);
exports._timestamp = new graphql_1.GraphQLObjectType({
    name: 'TimeStampType',
    fields: () => ({
        day: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getDate();
                }
                else {
                    return null;
                }
            }
        },
        month: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getMonth() + 1;
                }
                else {
                    return null;
                }
            }
        },
        year: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getFullYear();
                }
                else {
                    return null;
                }
            }
        },
        h: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getHours();
                }
                else {
                    return null;
                }
            }
        },
        min: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getMinutes();
                }
                else {
                    return null;
                }
            }
        },
        s: {
            type: graphql_1.GraphQLInt,
            resolve(val) {
                if (val instanceof Date) {
                    return val.getSeconds();
                }
                else {
                    return null;
                }
            }
        },
        german: {
            type: graphql_1.GraphQLString,
            resolve(val) {
                if (val instanceof Date) {
                    return `${gb(val.getDate())}.${gb(val.getMonth() + 1)}.${val.getFullYear()} - ${gb(val.getHours())}:${gb(val.getMinutes())}`;
                }
                else {
                    return null;
                }
            }
        }
    })
});
