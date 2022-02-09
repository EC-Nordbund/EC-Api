import * as fs from 'fs'
import { ruleLib } from './rules'
import { saveForConfirm, validateToken, cleanup } from './fs-helpers'
import { validate } from './validate'
import { sendMail } from './sendMail'
import * as path from 'path'
import axios from 'axios'
import {
  createMailContentMA,
  createMailContentTN,
  createMailContentMAOrt,
  erfolgMailContent
} from './mailContent'
import { checkToken } from './jwt'

function getAge(gebDat: string, wann?: string | Date) {
  const today = wann ? new Date(wann) : new Date()
  const birthDate = new Date(gebDat)
  let age = today.getFullYear() - birthDate.getFullYear()
  const m = today.getMonth() - birthDate.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

// console.log('test')

const vData = {
  473: 'TimeOut 2022/23',
  461: "EC'ler auf der Kanzel",
  462: 'Mitarbeiter Wochenende',
  464: 'PfingstCamp',
  465: 'Landesjungscharfreizeit I',
  466: 'Landesjungscharfreizeit II',
  467: 'TeenCamp',
  468: 'BibleCamp',
  470: 'Abenteuerfreizeit',
  469: 'Reiterfreizeit',
  472: 'MaTag',
  451: 'TimeOut 2021/22',
  463: 'Kalmi Kurz Camp',
  454: 'LeitHaus',

  477: 'Christival 2022',
  478: 'Der Ehe-Kurs'
}
export default (app) => {
  app.get('/nuxt/health', (req,res)=>res.json({ok: true}))
  
  app.post('/nuxt/anmeldung/ma/checkToken', (req, res) => {
    checkToken(req.body.token)
      .then((d) => {
        res.json({
          ok: true,
          ort: !d.d.includes('|')
        })
      })
      .catch(() => {
        res.json({
          ok: false
        })
      })
  })

  app.post('/nuxt/anmeldung/ma/ort', (req, res) => {
    const rules = {
      vorname: ruleLib.vorname,
      nachname: ruleLib.nachname,
      geschlecht: ruleLib.geschlecht,
      gebDat: ruleLib.gebDat,
      strasse: ruleLib.strasse,
      plzOrt: {
        plz: ruleLib.plz,
        ort: ruleLib.ort
      },
      email: ruleLib.email,
      datenschutz: ruleLib.datenschutz,
      ecKreis: ruleLib.ecKreis,
      isMA: ruleLib.isMA
    }

    const errVals = validate(rules, req.body)

    if (errVals.length !== 0) {
      res.status(400)
      res.json({
        status: 'ERROR',
        context: errVals
      })
      return
    }

    try {
      const token = saveForConfirm(req.body, 20)

      const { email } = req.body

      // TODO: send Email

      res.status(200)
      res.json({
        status: 'OK'
      })
    } catch (ex) {
      res.status(500)
      res.json({
        status: 'ERROR',
        context: ex
      })
    }
  })
  app.post('/nuxt/anmeldung/ma/veranstaltung', async (req, res) => {
    const tk: string = (await checkToken(req.body.token)).d

    const [veranstaltungsID, position] = tk
      .split('|')
      .map((v) => parseInt(v) || v)

    req.body.veranstaltungsID = veranstaltungsID
    req.body.position = position

    const rules = {
      vorname: ruleLib.vorname,
      nachname: ruleLib.nachname,
      geschlecht: ruleLib.geschlecht,
      gebDat: ruleLib.gebDat,
      strasse: ruleLib.strasse,
      plz: ruleLib.plz,
      ort: ruleLib.ort,
      email: ruleLib.email,
      telefon: ruleLib.telefon,
      lebensmittelallergien: ruleLib.textArea250,
      bemerkungen: ruleLib.textArea250
    }

    const errVals = validate(rules, req.body)

    if (errVals.length !== 0) {
      res.status(400)
      res.json({
        status: 'ERROR',
        context: errVals
      })
      return
    }

    if (!req.body.token) {
      res.status(400)
      res.json({
        status: 'ERROR',
        context: 'Token not valid'
      })
      return
    }

    try {
      const token = saveForConfirm(req.body, position ? 10 : 20)

      const { email } = req.body

      const mail = await sendMail({
        to: email,
        from: 'anmeldung@ec-nordbund.de',
        subject: `Deine Anmeldung als ${
          veranstaltungsID == 454 && position == 1
            ? 'Teilnehmer'
            : 'Mitarbeiter'
        } beim EC-Nordbund (${
          vData[veranstaltungsID as keyof typeof vData] ||
          /* eslint-disable */
          // @ts-ignore veranstaltungsID kann hier ein String sein.
          `EC-${veranstaltungsID[0].toUpperCase()}${veranstaltungsID.slice(1)}`
          /* eslint-enable */
        })`,
        html:
          typeof veranstaltungsID !== 'number'
            ? await createMailContentMAOrt(req.body, token)
            : await createMailContentMA(req.body, token)
      })

      res.status(200)
      res.json({
        status: 'OK'
      })
    } catch (ex) {
      res.status(500)
      res.json({
        status: 'ERROR',
        context: ex
      })
      throw ex
    }
  })
  // app.use(async (req, res, next) => {
  //   console.log(req)
  //   next()
  // })

  app.post('/nuxt/anmeldung/tn/:id', async (req, res) => {
    const __IS_CHRISTIVAL__ = req.params.id == 477

    // console.log('test2')
    const rules = {
      vorname: ruleLib.vorname,
      nachname: ruleLib.nachname,
      geschlecht: ruleLib.geschlecht,
      gebDat: ruleLib.gebDat,
      strasse: ruleLib.strasse,
      // plzOrt: {
      plz: ruleLib.plz,
      ort: ruleLib.ort,
      // },
      email: ruleLib.email,
      telefon: ruleLib.telefon,
      bemerkungen: ruleLib.textArea250,
      lebensmittelallergien: ruleLib.textArea250,
      gesundheit: ruleLib.textArea250,
      datenschutz: ruleLib.datenschutz,
      freizeitLeitung: ruleLib.checkboxRequired,
      tnBedingungen: ruleLib.tnBedingungen
    }

    const errVals = validate(rules, req.body)

    if (__IS_CHRISTIVAL__) {
      const alter = getAge(req.body.gebDat, '2022-05-25')
      // Check alter

      if (alter < 13) {
        errVals.push('Du bist zu jung um beim Christival dabei zu sein...')
      } else if (alter < 18) {
        const key = req.body.extra.key

        if (!key) {
          errVals.push(
            'Du bist unter 18 und musst den Code von einem Erwachsenen Teilnehmer angeben!'
          )
        } else {
          //Validate key
          const [aid, p] = key.split('!')
          const checknum = aid
            .split('')
            .filter((v) => /\d/.test(v))
            .join('')
          if (
            !(
              checknum.length >= 0 &&
              parseInt(checknum) % 97 === parseInt(p) &&
              aid.length == 15
            )
          ) {
            errVals.push(
              'Du bist unter 18 und musst den echten Code von einem Erwachsenen Teilnehmer angeben!'
            )
          }
        }
      }
    }

    if (errVals.length !== 0) {
      res.status(400)
      res.json({
        status: 'ERROR',
        context: errVals
      })
      return
    }

    try {
      const token = saveForConfirm(
        { ...req.body, veranstaltungsID: parseInt(req.params.id) },
        1
      )

      const { email } = req.body

      const mail = await sendMail({
        to: email,
        from: 'anmeldung@ec-nordbund.de',
        subject: `Deine Anmeldung beim EC-Nordbund (${
          vData[parseInt(req.params.id) as keyof typeof vData]
        })`, // TODO: welche Veranstaltung
        // html: `
        //   <p>Um deine Anmeldung zu bestätigen klicke <a href="https://www.ec-nordbund.de/anmeldung/token/${token}">HIER</a>.<br>Oder gebe den Verifizierungscode ${token} auf <a href="https://www.ec-nordbund.de/anmeldung/token">https://www.ec-nordbund.de/anmeldung/token</a> ein</p>
        //   <p>Deine Anmeldung für ... TOKEN: ${token}</p>
        //   DATA: ${JSON.stringify(req.body)}
        // `
        html: await createMailContentTN(req.body, token)
      })

      // console.log(mail)

      res.status(200)
      res.json({
        status: 'OK'
      })
    } catch (ex) {
      res.status(500)
      res.json({
        status: 'ERROR',
        context: ex
      })
    }
  })

  function escape(data = '') {
    return JSON.stringify(data.trim())
  }

  app.post('/nuxt/confirm/:token', async (req, res) => {
    const token = req.params.token

    try {
      const data = validateToken(token)

      const type = data.__internals.type

      if (type === 1) {
        const __IS_CHRISTIVAL__ = data.veranstaltungsID == 477

        const gqlCode = `
        mutation {
          anmelden(
            isWP: true, 
            token: "${process.env.WPToken || 'NO WP-TOKEN'}", 
            vorname: ${escape(data.vorname)}, 
            nachname: ${escape(data.nachname)}, 
            gebDat: ${escape(data.gebDat)}, 
            geschlecht: ${escape(data.geschlecht)}, 
            position: 1, 
            veranstaltungsID: ${data.veranstaltungsID}, 
            eMail: ${escape(data.email)}, 
            telefon: ${escape(data.telefon)}, 
            strasse: ${escape(data.strasse)}, 
            plz: ${escape(data.plz)}, 
            ort: ${escape(data.ort)}, 
            anmeldeZeitpunkt: ${escape(data.__internals.time.split('.')[0])}, 
            vegetarisch: ${!!data.vegetarisch}, 
            lebensmittelAllergien: ${escape(data.lebensmittelallergien)}, 
            gesundheitsinformationen: ${escape(data.gesundheit)}, 
            bemerkungen: ${escape(data.bemerkungen)}, 
            radfahren: ${!!data.fahrrad}, 
            schwimmen: ${data.schwimmen}, 
            fahrgemeinschaften: ${!!data.fahrgemeinschaften}, 
            klettern: ${!!data.klettern}, 
            sichEntfernen: ${!!data.sichEntfernen}, 
            bootFahren: ${!!data.bootfahren}, 
            extra_json: ${JSON.stringify(JSON.stringify(data.extra ?? {}))}
          ) {
            status
            anmeldeID
          }
        }
      `

        const gqlRes = await axios.post('http://api:4000/graphql', {
          query: gqlCode
        })

        if (!data.alter && gqlRes.data.data.anmelden.status >= 0) {
          await sendMail({
            to:
              'kinder-referent@ec-nordbund.de;referent@ec-nordbund.de;app@ec-nordbund.de;BirgitHerbert@t-online.de',
            // to: 'app@ec-nordbund.de',
            from: 'anmeldung@ec-nordbund.de',
            subject: `Anmeldung mit fehlerhaften Alter`,
            html: `<p>Es gab eine Anmeldung mit nicht passenden Alter. AnmeldeID: ${gqlRes.data.data.anmelden.anmeldeID}; Wartelistenposition ${gqlRes.data.data.anmelden.status} (0 bedeutet keine Warteliste)</p>`
          })
        }

        if (gqlRes.data.data.anmelden.status >= 0) {
          await sendMail({
            to: data.email,
            from: 'anmeldung@ec-nordbund.de',
            subject:
              'Anmeldung Bestätigt. ' +
              (gqlRes.data.data.anmelden.status == 0
                ? ''
                : '(Wartelistenplatz ' +
                  gqlRes.data.data.anmelden.status +
                  ')'),
            html: await erfolgMailContent({
              ...data,
              status: gqlRes.data.data.anmelden.status
            })
          })

          if (__IS_CHRISTIVAL__) {
            const alter = getAge(data.gebDat, '2022-05-25')

            if (alter >= 18) {
              const aid = gqlRes.data.data.anmelden.anmeldeID
              const key =
                aid +
                '!' +
                (
                  parseInt(
                    aid
                      .split('')
                      .filter((v) => /\d/.test(v))
                      .join('')
                  ) % 97
                ).toString()

              await sendMail({
                to: data.email,
                from: 'anmeldung@ec-nordbund.de',
                subject: 'Anmeldung für Minderjährige Christival',
                html: `<html lang="de"><p>Moin,<br>Wenn du für Minderjährige Person(en) Verantwortlicher bist gebe den folgenden Code an diese weiter, damit sie sich auf der Website anmelden können! Bei Fragen zu dem Prozedere antworte einfach auf diese Mail!<br><br>CODE: ${key}</p>`
              })
            } else {
              await sendMail({
                to: data.email,
                from: 'anmeldung@ec-nordbund.de',
                subject: 'Christival | Einverständniserklärung der Eltern',
                html: `<html lang="de"><p>Moin,<br>Bitte lasse diese Erklärung von deinen Eltern unterschreiben und gebe sie an deiner volljährigen Begleitperson oder bei Thomas Seeger ab!</p>`,
                attachments: [
                  {
                    filename: 'Einverstaendniserklaerung.pdf',
                    content: fs.createReadStream(
                      path.join(__dirname, './Einverstaendniserklaerung.pdf')
                    )
                  }
                ]
              })
            }
          }
        }

        res.status(200)
        res.json({
          status: 'OK',
          anmeldeID: gqlRes.data.data.anmelden.anmeldeID,
          wList: gqlRes.data.data.anmelden.status,
          type
        })
        return
      }

      if (type === 10) {
        const gqlCode = `
        mutation {
          anmelden(
            isWP: true, 
            token: "${process.env.WPToken || 'NO WP-TOKEN'}", 
            vorname: ${escape(data.vorname)}, 
            nachname: ${escape(data.nachname)}, 
            gebDat: ${escape(data.gebDat)}, 
            geschlecht: ${escape(data.geschlecht)}, 
            position: ${data.position}, 
            veranstaltungsID: ${data.veranstaltungsID}, 
            eMail: ${escape(data.email)}, 
            telefon: ${escape(data.telefon)}, 
            strasse: ${escape(data.strasse)}, 
            plz: ${escape(data.plz)}, 
            ort: ${escape(data.ort)}, 
            anmeldeZeitpunkt: ${escape(data.__internals.time.split('.')[0])}, 
            vegetarisch: ${!!data.vegetarisch}, 
            lebensmittelAllergien: ${escape(data.lebensmittelallergien)}, 
            gesundheitsinformationen: "", 
            bemerkungen: ${escape(data.bemerkungen)}, 
            radfahren: true, 
            schwimmen: 3, 
            fahrgemeinschaften: true, 
            klettern: true, 
            sichEntfernen: true, 
            bootFahren: true, 
            extra_json: "{}"
          ) {
            status
            anmeldeID
          }
        }
      `

        const gqlRes = await axios.post('http://api:4000/graphql', {
          query: gqlCode
        })

        if (gqlRes.data.data.anmelden.status >= 0) {
          await sendMail({
            to: data.email,
            from: 'anmeldung@ec-nordbund.de',
            subject: 'Anmeldung Bestätigt.',
            html: await erfolgMailContent({
              ...data,
              status: 0
            })
          })
        }

        console.log(gqlRes)

        res.status(200)
        res.json({
          status: 'OK',
          anmeldeID: gqlRes.data.data.anmelden.anmeldeID,
          wList: gqlRes.data.data.anmelden.status,
          type
        })
        return
      }
      if (type === 20) {
        const gqlCode = `
        mutation {
          anmelden(
            isWP: true, 
            token: "${process.env.WPToken || 'NO WP-TOKEN'}", 
            vorname: ${escape(data.vorname)}, 
            nachname: ${escape(data.nachname)}, 
            gebDat: ${escape(data.gebDat)}, 
            geschlecht: ${escape(data.geschlecht)}, 
            position: 1, 
            veranstaltungsID: 42, 
            eMail: ${escape(data.email)}, 
            telefon: ${escape(data.telefon)}, 
            strasse: ${escape(data.strasse)}, 
            plz: ${escape(data.plz)}, 
            ort: ${escape(data.ort)}, 
            anmeldeZeitpunkt: ${escape(data.__internals.time.split('.')[0])}, 
            vegetarisch: false, 
            lebensmittelAllergien: "", 
            gesundheitsinformationen: "${data.veranstaltungsID}", 
            bemerkungen: "", 
            radfahren: true, 
            schwimmen: 3, 
            fahrgemeinschaften: true, 
            klettern: true, 
            sichEntfernen: true, 
            bootFahren: true, 
            extra_json: "{}"
          ) {
            status
            anmeldeID
          }
        }
      `

        const gqlRes = await axios.post('http://api:4000/graphql', {
          query: gqlCode
        })

        console.log(gqlRes)

        if (gqlRes.data.data.anmelden.status >= 0) {
          await sendMail({
            to: data.email,
            from: 'anmeldung@ec-nordbund.de',
            subject: 'Anmeldung Bestätigt.',
            html: await erfolgMailContent({
              ...data,
              status: 0
            })
          })
        }

        res.status(200)
        res.json({
          status: 'OK',
          anmeldeID: gqlRes.data.data.anmelden.anmeldeID,
          wList: gqlRes.data.data.anmelden.status,
          type
        })
        return
      }

      res.status(500)
      res.json({
        status: 'ERROR',
        context: 'DATEN fehlerhaft'
      })
    } catch (ex) {
      console.log(ex)
      res.status(500)
      res.json({
        status: 'ERROR',
        context: ex
      })
    }
  })

  cleanup()

  setInterval(cleanup, 1000 * 60 * 59)
}
