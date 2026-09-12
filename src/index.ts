import { schema } from './graphql'
import { appVersion } from './config/version'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express4'
import { json } from 'body-parser'
import cors from 'cors'
import express from 'express'
import compression from 'compression'
import user from './api/user'
import personen from './api/personen'
import ak from './api/ak'
import document from './api/document'
import bestBrief from './api/best-brief'
import expressRateLimit from 'express-rate-limit'
import * as http from 'http'

import nuxt from './nuxt'
import fz from './api/fz'
import sync from './api/sync'
import anmeldetoken from './api/anmeldetoken'
import portal from './api/portal'
import portalAccount from './api/portal-account'
import dubletten from './api/dubletten'

// Sicherheitsnetz: Node >= 15 beendet den Prozess bei unhandled rejections —
// ein einzelner vergessener Fehlerpfad in einem async-Express-Handler riss
// sonst die komplette API um (so geschehen bei /nuxt/anmeldung/ma/…).
// Loggen statt sterben; echte Fehler tauchen so im Log auf.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

const apollo = new ApolloServer({ schema })
const app = express()

/**
 * Die API laeuft in Produktion hinter einem Reverse Proxy. Ohne diese
 * Einstellung ist `req.ip` dessen Adresse statt der des Clients -- und dann
 * teilen sich ALLE Nutzer dieselbe Rate-Limit-Zelle. Beim Portal hiesse das:
 * nach 60 Login-Versuchen ist die Anmeldung fuer alle gesperrt, egal von wo.
 * Auch das bestehende Limit auf /v6 (2 Requests pro Sekunde) traf so die
 * Verwaltung als Ganzes statt einzelner Clients.
 *
 * Bewusst NICHT `true`: damit wuerde Express der ersten Adresse im
 * X-Forwarded-For glauben, und die kann jeder Client frei erfinden -- das
 * Rate-Limit waere mit einem Header umgangen. Vertraut wird stattdessen allen
 * Hops aus privaten Netzen (der Proxy liegt im Docker-Netz); Express nimmt
 * dann die letzte Adresse ausserhalb davon, also die, die der Proxy
 * eingetragen hat. Das bleibt richtig, egal wie viele private Hops
 * dazwischenliegen.
 *
 * Ueber TRUST_PROXY anpassbar, falls die Konstellation davon abweicht
 * (z. B. "1" fuer genau einen Hop).
 */
const trustProxy = process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal'
app.set(
  'trust proxy',
  /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy
)

app
  //.use(compression())
  .use(cors({ origin: (o, cb) => cb(null, true) }))
  .use('/time', (req, res) => {
    res.end(`{"time": ${new Date().getTime()}}`)
  })
  .use('/check', (req, res) => {
    res.end('{online: true}')
  })
  .use('/version', (req, res) => {
    res.end(`{"version": "${appVersion}"}`)
  })
  .use('/v6', json())

  // 20 Requests pro Sekunde und Client. Vorher standen hier 2 -- was in der
  // Praxis bedeutete, dass eine Seite der Verwaltung, die zwei Listen parallel
  // laedt, sich selbst ausbremste. Seit `trust proxy` gesetzt ist, zaehlt das
  // Limit endlich je Client statt fuer alle gemeinsam, und der engere Wert
  // waere ohnehin nur noch als Bremse gegen Einzelne gedacht gewesen.
  .use(
    '/v6',
    expressRateLimit({
      windowMs: 1000,
      max: 20
    })
  ) //.use(json({ type: 'application/*+json'}))

  // Das Portal liegt bewusst NICHT unter /v6: dessen Limit von 2 Requests pro
  // Sekunde und IP ist fuer eine SPA zu eng, und mehrere Leiter hinter einem
  // Gemeindehaus-NAT teilen sich dieselbe Adresse. Eigener Prefix mit eigenem,
  // weiterem Limit -- die strengen Grenzen fuer Login und Passwort-Reset
  // stehen in api/portal.ts an den einzelnen Routen.
  // json() wird hier absichtlich nicht global gesetzt: die Portal-Routen
  // bringen ihren eigenen Parser mit Groessenlimit mit.
  .use(
    '/portal',
    expressRateLimit({
      windowMs: 60 * 1000,
      max: 120
    })
  )

nuxt(app)
user(app)
personen(app)
ak(app)
document(app)
bestBrief(app)
fz(app)
sync(app)
anmeldetoken(app)
portal(app)
portalAccount(app)
dubletten(app)

apollo.start().then(() => {
  app.use('/graphql', json(), expressMiddleware(apollo))

  http.createServer(app).listen(4000)
})
