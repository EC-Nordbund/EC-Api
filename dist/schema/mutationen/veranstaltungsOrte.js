"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    addVeranstaltungsort: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            strasse: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            plz: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ort: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            land: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            organisationsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO vOrte(bezeichnung, strasse, plz, ort, land, organisitationID) VALUES("${args.bezeichnung}", "${args.strasse}", "${args.plz}", "${args.ort}", "${args.land}", "${args.organisationsID}")`);
        }, 'vorte'),
    },
    veranstaltungsortEditStamm: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            vOrtID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            bezeichnung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            strasse: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            plz: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ort: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            land: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            organisationsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE vOrte SET bezeichnung = "${args.bezeichnung}", strasse = "${args.strasse}",  plz= "${args.plz}", ort = "${args.ort}",land  = "${args.land}", organisitationID=${args.organisationsID} WHERE vOrtID = ${args.vOrtID}`);
        }, 'vorte'),
    },
    veranstaltungsortEditSonstiges: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            vOrtID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            anzahl_min: {
                type: graphql_1.GraphQLInt,
            },
            anzahl_max: {
                type: graphql_1.GraphQLInt,
            },
            selbstversorger: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            vollverpflegung: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            notizen: {
                type: graphql_1.GraphQLString,
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE vOrte SET anzahl_min=${args.anzahl_min}, anzahl_max=${args.anzahl_max}, notizen = ${args.notizen ? '"' + args.notizen + '"' : null}, vollverpflegung=${args.vollverpflegung}, selbstversorger=${args.selbstversorger} WHERE vOrtID = ${args.vOrtID}`);
        }, 'vorte'),
    },
    veranstaltungsortAddKontakt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            vOrtID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            ansprechpartner: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            typ: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            telefon: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            email: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO vOrtKontakt (vOrt, ansprechpartner, typ, telefon, email) VALUES (${args.vOrtID}, "${args.ansprechpartner}", "${args.typ}", "${args.telefon}", "${args.email}")`);
        }, 'vorte'),
    },
    veranstaltungsortEditKontakt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            vOrtKontaktID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            ansprechpartner: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            typ: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            telefon: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            email: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            notizen: {
                type: graphql_1.GraphQLString,
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE vOrtKontakt SET ansprechpartner="${args.ansprechpartner}", typ="${args.typ}", telefon="${args.telefon}", email="${args.email}", notizen="${args.notizen}" WHERE vOrtKontaktID= ${args.vOrtKontaktID}`);
        }, 'vorte'),
    },
    veranstaltungsortDeleteKontakt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            vOrtKontaktID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`DELETE FROM vOrtKontakt WHERE vOrtKontaktID = ${args.vOrtKontaktID}`);
        }, 'vorte'),
    },
};
