"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const users_1 = require("../users");
const graphql_1 = require("graphql");
function addAuth(args = {}) {
    args.authToken = {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        description: 'Authentifizierungs-Token',
    };
    return args;
}
exports.addAuth = addAuth;
function handleAuth(cb) {
    return function (parent, args, context, info) {
        context.user = users_1.getUser(args.authToken);
        return cb(parent, args, context, info);
    };
}
exports.handleAuth = handleAuth;
function handleAllowed(cb, queryName) {
    return function (parent, args, context, info) {
        const myUserGroup = users_1.getUser(args.authToken).userGroup;
        if (myUserGroup.mutationRechte.indexOf(queryName) !== -1) {
            return cb(parent, args, context, info);
        }
        else {
            throw 'Not allowed';
        }
    };
}
exports.handleAllowed = handleAllowed;
function checkAuth(authToken) {
    return users_1.getUser(authToken) !== undefined;
}
exports.checkAuth = checkAuth;
