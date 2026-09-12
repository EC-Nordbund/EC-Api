import { Express } from 'express'
import expressRateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { changePWD, login } from '../users/users'
import { versions } from '../config/nichtErlaubteVersionen'
import { checkAuth } from '../auth'
import { emptyObj } from '../types/types'
import { ecError, errorHandler } from '../helpers/error'
import { saveSubscription, sendNotificationToAll } from '../helpers/web-push'

/**
 * Login-Bremse fuer die Verwaltung.
 *
 * Bis das Limit auf /v6 von 2 auf 20 Requests pro Sekunde angehoben wurde, war
 * genau dieser globale Wert der einzige Schutz gegen Passwort-Raten an dieser
 * Route -- mit 20/s waeren es 1200 Versuche pro Minute. Anders als das Portal
 * kennt der Verwaltungs-Login keinen Fehlversuchszaehler und keine Kontosperre
 * (portalUser hat failed_logins/locked_until, users nicht), die Bremse muss
 * hier also an der Route haengen.
 *
 * Zwei Limiter uebereinander, gleiches Muster wie in api/portal.ts: der erste
 * bremst gezieltes Raten gegen EIN Konto, der zweite das breite Durchprobieren
 * von einer Adresse aus. `ipKeyGenerator` ist Pflicht, sobald der Key selbst
 * gebaut wird -- eine rohe IPv6-Adresse laesst sich sonst pro Request
 * variieren und das Limit damit umgehen.
 *
 * Beide haengen an der Route und nicht in einem .use()-Block, weil der
 * Konto-Key `req.body.username` braucht: json() ist fuer /v6 global vor den
 * Limitern registriert (index.ts), an der Route ist der Body also geparst.
 */
const loginLimiterKonto = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.username ?? '')
      .toLowerCase()
      .slice(0, 120)}`
})

const loginLimiterIp = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60
})

export default (app: Express): void => {
  /**
   * POST /v6/login
   *
   * Gibt einen Array aller Personen aus
   *
   * @name login
   * @noauth
   */
  app.post<
    emptyObj,
    { authToken: string },
    { username: string; password: string; version: string }
  >('/v6/login', loginLimiterIp, loginLimiterKonto, async (req, res) => {
    try {
      if (!req.body.version || !req.body.username || !req.body.password) {
        throw new ecError('Daten sind nicht valid!', 400)
      }

      if (versions.includes(req.body.version)) {
        throw new ecError(
          'Version der Verwaltung ist veraltet und wird nicht unterstützt!',
          406
        )
      }

      const authToken = await login(req.body.username, req.body.password)

      res.json({ authToken })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /**
   * POST /v6/change-password
   *
   * Ändert das Passwort eines Nutzers
   *
   * @name changePassword
   */
  app.post<
    emptyObj,
    { status: true },
    { oldPassword: string; newPassword: string }
  >('/v6/change-password', async (req, res) => {
    await checkAuth(req)
    res.json({
      status: await changePWD(
        req.headers.authorization!,
        req.body.oldPassword,
        req.body.newPassword
      )
    })
  })

  /**
   * POST /v6/subscribe
   *
   * Speichert subscription
   *
   * @name subscribe
   */
  app.post<emptyObj, emptyObj, { subscription: any }>(
    '/v6/subscribe',
    async (req, res) => {
      try {
        console.log(req.body)
        console.log(req.body.subscription)
        const payload = await checkAuth(req)
        await saveSubscription(req.body.subscription, payload.userID)
        res.json({})
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.get('/v6/test', async (req, res) => {
    await sendNotificationToAll({ body: 'Hello World!', title: 'testing' })
    res.end('DONE')
  })
}
