import { Express, Request, Response } from 'express'
import { checkAuth } from '../auth'
import { errorHandler } from '../helpers/error'
import { queryP } from '../helpers/mysql'
import {
  aendereAccount,
  deaktiviereAccount,
  erzeugeLink,
  ganzzahl,
  ladeAccount,
  legeAccountAn,
  listeAccounts
} from '../portal/accounts'
import { clientIp } from '../portal/audit'
import { requirePortalAktiv } from '../portal/scope'

/**
 * Pflege der Portal-Zugaenge und der EC-Kreis-Zustaendigkeit aus EC-Verwaltung.
 *
 * Diese Routen liegen unter /v6, im Gegensatz zu den Portal-Routen selbst: sie
 * nutzen den Verwaltungs-Token (checkAuth), den dort schon registrierten
 * json()-Parser und die dortige Fehlerkonvention (text/plain), die
 * EC-Verwaltung an allen anderen Stellen ebenfalls erwartet.
 *
 * Das Limit von zwei Requests pro Sekunde auf /v6 gilt hier mit -- die
 * Pflegemasken kommen damit aus, Mehrfach-Einladungen muessen im Frontend aber
 * nacheinander laufen und nicht in einem Promise.all.
 */
export default (app: Express): void => {
  /* ------------------------------------------------------- Portal-Konten -- */

  app.get('/v6/portal-account', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      await requirePortalAktiv()
      res.json({ accounts: await listeAccounts() })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.post('/v6/portal-account', async (req: Request, res: Response) => {
    try {
      const payload = await checkAuth(req)
      await requirePortalAktiv()

      const portalUserID = await legeAccountAn(
        req.body?.personID,
        req.body?.email,
        req.body?.superuser === true,
        payload.userID,
        clientIp(req)
      )
      res.status(201).json({ portalUserID })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.post(
    '/v6/portal-account/:id/invite',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        await requirePortalAktiv()

        const id = ganzzahl(req.params.id)
        if (!id) {
          res.status(400).end('Ungültige ID')
          return
        }
        const acc = await ladeAccount(id)
        if (acc.aktiv !== 1) {
          res.status(409).end('Der Zugang ist deaktiviert.')
          return
        }
        await erzeugeLink(id, 'invite', clientIp(req), {
          email: acc.email,
          vorname: acc.vorname
        })
        res.json({ status: 'OK' })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.patch('/v6/portal-account/:id', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      await requirePortalAktiv()

      const id = ganzzahl(req.params.id)
      if (!id) {
        res.status(400).end('Ungültige ID')
        return
      }
      await aendereAccount(id, {
        email: req.body?.email,
        superuser: req.body?.superuser,
        aktiv: req.body?.aktiv,
        notiz: req.body?.notiz
      })
      res.json({ status: 'OK' })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  app.delete('/v6/portal-account/:id', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)
      await requirePortalAktiv()

      const id = ganzzahl(req.params.id)
      if (!id) {
        res.status(400).end('Ungültige ID')
        return
      }
      await deaktiviereAccount(id)
      res.json({ status: 'OK' })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /* ---------------------------------------------------------- EC-Kreise -- */

  app.get('/v6/eckreis', async (req: Request, res: Response) => {
    try {
      await checkAuth(req)

      const kreise = await queryP<any>(
        `SELECT ec.ecKreisID, ec.bezeichnung, ec.email, ec.website, ec.needsFZ,
                ec.fz_verantwortlicher,
                ec.fz_verantwortlicher_personID, ec.ortsverantwortlicher_personID,
                fz.vorname AS fzVorname, fz.nachname AS fzNachname,
                ov.vorname AS ovVorname, ov.nachname AS ovNachname
           FROM ecKreis ec
           LEFT JOIN personen fz ON fz.personID = ec.fz_verantwortlicher_personID
           LEFT JOIN personen ov ON ov.personID = ec.ortsverantwortlicher_personID
          ORDER BY ec.bezeichnung`
      )

      res.json({
        kreise: kreise.map((k) => ({
          ecKreisID: k.ecKreisID,
          bezeichnung: k.bezeichnung,
          email: k.email,
          website: k.website,
          needsFZ: k.needsFZ === 1,
          // Der Freitext bleibt sichtbar: er ist die Anrede in der Monats-Mail
          // und kann von der Personen-Referenz abweichen. Beides nebeneinander
          // anzuzeigen ist ehrlicher, als eines davon zu verstecken.
          fzVerantwortlicherText: k.fz_verantwortlicher,
          // Zwei getrennte Aufgaben: Führungszeugnisse und Mitgliederpflege.
          fzVerantwortlich: k.fz_verantwortlicher_personID
            ? {
                personID: k.fz_verantwortlicher_personID,
                vorname: k.fzVorname ?? '',
                nachname: k.fzNachname ?? ''
              }
            : null,
          ortsverantwortlich: k.ortsverantwortlicher_personID
            ? {
                personID: k.ortsverantwortlicher_personID,
                vorname: k.ovVorname ?? '',
                nachname: k.ovNachname ?? ''
              }
            : null
        }))
      })
    } catch (err) {
      errorHandler(err, res)
    }
  })

  /**
   * Verantwortliche/n eines EC-Kreises setzen oder entfernen.
   *
   * `rolle` waehlt zwischen den beiden Aufgaben:
   *   fz  -- Fuehrungszeugnisse einsehen und eintragen
   *   ort -- Mitgliederliste des Kreises pflegen
   *
   * Bei der FZ-Rolle wird im selben Statement der Freitext
   * `fz_verantwortlicher` mitgeschrieben: den liest fz-mail-system/cron.php
   * als Anrede der Monats-Mail. So bleibt das PHP-System unveraendert
   * lauffaehig und muss nicht im Gleichschritt deployt werden.
   */
  app.put(
    '/v6/eckreis/:id/verantwortlicher/:rolle',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        await requirePortalAktiv()

        const ecKreisID = ganzzahl(req.params.id)
        if (!ecKreisID) {
          res.status(400).end('Ungültige ID')
          return
        }

        const rolle = req.params.rolle === 'ort' ? 'ort' : 'fz'

        const roh = req.body?.personID
        const personID =
          roh === null || roh === undefined ? null : ganzzahl(roh)
        if (roh !== null && roh !== undefined && !personID) {
          res.status(400).end('Ungültige personID')
          return
        }

        let text = ''
        if (personID) {
          const p = await queryP<{ vorname: string; nachname: string }>(
            'SELECT vorname, nachname FROM personen WHERE personID = ? AND anonymisiert = 0',
            [personID]
          )
          if (p.length !== 1) {
            res.status(404).end('Person nicht gefunden')
            return
          }
          text = `${p[0].vorname} ${p[0].nachname}`
        }

        const r: any =
          rolle === 'fz'
            ? await queryP(
                `UPDATE ecKreis
                    SET fz_verantwortlicher_personID = ?, fz_verantwortlicher = ?
                  WHERE ecKreisID = ?`,
                [personID, text, ecKreisID]
              )
            : await queryP(
                `UPDATE ecKreis
                    SET ortsverantwortlicher_personID = ?
                  WHERE ecKreisID = ?`,
                [personID, ecKreisID]
              )
        if (!r || r.affectedRows === 0) {
          res.status(404).end('EC-Kreis nicht gefunden')
          return
        }

        res.json({ status: 'OK' })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}
