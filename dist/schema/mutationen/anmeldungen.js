"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fz_1 = require("../../serienbrief/fz");
const users_1 = require("../../users");
const mail_1 = require("../mail");
const mysql_1 = require("../mysql");
const sonstiges_1 = require("../sonstiges");
const graphql_1 = require("graphql");
const js_sha3_1 = require("js-sha3");
const wpTokens = [process.env.WP_TOKEN];
exports.default = {
    anmeldungBesonderheiten: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            vegetarisch: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            lebensmittelAllergien: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gesundheitsinformationen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            bemerkungen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE anmeldungen SET vegetarisch = ${args.vegetarisch}, lebensmittelAllergien="${args.lebensmittelAllergien}", gesundheitsinformationen="${args.gesundheitsinformationen}", bemerkungen="${args.bemerkungen}" WHERE anmeldeID="${args.anmeldeID}"`);
        }, 'anmeldungBesonderheiten'),
    },
    anmeldungBezahlt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            betrag: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLFloat),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            return mysql_1.query(`UPDATE anmeldungen SET bisherBezahlt = ${args.betrag} WHERE anmeldeID="${args.anmeldeID}"`);
        }, 'anmeldungFinanzen'),
    },
    anmeldungRueckbezahlt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            betrag: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLFloat),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`UPDATE anmeldungen SET rueckbezahlt = ${args.betrag} WHERE anmeldeID="${args.anmeldeID}"`);
        }, 'anmeldungFinanzen'),
    },
    anmeldungKontakt: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            adressID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            emailID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            telefonID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`UPDATE anmeldungen SET adressID=${args.adressID}, eMailID=${args.emailID}, telefonID=${args.telefonID} WHERE anmeldeID = '${args.anmeldeID}'`);
        }, 'anmeldungKontakt'),
    },
    abmelden: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gebuehr: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            weg: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            kommentar: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`UPDATE anmeldungen SET wartelistenPlatz=-1,abmeldeZeitpunkt=CURRENT_TIMESTAMP,abmeldeGebuehr=${args.gebuehr},wegDerAbmeldung="${args.weg}", kommentarAbmeldung="${args.kommentar}" WHERE anmeldeID = "${args.anmeldeID}"`);
            mail_1.default('automated@ec-nordbund.de', { to: "2pi_r2@gmx.de; BirgitHerbert@t-online.de; an-gela@gmx.net; referent@ec-nordbund.de" }, `Neue Abmeldung`, `<h1>Neue Abmeldung</h1><p>Es gibt eine Abmeldung mit der AnmeldeID: ${args.anmeldeID}<br>Klicke <a href="https://verwaltung.ec-nordbund.de/anmeldungen/${args.anmeldeID}/home">HIER</a> um die Anmeldung einzusehen.</p>`);
        }, 'anmeldungAbmelden'),
    },
    nachruecken: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed((_, args) => {
            mysql_1.query(`SELECT wartelistenPlatz, veranstaltungsID, geschlecht FROM anmeldungen, personen WHERE personen.personID = anmeldungen.personID AND anmeldeID = "${args.anmeldeID}"`)
                .then(row => row[0])
                .then(r => {
                mysql_1.query(`SELECT hatGWarteliste FROM veranstaltungen WHERE veranstaltungsID=${r.veranstaltungsID}`)
                    .then(row => row[0])
                    .then(v => {
                    if (v.hatGWarteliste) {
                        mysql_1.query(`UPDATE anmeldungen SET wartelistenPlatz=0 WHERE anmeldeID="${args.anmeldeID}"`).then(v => {
                            mysql_1.query(`UPDATE anmeldungen SET wartelistenPlatz=wartelistenPlatz-1 WHERE wartelistenPlatz > ${r.wartelistenPlatz} AND personen.personID = anmeldungen.personID AND personen.geschlecht = "${r.geschlecht}"`);
                        });
                    }
                    else {
                        mysql_1.query(`UPDATE anmeldungen SET wartelistenPlatz=0 WHERE anmeldeID="${args.anmeldeID}"`).then(v => {
                            mysql_1.query(`UPDATE anmeldungen SET wartelistenPlatz=wartelistenPlatz-1 WHERE wartelistenPlatz > ${r.wartelistenPlatz}`);
                        });
                    }
                });
            });
        }, 'anmeldungWarteliste'),
    },
    anmelden: {
        type: new graphql_1.GraphQLObjectType({
            name: 'anmeldeReturn',
            fields: {
                status: {
                    type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
                },
                anmeldeID: {
                    type: graphql_1.GraphQLString,
                },
            },
        }),
        args: {
            isWP: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            token: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            vorname: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            nachname: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gebDat: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            geschlecht: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            position: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            veranstaltungsID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            eMail: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            telefon: {
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
            anmeldeZeitpunkt: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            vegetarisch: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            lebensmittelAllergien: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            gesundheitsinformationen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            bemerkungen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
            radfahren: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            schwimmen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLInt),
            },
            fahrgemeinschaften: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            klettern: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            sichEntfernen: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            bootFahren: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLBoolean),
            },
            extra_json: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        },
        async resolve(_, args) {
            let allowed = false;
            if (args.isWP) {
                allowed = wpTokens.indexOf(args.token) !== -1;
            }
            else {
                allowed = users_1.getUser(args.token).userGroup.mutationRechte.indexOf('anmelden') !== -1;
            }
            if (allowed) {
                const j = JSON.stringify(args);
                const h = js_sha3_1.sha3_512(j);
                const d = new Date().toISOString();
                //writeFileSync(__dirname + '/../../../log/anmel_' + h + '_' + d + '.log.json', j)
                const vData = await mysql_1.query(`SELECT * FROM veranstaltungen WHERE veranstaltungsID = ${args.veranstaltungsID}`).then(row => row[0]);
                const anmeldeID_start = args.vorname.substr(0, 2) +
                    args.nachname.substr(0, 2) +
                    vData.kurzBezeichnung +
                    vData.begin
                        .getFullYear()
                        .toString()
                        .substr(2, 2);
                const anmeldeID_ende = args.position;
                let genFour = () => {
                    return Math.floor(Math.random() * 10).toString() + Math.floor(Math.random() * 10).toString() + Math.floor(Math.random() * 10).toString() + Math.floor(Math.random() * 10).toString();
                };
                let checkAnmeldeID = (id) => {
                    return mysql_1.query(`SELECT anmeldeID FROM anmeldungen WHERE anmeldeID = '${id}'`).then(v => v.length === 0);
                };
                let anmeldeID = anmeldeID_start + genFour() + anmeldeID_ende;
                while (!checkAnmeldeID(anmeldeID)) {
                    anmeldeID = anmeldeID_start + genFour() + anmeldeID_ende;
                }
                let persons = await mysql_1.query(`SELECT personID FROM personen WHERE vorname="${args.vorname}"AND  nachname="${args.nachname}" AND gebDat="${args.gebDat}"`);
                if (persons.length === 0) {
                    await mysql_1.query(`INSERT INTO personen (vorname, nachname, gebDat, geschlecht) VALUES ("${args.vorname}", "${args.nachname}", "${args.gebDat}", "${args.geschlecht}")`);
                    persons = await mysql_1.query(`SELECT personID FROM personen WHERE vorname="${args.vorname}"AND  nachname="${args.nachname}" AND gebDat="${args.gebDat}"`);
                }
                const personID = persons[0].personID;
                let eMails = await mysql_1.query(`SELECT eMailID FROM eMails WHERE eMail="${args.eMail}" AND personID=${personID}`);
                if (eMails.length === 0) {
                    await mysql_1.query(`INSERT INTO eMails(eMail, personID) VALUES ("${args.eMail}",${personID})`);
                    eMails = await mysql_1.query(`SELECT eMailID FROM eMails WHERE eMail="${args.eMail}" AND personID=${personID}`);
                }
                const eMailID = eMails[0].eMailID;
                let telefone = await mysql_1.query(`SELECT telefonID FROM telefone WHERE telefon="${args.telefon}" AND personID=${personID}`);
                if (telefone.length === 0) {
                    await mysql_1.query(`INSERT INTO telefone(telefon, personID) VALUES ("${args.telefon}",${personID})`);
                    telefone = await mysql_1.query(`SELECT telefonID FROM telefone WHERE telefon="${args.telefon}" AND personID=${personID}`);
                }
                const telefonID = telefone[0].telefonID;
                let adressen = await mysql_1.query(`SELECT adressID FROM adressen WHERE personID=${personID} AND strasse="${args.strasse}" AND plz="${args.plz}" AND ort="${args.ort}"`);
                if (adressen.length === 0) {
                    await mysql_1.query(`INSERT INTO adressen (personID, strasse, plz, ort) VALUES (${personID},"${args.strasse}","${args.plz}","${args.ort}")`);
                    adressen = await mysql_1.query(`SELECT adressID FROM adressen WHERE personID=${personID} AND strasse="${args.strasse}" AND plz="${args.plz}" AND ort="${args.ort}"`);
                }
                const adressID = adressen[0].adressID;
                const vorhandeneAnmeldungen = await mysql_1.query(`SELECT anmeldeID FROM anmeldungen WHERE personID=${personID} AND veranstaltungsID=${args.veranstaltungsID}`);
                if (vorhandeneAnmeldungen.length > 0) {
                    return {
                        status: -2,
                        anmeldeID: vorhandeneAnmeldungen[0].anmeldeID,
                    };
                }
                else {
                    let wartelistenplatz = 0;
                    if (args.position === 1) {
                        const maxWListPlatz = await mysql_1.query(`SELECT personen.geschlecht AS geschlecht, MAX(anmeldungen.wartelistenPlatz) AS maxWlistPos FROM anmeldungen, personen WHERE personen.personID = anmeldungen.personID AND anmeldungen.veranstaltungsID = ${args.veranstaltungsID} GROUP BY personen.geschlecht`);
                        const anzahlPersonen = await mysql_1.query(`SELECT COUNT(personen.personID) AS anzahlPersonen, personen.geschlecht AS geschlecht FROM personen, anmeldungen WHERE personen.personID = anmeldungen.personID AND anmeldungen.veranstaltungsID = ${args.veranstaltungsID} AND anmeldungen.wartelistenPlatz = 0 GROUP BY personen.geschlecht`);
                        let maxWlistMännlich = 0;
                        let maxWlistWeiblich = 0;
                        let anzahlMännlich = 0;
                        let anzahlWeiblich = 0;
                        maxWListPlatz.forEach(per => {
                            switch (per.geschlecht) {
                                case 'm':
                                    maxWlistMännlich = per.maxWlistPos;
                                    break;
                                case 'w':
                                    maxWlistWeiblich = per.maxWlistPos;
                                    break;
                            }
                        });
                        const maxWlistGesamt = Math.max(maxWlistMännlich, maxWlistWeiblich);
                        anzahlPersonen.forEach(per => {
                            switch (per.geschlecht) {
                                case 'm':
                                    anzahlMännlich = per.anzahlPersonen;
                                    break;
                                case 'w':
                                    anzahlWeiblich = per.anzahlPersonen;
                                    break;
                            }
                        });
                        const anzahlGesamt = anzahlMännlich + anzahlWeiblich;
                        const hatGWarteliste = vData.hatGWarteliste;
                        const anzahlPlätze = vData.anzahlPlätze;
                        const anzahlPlätzeWeiblich = vData.anzahlPlätzeWeiblich;
                        const anzahlPlätzeMännlich = vData.anzahlPlätzeMännlich;
                        const myGeschlecht = args.geschlecht;
                        if (hatGWarteliste) {
                            if (myGeschlecht === 'm') {
                                if (maxWlistMännlich > 0) {
                                    wartelistenplatz = maxWlistMännlich + 1;
                                }
                                else {
                                    if (anzahlMännlich < anzahlPlätzeMännlich) {
                                        if (anzahlGesamt < anzahlPlätze) {
                                            wartelistenplatz = 0;
                                        }
                                        else {
                                            wartelistenplatz = 1;
                                        }
                                    }
                                    else {
                                        wartelistenplatz = 1;
                                    }
                                }
                            }
                            else {
                                if (maxWlistWeiblich > 0) {
                                    wartelistenplatz = maxWlistWeiblich + 1;
                                }
                                else {
                                    if (anzahlWeiblich < anzahlPlätzeWeiblich) {
                                        if (anzahlGesamt < anzahlPlätze) {
                                            wartelistenplatz = 0;
                                        }
                                        else {
                                            wartelistenplatz = 1;
                                        }
                                    }
                                    else {
                                        wartelistenplatz = 1;
                                    }
                                }
                            }
                        }
                        else {
                            if (maxWlistGesamt > 0) {
                                wartelistenplatz = maxWlistGesamt + 1;
                            }
                            else {
                                if (anzahlGesamt < anzahlPlätze) {
                                    wartelistenplatz = 0;
                                }
                                else {
                                    wartelistenplatz = 1;
                                }
                            }
                        }
                    }
                    else {
                        let generateFlag = false;
                        let wann;
                        if (vData.ende === null) {
                            wann = vData.begin;
                        }
                        else {
                            wann = vData.ende;
                        }
                        const fzData = await mysql_1.query(`SELECT fzVon FROM fz WHERE personID = ${personID} ORDER BY fzVon DESC LIMIT 1`);
                        if (fzData.length === 0) {
                            generateFlag = true;
                        }
                        else {
                            const fzVon = fzData[0].fzVon;
                            const wannArr = [wann.getFullYear(), wann.getMonth() + 1, wann.getDate()];
                            wannArr[0] -= 5;
                            const fzMinDate = new Date(wannArr.join('-'));
                            if (fzMinDate > fzVon) {
                                generateFlag = true;
                            }
                        }
                        if (generateFlag) {
                            fz_1.createFZ(personID, args.eMail, adressID);
                            await mysql_1.query(`INSERT INTO fzAntrag(personID) VALUES (${personID})`);
                        }
                    }
                    await Promise.all([
                        mysql_1.query(`UPDATE adressen SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE adressID = ${adressID}`),
                        mysql_1.query(`UPDATE eMails SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE eMailID = ${eMailID}`),
                        mysql_1.query(`UPDATE telefone SET isOld=0, lastUsed=CURRENT_TIMESTAMP WHERE telefonID = ${telefonID}`),
                        mysql_1.query(`UPDATE personen SET letzteAenderung=CURRENT_TIMESTAMP WHERE personID=${personID}`),
                    ]);
                    await mysql_1.query(`
            INSERT INTO anmeldungen(
              anmeldeID,
              veranstaltungsID,
              personID,
              position,
              adressID,
              eMailID,
              telefonID,
              wartelistenPlatz,
              anmeldeZeitpunkt,
              vegetarisch,
              lebensmittelAllergien,
              gesundheitsinformationen,
              bemerkungen,
              radfahren, 
              schwimmen,
              fahrgemeinschaften,
              klettern,
              sichEntfernen,
              bootFahren,
              extra_json
            ) VALUES (
              "${anmeldeID}", 
              ${args.veranstaltungsID}, 
              ${personID}, 
              ${args.position}, 
              ${adressID}, 
              ${eMailID}, 
              ${telefonID}, 
              ${wartelistenplatz},
              "${args.anmeldeZeitpunkt}",
              ${args.vegetarisch},
              "${args.lebensmittelAllergien}",
              "${args.gesundheitsinformationen}",
              "${args.bemerkungen}", 
              ${args.radfahren},
              ${args.schwimmen},
              ${args.fahrgemeinschaften},
              ${args.klettern},
              ${args.sichEntfernen},
              ${args.bootFahren},
              "${args.extra_json}"
            )`);
                    if (vData.informAnmeldecenter) {
                        mail_1.default('automated@ec-nordbund.de', { to: vData.informAnmeldecenter }, `Neue Anmeldung bei Veranstaltung ${vData.bezeichnung}`, `<h1>Neue Anmeldung</h1><p>Es gibt eine Anmeldung mit der AnmeldeID: ${anmeldeID}<br>Klicke <a href="https://verwaltung.ec-nordbund.de/anmeldungen/${anmeldeID}/home">HIER</a> um die Anmeldung einzusehen.</p>`);
                    }
                    return {
                        status: wartelistenplatz,
                        anmeldeID: anmeldeID,
                    };
                }
            }
            else {
                return { status: -1 };
            }
        },
    },
    anmeldungBestaetigungsbrief: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async function (_, args) {
            await mysql_1.query(`UPDATE anmeldungen SET bestaetigungsBrief=CURRENT_TIMESTAMP WHERE anmeldeID = '${args.anmeldeID}'`);
            return true;
        }, 'anmeldungBesonderheiten'),
    },
    anmeldunginfobrief: {
        type: graphql_1.GraphQLBoolean,
        args: sonstiges_1.addAuth({
            anmeldeID: {
                type: new graphql_1.GraphQLNonNull(graphql_1.GraphQLString),
            },
        }),
        resolve: sonstiges_1.handleAllowed(async function (_, args) {
            await mysql_1.query(`UPDATE anmeldungen SET infoBrief=CURRENT_TIMESTAMP WHERE anmeldeID = '${args.anmeldeID}'`);
            return true;
        }, 'anmeldungBesonderheiten'),
    },
};
