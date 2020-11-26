"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ak_1 = require("./mutationen/ak");
const anmeldungen_1 = require("./mutationen/anmeldungen");
const kontakt_1 = require("./mutationen/kontakt");
const organisation_1 = require("./mutationen/organisation");
const personen_1 = require("./mutationen/personen");
const serienbriefe_1 = require("./mutationen/serienbriefe");
const sonstiges_1 = require("./mutationen/sonstiges");
const users_1 = require("./mutationen/users");
const veranstaltungen_1 = require("./mutationen/veranstaltungen");
const veranstaltungsOrte_1 = require("./mutationen/veranstaltungsOrte");
const ak_2 = require("./querys/ak");
const anmeldungen_2 = require("./querys/anmeldungen");
const dublikate_1 = require("./querys/dublikate");
const ecKreis_1 = require("./querys/ecKreis");
const organisationen_1 = require("./querys/organisationen");
const personen_2 = require("./querys/personen");
const serienbriefe_2 = require("./querys/serienbriefe");
const sonstiges_2 = require("./querys/sonstiges");
const users_2 = require("./querys/users");
const veranstaltungen_2 = require("./querys/veranstaltungen");
const veranstaltungsorte_1 = require("./querys/veranstaltungsorte");
const graphql_1 = require("graphql");
exports.schema = new graphql_1.GraphQLSchema({
    query: new graphql_1.GraphQLObjectType({
        name: 'rootQuery',
        description: 'Hauptabfrage Objekt',
        fields: Object.assign({}, ecKreis_1.default, dublikate_1.default, serienbriefe_2.default, sonstiges_2.default, personen_2.default, veranstaltungen_2.default, ak_2.default, anmeldungen_2.default, users_2.default, veranstaltungsorte_1.default, organisationen_1.default),
    }),
    mutation: new graphql_1.GraphQLObjectType({
        name: 'mutationRoot',
        description: 'Mutationen Objekt',
        fields: Object.assign({}, users_1.default, sonstiges_1.default, kontakt_1.default, personen_1.default, ak_1.default, organisation_1.default, veranstaltungen_1.default, veranstaltungsOrte_1.default, anmeldungen_1.default, serienbriefe_1.default),
    }),
});
