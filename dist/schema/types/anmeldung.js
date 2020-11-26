"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const _1 = require(".");
const graphql_1 = require("graphql");
exports._anmeldung = new graphql_1.GraphQLObjectType({
    name: 'anmeldung',
    fields: () => ({
        anmeldeID: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
        person: {
            type: new graphql_1.GraphQLNonNull(_1.person),
            async resolve(parent) {
                const person = await mysql_1.query(`SELECT * FROM personen WHERE personID = ${parent.personID}`);
                return person[0];
            },
        },
        veranstaltung: {
            type: new graphql_1.GraphQLNonNull(_1.veranstaltung),
            async resolve(parent) {
                const veranstaltung = await mysql_1.query(`SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${parent.veranstaltungsID}`);
                return veranstaltung[0];
            },
        },
        position: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        adresse: {
            type: new graphql_1.GraphQLNonNull(_1.adresse),
            async resolve(parent) {
                const adresse = await mysql_1.query(`SELECT * FROM adressen WHERE adressID = ${parent.adressID}`);
                return adresse[0];
            },
        },
        email: {
            type: new graphql_1.GraphQLNonNull(_1.email),
            async resolve(parent) {
                const email = await mysql_1.query(`SELECT * FROM eMails WHERE eMailID = ${parent.eMailID}`);
                return email[0];
            },
        },
        telefon: {
            type: new graphql_1.GraphQLNonNull(_1.telefon),
            async resolve(parent) {
                const telefon = await mysql_1.query(`SELECT * FROM telefone WHERE telefonID = ${parent.telefonID}`);
                return telefon[0];
            },
        },
        wartelistenPlatz: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        },
        bisherBezahlt: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLFloat),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'finanzen',
                })) {
                    return parent.bisherBezahlt;
                }
                else {
                    return null;
                }
            },
        },
        anmeldeZeitpunkt: {
            type: new graphql_1.GraphQLNonNull(_1.timeStamp),
        },
        abmeldeZeitpunkt: {
            type: _1.timeStamp,
        },
        abmeldeGebuehr: {
            type: graphql_1.GraphQLInt,
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'finanzen',
                })) {
                    return parent.abmeldeGebuehr;
                }
                else {
                    return null;
                }
            },
        },
        wegDerAbmeldung: {
            type: graphql_1.GraphQLString,
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'abmeldung',
                })) {
                    return parent.wegDerAbmeldung;
                }
                else {
                    return null;
                }
            },
        },
        rueckbezahlt: {
            type: graphql_1.GraphQLFloat,
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'finanzen',
                })) {
                    return parent.rueckbezahlt;
                }
                else {
                    return null;
                }
            },
        },
        kommentarAbmeldung: {
            type: graphql_1.GraphQLString,
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'abmeldung',
                })) {
                    return parent.kommentarAbmeldung;
                }
                else {
                    return null;
                }
            },
        },
        vegetarisch: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'bemerkungen',
                })) {
                    return parent.vegetarisch;
                }
                else {
                    return null;
                }
            },
        },
        lebensmittelAllergien: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'bemerkungen',
                })) {
                    return parent.lebensmittelAllergien;
                }
                else {
                    return null;
                }
            },
        },
        gesundheitsinformationen: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'bemerkungen',
                })) {
                    return parent.gesundheitsinformationen;
                }
                else {
                    return null;
                }
            },
        },
        bemerkungen: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'bemerkungen',
                })) {
                    return parent.bemerkungen;
                }
                else {
                    return null;
                }
            },
        },
        radfahren: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.radfahren;
                }
                else {
                    return null;
                }
            },
        },
        fahrgemeinschaften: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.fahrgemeinschaften;
                }
                else {
                    return null;
                }
            },
        },
        klettern: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.klettern;
                }
                else {
                    return null;
                }
            },
        },
        sichEntfernen: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.sichEntfernen;
                }
                else {
                    return null;
                }
            },
        },
        bootFahren: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.bootFahren;
                }
                else {
                    return null;
                }
            },
        },
        schwimmen: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            resolve(parent, args, context) {
                if (context.user.checkAlowedFileds({
                    table: 'anmeldungen',
                    field: 'erlaubnisse',
                })) {
                    return parent.schwimmen;
                }
                else {
                    return null;
                }
            },
        },
        DSGVO_einverstaendnis: {
            type: new graphql_1.GraphQLNonNull(_1.timeStamp),
        },
        infoBrief: {
            type: _1.timeStamp,
        },
        bestaetigungsBrief: {
            type: _1.timeStamp,
        },
        extra_json: {
            type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        },
    }),
});
