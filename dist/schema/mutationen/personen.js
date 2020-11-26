"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fz_1 = require("../../serienbrief/fz");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const Promise = require("bluebird");
const graphql_1 = require("graphql");
exports.default = {
    editPersonStamm: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            vorname: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            nachname: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gebDat: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlecht: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return new Promise((resolve, reject) => {
                mysql_1.query(`UPDATE personen SET vorname = '${args.vorname}', nachname = '${args.nachname}', gebDat = '${args.gebDat}', geschlecht = '${args.geschlecht}' WHERE personID = ${args.personID}`)
                    .then(v => {
                    return true;
                })
                    .then(resolve)
                    .catch(reject);
            });
        }, 'editPersonStamm'),
    },
    addPerson: {
        description: 'Comming Soon...',
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        args: sonstiges_1.addAuth({
            vorname: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            nachname: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gebDat: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlecht: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return new Promise((resolve, reject) => {
                mysql_1.query(`INSERT INTO personen (vorname, nachname, gebDat, geschlecht) VALUES ('${args.vorname}', '${args.nachname}', '${args.gebDat}', '${args.geschlecht}')`)
                    .then(v => {
                    mysql_1.query(`SELECT personID FROM personen WHERE vorname = '${args.vorname}' AND nachname = '${args.nachname}' AND gebDat = '${args.gebDat}'`)
                        .then(res => res[0].personID)
                        .then(v => {
                        return v;
                    })
                        .then(resolve)
                        .catch(reject);
                })
                    .catch(reject);
            });
        }, 'addPerson'),
    },
    addFZ: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            gesehenAm: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            fzVon: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gesehenVon: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            kommentar: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`INSERT INTO fz (personID, gesehenAm, gesehenVon, kommentar, fzVon) VALUES (${args.personID}, '${args.gesehenAm}', ${args.gesehenVon}, '${args.kommentar}', '${args.fzVon}')`).then(v => {
                mysql_1.query(`DELETE FROM fzAntrag WHERE personID = ${args.personID}`);
            });
        }, 'addFZ'),
    },
    addFZAntrag: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            personID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            email: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            }
        }),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            await fz_1.createFZ(args.personID, args.email);
            await mysql_1.query(`INSERT INTO fzAntrag (personID) VALUES (${args.personID})`);
        }, 'addFZAntrag'),
    },
    editSonstiges: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            personID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            juLeiCaNr: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ecMitglied: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            ecKreis: {
                type: graphql_1.GraphQLInt,
            },
            Fuehrerschein: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            Rettungsschwimmer: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            ErsteHilfe: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            notizen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`UPDATE personen SET juLeiCaNr="${args.juLeiCaNr}",ecKreis=${args.ecKreis ? args.ecKreis : null},ecMitglied=${args.ecMitglied}, Fuehrerschein=${args.Fuehrerschein},Rettungsschwimmer=${args.Rettungsschwimmer},ErsteHilfe=${args.ErsteHilfe},Notizen="${args.notizen}" WHERE personID=${args.personID}`);
        }, 'editPersonSonstiges'),
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
            mysql_1.query(`INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${args.personID}, ${args.akID}, ${args.date}, ${args.status})`);
        }, 'updateAKStatus'),
    },
    mergePersons: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID_richtig: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            personID_falsch: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            await mergePersonen(args);
        }, 'mergePersonen'),
    },
    noMerge: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            personID_1: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            personID_2: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            await mysql_1.query(`INSERT INTO keineDublikate (personID_1, personID_2) VALUES (${args.personID_1},${args.personID_2}), (${args.personID_2},${args.personID_1})`);
        }, 'mergePersonen'),
    },
    handleOldMerge: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({}),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            let handle = await mysql_1.query(`SELECT d.zielPersonID as personID_richtig, p.personID as personID_falsch FROM dublikate d, personen p WHERE d.vorname = p.vorname AND d.nachname = p.nachname AND d.gebDat = p.gebDat`);
            await Promise.all(handle.map(mergePersonen));
        }, 'mergePersonen'),
    },
};
async function mergePersonen(args) {
    let mergeTabeles = ['adressen', 'akPerson', 'anmeldungen', 'eMails', 'fz', 'fzAntrag', 'telefone', 'juleica', 'tagsPersonen']
        .map(table => `UPDATE IGNORE ${table} SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch}`)
        .map(sql => mysql_1.query(sql));
    await Promise.all(mergeTabeles);
    let mergeTabeles2 = ['adressen', 'eMails', 'telefone']
        .map(table => `DELETE IGNORE FROM ${table} WHERE personID = ${args.personID_falsch}`)
        .map(sql => mysql_1.query(sql));
    await Promise.all(mergeTabeles2);
    let telefone = await mysql_1.query(`SELECT * FROM telefone WHERE personID = ${args.personID_falsch}`);
    let telProms = telefone.map(async (tel) => {
        let newTelID = await mysql_1.query(`SELECT telefonID FROM telefone WHERE telefon = '${tel.telefon}' AND personID = ${tel.personID}`);
        await mysql_1.query(`UPDATE anmeldungen SET telefonID = ${newTelID[0].telefonID} WHERE telefonID = ${args.personID_richtig}`);
    });
    await Promise.all(telProms);
    let emails = await mysql_1.query(`SELECT * FROM eMails WHERE personID = ${args.personID_falsch}`);
    let mailProms = emails.map(async (mail) => {
        let newMailID = await mysql_1.query(`SELECT eMailID FROM eMails WHERE eMail = '${mail.eMail}' AND personID = ${args.personID_richtig}`);
        await mysql_1.query(`UPDATE anmeldungen SET eMailID = ${newMailID[0].eMailID} WHERE eMailID = ${mail.eMailID}`);
    });
    await Promise.all(mailProms);
    let adressen = await mysql_1.query(`SELECT * FROM adressen WHERE personID = ${args.personID_falsch}`);
    let adressProms = adressen.map(async (adresse) => {
        let newAdressID = await mysql_1.query(`SELECT adressID FROM adressen WHERE strasse = '${adresse.strasse}' AND plz = '${adresse.plz}' AND ort = '${adresse.ort}' AND personID = ${args.personID_richtig}`);
        await mysql_1.query(`UPDATE anmeldungen SET adressID = ${newAdressID[0].adressID} WHERE adressID = ${adresse.adressID}`);
    });
    await Promise.all(adressProms);
    let mergeTabeles3 = ['adressen', 'eMails', 'telefone']
        .map(table => `DELETE IGNORE FROM ${table} WHERE personID = ${args.personID_falsch}`)
        .map(sql => mysql_1.query(sql));
    await Promise.all(mergeTabeles3);
    await mysql_1.query(`UPDATE fz SET gesehenVon = ${args.personID_richtig} WHERE gesehenVon = ${args.personID_falsch}`);
    await mysql_1.query(`UPDATE dublikate SET zielPersonID = ${args.personID_richtig} WHERE zielPersonID = ${args.personID_falsch}`);
    let wrongData = await mysql_1.query(`SELECT vorname, nachname, gebDat FROM personen WHERE personID = ${args.personID_falsch}`);
    await mysql_1.query(`DELETE FROM personen WHERE personID = ${args.personID_falsch}`);
    await mysql_1.query(`INSERT INTO dublikate (vorname, nachname, gebDat, zielPersonID) VALUES ('${wrongData[0].vorname}','${wrongData[0].nachname}','${wrongData[0].gebDat.toISOString().split('T')[0]}',${args.personID_richtig})`);
}
