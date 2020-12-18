import { createFZ } from "../../serienbrief/fz";
import { query } from "../mysql";
import { addAuth, handleAllowed } from "../sonstiges";

import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLString,
} from "graphql";

export default {
  editPersonStamm: {
    type: GraphQLBoolean,

    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      vorname: {
        type: new GraphQLNonNull(GraphQLString),
      },
      nachname: {
        type: new GraphQLNonNull(GraphQLString),
      },
      gebDat: {
        type: new GraphQLNonNull(GraphQLString),
      },
      geschlecht: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    resolve: handleAllowed((_, args) => {
      return new Promise((resolve, reject) => {
        query(
          `UPDATE personen SET vorname = '${args.vorname}', nachname = '${args.nachname}', gebDat = '${args.gebDat}', geschlecht = '${args.geschlecht}' WHERE personID = ${args.personID}`
        )
          .then((v) => {
            return true;
          })
          .then(resolve)
          .catch(reject);
      });
    }, "editPersonStamm"),
  },
  addPerson: {
    type: new GraphQLNonNull(GraphQLInt),
    args: addAuth({
      vorname: {
        type: new GraphQLNonNull(GraphQLString),
      },
      nachname: {
        type: new GraphQLNonNull(GraphQLString),
      },
      gebDat: {
        type: new GraphQLNonNull(GraphQLString),
      },
      geschlecht: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    resolve: handleAllowed((_, args) => {
      return new Promise((resolve, reject) => {
        query(
          `INSERT INTO personen (vorname, nachname, gebDat, geschlecht) VALUES ('${args.vorname}', '${args.nachname}', '${args.gebDat}', '${args.geschlecht}')`
        )
          .then((v) => {
            query(
              `SELECT personID FROM personen WHERE vorname = '${args.vorname}' AND nachname = '${args.nachname}' AND gebDat = '${args.gebDat}'`
            )
              .then((res) => res[0].personID)
              .then((v) => {
                return v;
              })
              .then(resolve)
              .catch(reject);
          })
          .catch(reject);
      });
    }, "addPerson"),
  },
  addFZ: {
    type: GraphQLBoolean,

    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      gesehenAm: {
        type: new GraphQLNonNull(GraphQLString),
      },
      fzVon: {
        type: new GraphQLNonNull(GraphQLString),
      },
      gesehenVon: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      kommentar: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    resolve: handleAllowed((_, args) => {
      query(
        `INSERT INTO fz (personID, gesehenAm, gesehenVon, kommentar, fzVon) VALUES (${args.personID}, '${args.gesehenAm}', ${args.gesehenVon}, '${args.kommentar}', '${args.fzVon}')`
      ).then((v) => {
        query(`DELETE FROM fzAntrag WHERE personID = ${args.personID}`);
      });
    }, "addFZ"),
  },
  addFZAntrag: {
    type: GraphQLBoolean,
    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      email: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    resolve: handleAllowed(async (_, args) => {
      await createFZ(args.personID, args.email);
      await query(`INSERT INTO fzAntrag (personID) VALUES (${args.personID})`);
    }, "addFZAntrag"),
  },
  editSonstiges: {
    type: GraphQLBoolean,
    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      juLeiCaNr: {
        type: new GraphQLNonNull(GraphQLString),
      },
      ecMitglied: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      ecKreis: {
        type: GraphQLInt,
      },
      Fuehrerschein: {
        type: new GraphQLNonNull(GraphQLBoolean),
      },
      Rettungsschwimmer: {
        type: new GraphQLNonNull(GraphQLBoolean),
      },
      ErsteHilfe: {
        type: new GraphQLNonNull(GraphQLBoolean),
      },
      notizen: {
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    resolve: handleAllowed((_, args) => {
      query(
        `UPDATE personen SET juLeiCaNr="${args.juLeiCaNr}",ecKreis=${
          args.ecKreis ? args.ecKreis : null
        },ecMitglied=${args.ecMitglied}, Fuehrerschein=${
          args.Fuehrerschein
        },Rettungsschwimmer=${args.Rettungsschwimmer},ErsteHilfe=${
          args.ErsteHilfe
        },Notizen="${args.notizen}" WHERE personID=${args.personID}`
      );
    }, "editPersonSonstiges"),
  },
  updateAKStatus: {
    type: GraphQLBoolean,
    args: addAuth({
      personID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      akID: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      date: {
        type: new GraphQLNonNull(GraphQLString),
      },
      status: {
        type: new GraphQLNonNull(GraphQLInt),
      },
    }),
    resolve: handleAllowed((_, args) => {
      query(
        `INSERT INTO akPerson (personID, akID, date, neuerStatus) VALUES (${args.personID}, ${args.akID}, ${args.date}, ${args.status})`
      );
    }, "updateAKStatus"),
  },
  mergePersons: {
    type: GraphQLBoolean,

    args: addAuth({
      personID_richtig: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      personID_falsch: {
        type: new GraphQLNonNull(GraphQLInt),
      },
    }),
    resolve: handleAllowed(async (_, args: any) => {
      await mergePersonen(args);
      return true;
    }, "mergePersonen"),
  },
};

async function mergePersonen(args: {
  personID_richtig: number;
  personID_falsch: number;
}) {
  await query(
    `UPDATE IGNORE adressen SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE akPerson SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE anmeldungen SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE eMails SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE fz SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE fzAntrag SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE telefone SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE juleica SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE IGNORE tagsPersonen SET personID = ${args.personID_richtig} WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE anmeldungen as a INNER JOIN telefone as e1 ON e1.telefonID = a.telefonID INNER JOIN telefone as e2 ON e1.telefon = e2.telefon SET a.telefonID = e2.telefonID WHERE e1.personID = ${args.personID_falsch} AND e2.personID = ${args.personID_richtig};`
  );
  await query(
    `UPDATE anmeldungen as a INNER JOIN eMails as e1 ON e1.eMailID = a.eMailID INNER JOIN eMails as e2 ON e1.eMail = e2.eMail SET a.eMailID = e2.emailID WHERE e1.personID = ${args.personID_falsch} AND e2.personID = ${args.personID_richtig};`
  );
  await query(
    `UPDATE anmeldungen as a INNER JOIN adressen as e1 ON e1.adressID = a.adressID INNER JOIN adressen as e2 ON (e1.strasse = e2.strasse AND e1.strasse = e2.strasse AND e1.plz = e2.plz) SET a.adressID = e2.adressID WHERE e1.personID = ${args.personID_falsch} AND e2.personID = ${args.personID_richtig};`
  );
  await query(
    `DELETE IGNORE FROM adressen WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `DELETE IGNORE FROM eMails WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `DELETE IGNORE FROM telefone WHERE personID = ${args.personID_falsch};`
  );
  await query(
    `UPDATE fz SET gesehenVon = ${args.personID_richtig} WHERE gesehenVon = ${args.personID_falsch};`
  );
  await query(
    `UPDATE dublikate SET zielPersonID = ${args.personID_richtig} WHERE zielPersonID = ${args.personID_falsch};`
  );
  await query(
    `INSERT into dublikate SELECT vorname, nachname, gebDat, ${args.personID_richtig} AS zielPersonID FROM personen WHERE personID = ${args.personID_falsch};`
  );
  await query(`DELETE FROM personen WHERE personID = ${args.personID_falsch};`);
}
