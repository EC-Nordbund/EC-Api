export const ruleLib = {
  vorname: [
    (v: string) => (!v ? 'Du musst einen Vornamen angeben!' : true),
    (v: string) => (v && v.length > 50 ? 'Der Vorname ist zu lang.' : true),
  ],
  nachname: [
    (v: string) => (!v ? 'Du musst einen Nachnamen angeben!' : true),
    (v: string) => (v && v.length > 50 ? 'Der Nachname ist zu lang.' : true),
  ],
  geschlecht: [
    (v: string) => (!v ? 'Du musst ein Geschlecht angeben!' : true),
    (v: string) =>
      v && v !== 'm' && v !== 'w' ? 'Du musst ein Geschlecht angeben!' : true,
  ],
  gebDat: [
    (v: string) => (!v ? 'Du musst ein Geburtsdatum angeben!' : true),
    (v: string) =>
      v &&
      // http://www.regular-expressions.info/dates.html
      !/^(19|20){1}\d\d-(0[1-9]|1[012]){1}[-](0[1-9]|[12][0-9]|3[01]){1}/.test(
        v
      )
        ? 'Du musst ein valides Geburtsdatum angeben!'
        : true,
  ],
  strasse: [
    (v: string) => (!v ? 'Du musst eine Straße angeben!' : true),
    (v: string) => (v && v.length > 50 ? 'Die Straße ist zu lang.' : true),
  ],
  plz: [
    (v: string) => (!v ? 'Du musst eine Postleitzahl angeben!' : true),
    (v: string) =>
      v && v.length !== 5 ? 'Die PLZ muss aus 5 Ziffern bestehen!' : true,
    (v: string) =>
      v && v.length === 5 && /\d\d\d\d\d/.test(v) === false
        ? 'Die PLZ muss aus 5 Ziffern bestehen!'
        : true,
  ],
  ort: [(v: string) => (!v ? 'Du musst einen Ort angeben!' : true)],
  email: [
    (v: string) => (!v ? 'Du musst eine E-Mail angeben!' : true),
    (v: string) => (v && v.length > 50 ? 'Die E-Mail ist zu lang.' : true),
    (v: string) =>
      v &&
      // http://www.regular-expressions.info/email.html
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(v) === false
        ? 'Du musst eine valide E-Mail angeben!'
        : true,
  ],
  telefon: [
    (v: string) => (!v ? 'Du musst eine Telefonnummer angeben' : true),
    (v: string) =>
      v && v.length > 50 ? 'Die Telefonnummer ist zu lang.' : true,
    (v: string) =>
      v && (/\+49\d*/.test(v) || /0049\d*/.test(v))
        ? 'Bitte lasse die deutsche Ländervorwahl weg! (+49... und 0049... => 0...)'
        : true,
    (v: string) =>
      v && /^\+\d*/.test(v)
        ? 'Bitte schreibe bei der Ländervorwahl 00. (+... => 00...)'
        : true,
    (v: string) =>
      v && /^((?!\d).)*$/gm.test(v)
        ? 'Die Telefonnummer darf nur aus Ziffern besetehen!'
        : true,
  ],
  textArea250: [
    (v: string) =>
      v && v.length > 250 ? 'Dieses Feld ist auf 250 Zeichen begrenzt!' : true,
  ],
  datenschutz: [
    (v: boolean) =>
      !v
        ? 'Wir benötigen deine Zustimmung zu den Datenschutzbedingungen um deine Anmeldung verarbeiten zu dürfen!'
        : true,
  ],
  checkboxRequired: [
    (v: boolean) =>
      !v ? 'Deine Zustimmung zu diese Aussage ist erforderlich!' : true,
  ],
  tnBedingungen: [
    (v: boolean) =>
      !v ? 'Wir benötigen deine Zustimmung zu den Teilnahmebedingungen!' : true,
  ],
  ecKreis: [(v: number) => (!v ? 'Du musst einen EC-Kreis angeben!' : true)],
  isMA: [
    (v: boolean) =>
      !v ? 'Du musst bestätigen, dass du ein Mitarbeiter bist!' : true,
  ],
}