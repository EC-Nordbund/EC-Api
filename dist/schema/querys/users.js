"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const types_1 = require("../types");
const users_1 = require("../../users");
const sonstiges_1 = require("../sonstiges");
exports.default = {
    users: {
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth(),
        type: new graphql_1.GraphQLList(types_1.user),
        resolve: sonstiges_1.handleAuth((_, args) => {
            return users_1.getUser(args.authToken).userGroup
                .bezeichnung === 'admin'
                ? users_1.users
                : [];
        })
    },
    userGroups: {
        description: 'Comming Soon...',
        type: new graphql_1.GraphQLList(types_1.userGroup),
        args: sonstiges_1.addAuth(),
        resolve: sonstiges_1.handleAuth((_, args) => {
            return users_1.getUser(args.authToken).userGroup
                .bezeichnung === 'admin'
                ? users_1.userGroups
                : [];
        })
    },
    getMyUserData: {
        type: types_1.user,
        args: sonstiges_1.addAuth(),
        description: 'Comming Soon...',
        resolve: sonstiges_1.handleAuth((_, args) => {
            return users_1.getUser(args.authToken);
        })
    }
};
