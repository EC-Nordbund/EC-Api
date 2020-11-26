"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const nichtErlaubteVersionen_1 = require("../../nichtErlaubteVersionen");
const users_1 = require("../../users");
const mail_1 = require("../mail");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
exports.default = {
    logOut: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
        description: 'Abmelden',
        args: sonstiges_1.addAuth(),
        resolve(_, args) {
            return users_1.logout(args.authToken);
        },
    },
    logIn: {
        type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
        description: 'Anmelden',
        args: {
            username: {
                description: 'Benutzername',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            password: {
                description: 'Passwort',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            version: {
                description: 'Version der APP',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        },
        resolve(_, args) {
            if (nichtErlaubteVersionen_1.versions.includes(args.version)) {
                throw 'Version nicht erlaubt';
            }
            return users_1.login(args.username, args.password);
        },
    },
    addUser: {
        type: graphql_1.GraphQLBoolean,
        description: 'Benutzer hinzufügen',
        args: sonstiges_1.addAuth({
            username: {
                description: 'Benutzername',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            email: {
                description: 'E-Mail an die das Passwort gesendet wird',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            personID: {
                description: 'Person die dem User zugeordnet wird',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            userGroupID: {
                description: 'ID der Benutzergruppe (Rechte).',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            ablaufDatum: {
                description: 'Zeitpunkt an dem der User ungültig wird',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return users_1.addUser(args.personID, args.username, args.email, args.ablaufDatum, args.userGroupID);
        }, 'editUser'),
    },
    editUser: {
        type: graphql_1.GraphQLBoolean,
        description: 'Benutzer editieren',
        args: sonstiges_1.addAuth({
            userID: {
                description: 'Welcher Benutzer soll editiert werden',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            userGroupID: {
                description: 'ID der neuen Benutzergruppe',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            ablaufDatum: {
                description: 'Von Zeitpunkt an dem der User ungültig wird',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return users_1.updateUser(args.userID, args.ablaufDatum, args.userGroupID);
        }, 'editUser'),
    },
    deleteUser: {
        type: graphql_1.GraphQLBoolean,
        description: 'Benutzer löschen',
        args: sonstiges_1.addAuth({
            userID: {
                description: 'ID des Benutzer',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return users_1.deleteUser(args.userID);
        }, 'editUser'),
    },
    passwordWechseln: {
        type: graphql_1.GraphQLBoolean,
        description: 'Passwort wechseln',
        args: sonstiges_1.addAuth({
            oldPWD: {
                description: 'Altes Passwort',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            newPWD: {
                description: 'Neues Passwort',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve(_, args) {
            return users_1.changePWD(users_1.getUser(args.authToken).userID, args.oldPWD, args.newPWD);
        },
    },
    acceptsDSE: {
        type: graphql_1.GraphQLBoolean,
        description: 'Datenschutzhinweise akzeptieren',
        args: sonstiges_1.addAuth(),
        async resolve(_, args) {
            const dse = await mysql_1.query(`SELECT * FROM dse WHERE guelitgAb < CURRENT_TIMESTAMP ORDER BY guelitgAb DESC LIMIT 1`).then(v => v[0]);
            await mysql_1.query(`INSERT INTO DSGVO_Person (personID, dseID) VALUES (${users_1.getUser(args.authToken).userID}, ${dse.DSEID});`);
            return true;
        },
    },
    addDSE: {
        type: graphql_1.GraphQLBoolean,
        description: 'Neue Datenschutz',
        args: sonstiges_1.addAuth({
            text: {
                description: 'HTML der Datenschutzhinweise',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`INSERT INTO dse (text) VALUES ("${args.text}")`).then(v => true);
        }, 'editDSE'),
    },
    feedback: {
        type: graphql_1.GraphQLBoolean,
        description: 'Comming Soon...',
        args: {
            gesamt: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            handhabung: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            funktionswunsch: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            bug: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            sonstiges: {
                description: 'Comming Soon...',
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        },
        resolve(_, args) {
            return mail_1.default('feedback@ec-nordbund.de', { to: 'app@ec-nordbund.de' }, 'Feedback', `Gesamtbewertung: ${args.gesamt}/5<br/>
          Handhabung: ${args.handhabung}/5<br/>
          Funktionswunsch: ${args.funktionswunsch}<br/>
          Bug: ${args.bug}<br/>
          Sonstiges: ${args.sonstiges}`);
        },
    },
    reActivate: {
        type: graphql_1.GraphQLBoolean,
        args: {
            authToken: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
            },
            pin: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString)
            }
        },
        resolve(_, args) {
            return users_1.userReactivation(args.authToken, args.pin);
        },
    },
};
