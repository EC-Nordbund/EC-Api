"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schema_1 = require("./schema");
const version_1 = require("./version");
const apollo_server_express_1 = require("apollo-server-express");
const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");
exports.getApp = (dev) => {
    const app = express()
        .use(cors())
        .use('/graphql', bodyParser.json(), apollo_server_express_1.graphqlExpress({
        schema: schema_1.schema,
    }))
        .use('/check', (req, res) => {
        res.end('{online: true}');
    });
    if (dev) {
        return app.use('/graphiql', apollo_server_express_1.graphiqlExpress({
            endpointURL: '/graphql',
        }));
    }
    else {
        return app.use('/version', (req, res) => {
            res.end(`{"version": "${version_1.appVersion}"}`);
        });
    }
};
