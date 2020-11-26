"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const Promise = require("bluebird");
const graphql_1 = require("graphql");
exports.default = {
    useAdresse: {
        type: graphql_1.GraphQLBoolean,
        description: 'Update last Used of Adress',
        args: sonstiges_1.addAuth({
            adressID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Adresse',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE adressen SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${args.adressID}`);
        }, 'oldStatusKontakt'),
    },
    markAdressAsOld: {
        type: graphql_1.GraphQLBoolean,
        description: 'Set Adress as OLD',
        args: sonstiges_1.addAuth({
            adressID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Adresse',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE adressen SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${args.adressID}`);
        }, 'oldStatusKontakt'),
    },
    useEmail: {
        type: graphql_1.GraphQLBoolean,
        description: 'Update last Used of Email',
        args: sonstiges_1.addAuth({
            emailID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Email',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE eMails SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${args.emailID}`);
        }, 'oldStatusKontakt'),
    },
    markEmailAsOld: {
        type: graphql_1.GraphQLBoolean,
        description: 'Set Email as OLD',
        args: sonstiges_1.addAuth({
            emailID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Email',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE eMails SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${args.emailID}`);
        }, 'oldStatusKontakt'),
    },
    useTelefon: {
        type: graphql_1.GraphQLBoolean,
        description: 'Update last Used of Telefon',
        args: sonstiges_1.addAuth({
            telefonID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Telfonnummer',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE telefone SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${args.telefonID}`);
        }, 'oldStatusKontakt'),
    },
    markTelefonAsOld: {
        type: graphql_1.GraphQLBoolean,
        description: 'Set Telefon as OLD',
        args: sonstiges_1.addAuth({
            telefonID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                description: 'ID der benutzen Telfonnummer',
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE telefone SET isOld=1, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${args.telefonID}`);
        }, 'oldStatusKontakt'),
    },
    addAdresse: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            strasse: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            plz: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ort: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return new Promise((resolve, reject) => {
                mysql_1.query(`INSERT INTO adressen (personID, strasse, plz, ort) VALUES (${args.personID}, '${args.strasse}', '${args.plz}', '${args.ort}')`)
                    .then(v => {
                    mysql_1.query(`SELECT adressID FROM adressen WHERE personID = ${args.personID} AND strasse = '${args.strasse}' AND plz = '${args.plz}' AND ort = '${args.ort}'`)
                        .then(res => res[0].adressID)
                        .then(resolve)
                        .catch(reject);
                })
                    .catch(reject);
            });
        }, 'addKontakt'),
    },
    addEmail: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            email: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return new Promise((resolve, reject) => {
                mysql_1.query(`INSERT INTO eMails (personID, eMail) VALUES (${args.personID}, '${args.email}')`)
                    .then(v => {
                    mysql_1.query(`SELECT eMailID FROM eMails WHERE personID = ${args.personID} AND eMail = '${args.email}'`)
                        .then(res => res[0].eMailID)
                        .then(resolve)
                        .catch(reject);
                })
                    .catch(reject);
            });
        }, 'addKontakt'),
    },
    addTelefon: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            personID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            telefon: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return new Promise((resolve, reject) => {
                mysql_1.query(`INSERT INTO telefone (personID, telefon) VALUES (${args.personID}, '${args.telefon}')`)
                    .then(v => {
                    mysql_1.query(`SELECT telefonID FROM telefone WHERE personID = ${args.personID} AND telefon = '${args.telefon}'`)
                        .then(res => res[0].telefonID)
                        .then(resolve)
                        .catch(reject);
                })
                    .catch(reject);
            });
        }, 'addKontakt'),
    },
    editAdresse: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            adressID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            strasse: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            plz: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            ort: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE adressen SET strasse = '${args.strasse}', plz = '${args.plz}', ort = '${args.ort}' WHERE adressID = ${args.adressID}`).then(v => {
                return true;
            });
        }, 'editKontakt'),
    },
    editEmail: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            emailID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            email: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE eMails SET eMail = '${args.email}' WHERE eMailID=${args.emailID}`).then(v => {
                return true;
            });
        }, 'editKontakt'),
    },
    editTelefon: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            telefonID: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            telefon: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE telefone SET telefon = '${args.telefon}' WHERE telefonID=${args.telefonID}`).then(v => true);
        }, 'editKontakt'),
    },
    deleteAdresse: {
        type: graphql_1.GraphQLBoolean,
        description: 'Löschen einer Adresse',
        args: sonstiges_1.addAuth({
            adressID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`DELETE FROM adressen WHERE adressID = ${args.adressID}`);
        }, 'deleteKontakt'),
    },
    deleteEMail: {
        type: graphql_1.GraphQLBoolean,
        description: 'Löschen einer Adresse',
        args: sonstiges_1.addAuth({
            emailID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`DELETE FROM eMails WHERE eMailID = ${args.emailID}`);
        }, 'deleteKontakt'),
    },
    deleteTelefon: {
        type: graphql_1.GraphQLBoolean,
        description: 'Löschen einer Adresse',
        args: sonstiges_1.addAuth({
            telefonID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`DELETE FROM telefone WHERE telefonID = ${args.telefonID}`);
        }, 'deleteKontakt'),
    },
    mergeAdresse: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            adressID_richtig: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            adressID_falsch: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            await mysql_1.query(`UPDATE anmeldungen SET adressID = ${args.adressID_richtig} WHERE adressID = ${args.adressID_falsch}`);
            await mysql_1.query(`DELETE adresse WHERE adressID = ${args.adressID_falsch}`);
        }, 'mergePersonen'),
    },
    mergeTelefon: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: sonstiges_1.addAuth({
            telefonID_richtig: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            telefonID_falsch: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async (_, args) => {
            await mysql_1.query(`UPDATE anmeldungen SET telefonID = ${args.telefonID_richtig} WHERE telefonID = ${args.telefonID_falsch}`);
            await mysql_1.query(`DELETE telefone WHERE telefonID = ${args.telefonID_falsch}`);
        }, 'mergePersonen'),
    },
};
