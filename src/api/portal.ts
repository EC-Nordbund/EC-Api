import { Express, Request, Response } from 'express'
import { json } from 'body-parser'
import expressRateLimit, { ipKeyGenerator } from 'express-rate-limit'
import {
  aenderePasswort,
  login,
  passwortVergessen,
  pruefeLinkToken,
  setzePasswort
} from '../portal/accounts'
import { audit, clientIp } from '../portal/audit'
import { portalErrorHandler, badRequest, forbidden } from '../portal/error'
import {
  addFz,
  kreisListe,
  offeneImKreis,
  offeneInVeranstaltung,
  pruefeFzEingabe,
  tnListe,
  veranstaltungMitarbeiter
} from '../portal/queries'
import { ampel, gueltigBis } from '../portal/ampel'
import { ladeKatalog, ladeVorlage } from '../portal/templates'
import { dateObj } from '../portal/date'
import {
  assertKreis,
  assertPerson,
  assertVeranstaltung,
  requirePortal,
  requirePortalAktiv,
  umfangFuer,
  type PortalScope
} from '../portal/scope'
import { KUECHEN_VORLAGE } from '../portal/config'
import {
  entferneAusKreis,
  kreisMitglieder,
  ladeStatusListe,
  personAnlegenOderUebernehmen,
  pruefeNeuePerson,
  setzeStatus
} from '../portal/mitglieder'
import { sendeKreiswechsel } from '../portal/mail'

/**
 * REST-Routen des EC-Portals (Freizeitleitung und Ortsverantwortliche).
 *
 * Bewusst ausserhalb von /v6: dort haengt ein globales Limit von zwei Requests
 * pro Sekunde und IP (index.ts). Mehrere Leiter hinter einem Gemeindehaus-NAT
 * oder einem Mobilfunk-CGNAT teilen sich dieses Budget -- das Portal waere
 * unbenutzbar. Gleiches Vorgehen wie api/sync.ts.
 *
 * Weil /v6 auch den json()-Parser mitbringt, braucht hier jede schreibende
 * Route ihren eigenen.
 *
 * Kein GraphQL, bewusst: das Modul soll ohne Beruehrung des bestehenden Schemas
 * auskommen.
 */

const body = () => json({ limit: '32kb' })

/**
 * Login-Bremse. Zwei Limiter uebereinander: der erste bremst gezieltes Raten
 * gegen ein Konto, der zweite das breite Durchprobieren von einer Adresse aus.
 * `ipKeyGenerator` ist Pflicht, sobald der Key selbst gebaut wird -- eine rohe
 * IPv6-Adresse laesst sich sonst pro Request variieren und das Limit umgehen.
 */
const loginLimiterKonto = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '')
      .toLowerCase()
      .slice(0, 120)}`
})

const loginLimiterIp = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60
})

const resetLimiter = expressRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5
})

/**
 * Alle Datenrouten: nichts davon darf in einem Proxy- oder Browser-Cache
 * landen. Die TN-Listen enthalten Gesundheitsangaben Minderjaehriger.
 */
function keinCache(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
}

function positionText(position: number): string {
  if (position === 6) return 'Hauptleitung'
  if (position === 4) return 'Küchenleitung'
  return 'Leitung'
}

/**
 * Jemand, der bei keiner Freizeit Leitung ist und auch keinen EC-Kreis
 * betreut, kommt ausschliesslich an die Kuechenvorlage. Der Vorlagen-Katalog
 * ist nicht veranstaltungsbezogen -- deshalb hier die Person als Ganzes
 * betrachtet statt einer einzelnen Freizeit.
 */
function nurKuechenVorlage(scope: PortalScope): boolean {
  if (scope.superuser) return false
  if (scope.kreise.length > 0) return false
  return (
    scope.veranstaltungen.length > 0 &&
    scope.veranstaltungen.every((v) => v.umfang === 'kueche')
  )
}

function ganzzahlParam(v: string): number {
  const n = parseInt(v, 10)
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest('INVALID_INPUT', 'Ungültige ID.')
  }
  return n
}

export default (app: Express): void => {
  /* ---------------------------------------------------------------- Auth -- */

  app.post(
    '/portal/login',
    body(),
    loginLimiterIp,
    loginLimiterKonto,
    async (req: Request, res: Response) => {
      try {
        await requirePortalAktiv()
        const ergebnis = await login(req.body?.email, req.body?.password)
        await audit(ergebnis.user.portalUserID, 'login.ok', '', req)
        keinCache(res)
        res.json(ergebnis)
      } catch (err) {
        // Fehlversuche werden protokolliert, aber ohne die versuchte Adresse:
        // sonst steht in der Audit-Tabelle bei jedem Tippfehler eine
        // Mailadresse, und bei einem Angriff eine Liste geratener Adressen.
        await audit(null, 'login.fail', '', req).catch(() => undefined)
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/password/forgot',
    body(),
    resetLimiter,
    async (req: Request, res: Response) => {
      try {
        await requirePortalAktiv()
        await passwortVergessen(req.body?.email, clientIp(req))
        await audit(null, 'pw.reset.request', '', req)
      } catch (err) {
        // Auch ein interner Fehler darf hier nichts verraten: der Endpunkt
        // antwortet immer gleich, sonst wird er zum Adressverzeichnis.
        console.error('[portal] password/forgot:', err)
      }
      keinCache(res)
      res.status(202).json({ status: 'OK' })
    }
  )

  app.get(
    '/portal/password/token/:token',
    async (req: Request, res: Response) => {
      try {
        await requirePortalAktiv()
        keinCache(res)
        res.json(await pruefeLinkToken(req.params.token))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/password/set',
    body(),
    resetLimiter,
    async (req: Request, res: Response) => {
      try {
        await requirePortalAktiv()
        const ergebnis = await setzePasswort(
          req.body?.token,
          req.body?.password,
          clientIp(req)
        )
        await audit(ergebnis.user.portalUserID, 'pw.set', '', req)
        keinCache(res)
        res.json(ergebnis)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/password/change',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const ergebnis = await aenderePasswort(
          scope.portalUserID,
          req.body?.oldPassword,
          req.body?.newPassword
        )
        await audit(scope.portalUserID, 'pw.change', '', req)
        keinCache(res)
        // Der neue Token ersetzt den alten: der Wechsel hat alle bisherigen
        // Sitzungen entwertet, auch die des Aufrufers.
        res.json(ergebnis)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------------- Session -- */

  /**
   * Alles, was die Startseite und der Drawer brauchen -- inklusive der Zahl
   * offener Faelle je Kreis und Freizeit. Damit kommt /home ohne weiteren
   * Request aus, was bei einem Limit von zwei Requests pro Sekunde auf /v6
   * nicht selbstverstaendlich waere.
   */
  app.get('/portal/me', async (req: Request, res: Response) => {
    try {
      const scope = await requirePortal(req)

      const kreise = await Promise.all(
        scope.kreise.map(async (k) => ({
          ecKreisID: k.ecKreisID,
          bezeichnung: k.bezeichnung,
          needsFZ: k.needsFZ,
          rollen: k.rollen,
          // Der Zaehler gehoert zur Fuehrungszeugnis-Liste; wer nur
          // Ortsverantwortliche ist, sieht sie gar nicht.
          offen: k.rollen.includes('fz')
            ? await offeneImKreis(k.ecKreisID)
            : null
        }))
      )

      const veranstaltungen = await Promise.all(
        scope.veranstaltungen.map(async (v) => {
          // Der Fuehrungszeugnis-Zaehler gehoert zum FZ-Teil -- eine
          // Kuechenleitung sieht ihn nicht und braucht ihn nicht.
          const z =
            v.umfang === 'voll'
              ? await offeneInVeranstaltung(v.veranstaltungsID, v.begin, v.ende)
              : null
          return {
            veranstaltungsID: v.veranstaltungsID,
            bezeichnung: v.bezeichnung,
            kurzBezeichnung: v.kurzBezeichnung,
            begin: dateObj(v.begin),
            ende: dateObj(v.ende),
            position: v.position,
            positionText: positionText(v.position),
            umfang: v.umfang,
            mitarbeiter: z?.mitarbeiter ?? null,
            fzOffen: z?.fzOffen ?? null
          }
        })
      )

      keinCache(res)
      res.json({
        user: {
          portalUserID: scope.portalUserID,
          personID: scope.personID,
          vorname: scope.vorname,
          nachname: scope.nachname,
          email: scope.email,
          superuser: scope.superuser
        },
        kreise,
        veranstaltungen
      })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  /* --------------------------------------------------------------- Listen -- */

  app.get('/portal/kreis/:id/personen', async (req: Request, res: Response) => {
    try {
      const scope = await requirePortal(req)
      const ecKreisID = ganzzahlParam(req.params.id)
      // Die Fuehrungszeugnis-Liste sieht nur die FZ-Verantwortliche.
      assertKreis(scope, ecKreisID, 'fz')

      const modus = req.query.modus === 'alle' ? 'alle' : 'ampel'
      const daten = await kreisListe(ecKreisID, modus)

      await audit(scope.portalUserID, 'liste.kreis', `kreis:${ecKreisID}`, req)
      keinCache(res)
      res.json(daten)
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  app.get(
    '/portal/veranstaltung/:id/mitarbeiter',
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const vID = ganzzahlParam(req.params.id)
        // Der FZ-Stand des Teams ist Leitung und Hauptleitung vorbehalten.
        assertVeranstaltung(scope, vID, 'voll')

        const daten = await veranstaltungMitarbeiter(vID)

        await audit(scope.portalUserID, 'liste.ma', `veranstaltung:${vID}`, req)
        keinCache(res)
        res.json(daten)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Der volle Veranstaltungsdatensatz: speist die Web-Ansicht und den
   * XLSX-Export aus derselben Quelle. `felder=voll` schaltet die
   * Gesundheits- und Bemerkungsfelder frei -- die laedt das Portal erst, wenn
   * jemand tatsaechlich exportiert.
   */
  app.get(
    '/portal/veranstaltung/:id/tnliste',
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const vID = ganzzahlParam(req.params.id)
        assertVeranstaltung(scope, vID, 'kueche')

        const felder = req.query.felder === 'voll' ? 'voll' : 'basis'
        const daten = await tnListe(vID, felder, umfangFuer(scope, vID))

        await audit(
          scope.portalUserID,
          felder === 'voll' ? 'liste.tn.voll' : 'liste.tn',
          `veranstaltung:${vID}`,
          req
        )
        keinCache(res)
        res.json(daten)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------- TN-Vorlagen ---- */

  /**
   * Die xlsx-Vorlagen der TN-Listen. Sie liegen serverseitig, damit sie nicht
   * ein zweites Mal im Portal-Repo gepflegt werden muessen (siehe
   * portal/templates.ts). Inhaltlich sind es leere Formulare ohne
   * Personendaten -- die Anmeldung wird trotzdem verlangt, damit der Bestand
   * nicht oeffentlich abrufbar ist.
   */
  app.get(
    '/portal/templates/list.json',
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const katalog = JSON.parse(ladeKatalog().toString('utf8'))
        res.json(
          nurKuechenVorlage(scope)
            ? katalog.filter(
                (t: { name: string }) => t.name === KUECHEN_VORLAGE
              )
            : katalog
        )
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get('/portal/templates/:name', async (req: Request, res: Response) => {
    try {
      const scope = await requirePortal(req)
      const name = String(req.params.name).replace(/\.xlsx$/, '')
      if (nurKuechenVorlage(scope) && name !== KUECHEN_VORLAGE) {
        throw forbidden('Diese Vorlage steht dir nicht zur Verfügung.')
      }
      res
        .type(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        .send(ladeVorlage(name))
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  /* --------------------------------------------- Mitgliederliste ---------- */

  /**
   * Die Aufgabe der oder des Ortsverantwortlichen: alle Personen des Kreises,
   * unabhaengig davon, ob je ein Fuehrungszeugnis im Spiel war.
   */
  app.get(
    '/portal/kreis/:id/mitglieder',
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const ecKreisID = ganzzahlParam(req.params.id)
        assertKreis(scope, ecKreisID, 'ort')

        const daten = await kreisMitglieder(ecKreisID)

        await audit(
          scope.portalUserID,
          'liste.mitglieder',
          `kreis:${ecKreisID}`,
          req
        )
        keinCache(res)
        res.json({ ...daten, status: await ladeStatusListe() })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.patch(
    '/portal/kreis/:id/mitglied/:personID',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const ecKreisID = ganzzahlParam(req.params.id)
        assertKreis(scope, ecKreisID, 'ort')

        const personID = ganzzahlParam(req.params.personID)
        await setzeStatus(personID, ecKreisID, req.body?.ecMitglied)

        await audit(
          scope.portalUserID,
          'mitglied.status',
          `person:${personID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.delete(
    '/portal/kreis/:id/mitglied/:personID',
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const ecKreisID = ganzzahlParam(req.params.id)
        assertKreis(scope, ecKreisID, 'ort')

        const personID = ganzzahlParam(req.params.personID)
        await entferneAusKreis(personID, ecKreisID)

        await audit(
          scope.portalUserID,
          'mitglied.entfernt',
          `person:${personID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * "+ Neu": Person anlegen oder aus dem Bestand uebernehmen.
   *
   * Die Dublettenpruefung folgt der Anmeldelogik der Website (siehe
   * portal/mitglieder.ts). Gehoerte die Person bisher zu einem anderen Kreis,
   * wird sie uebernommen und die Geschaeftsstelle bekommt eine Meldung --
   * sonst verlöre der abgebende Kreis sie kommentarlos.
   */
  app.post(
    '/portal/kreis/:id/mitglied',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requirePortal(req)
        const ecKreisID = ganzzahlParam(req.params.id)
        assertKreis(scope, ecKreisID, 'ort')

        const eingabe = pruefeNeuePerson(req.body)
        const ergebnis = await personAnlegenOderUebernehmen(eingabe, ecKreisID)

        await audit(
          scope.portalUserID,
          `mitglied.${ergebnis.art}`,
          `person:${ergebnis.personID}`,
          req
        )

        if (ergebnis.art === 'umgezogen' && ergebnis.vorherigerKreis) {
          const kreis = scope.kreise.find((k) => k.ecKreisID === ecKreisID)
          // Der Versand darf den Vorgang nicht scheitern lassen -- die Person
          // ist zu diesem Zeitpunkt bereits umgehaengt.
          sendeKreiswechsel({
            vorname: eingabe.vorname,
            nachname: eingabe.nachname,
            gebDat: req.body?.gebDat ?? '',
            vonKreis: ergebnis.vorherigerKreis.bezeichnung,
            nachKreis: kreis?.bezeichnung ?? String(ecKreisID),
            durch: `${scope.vorname} ${scope.nachname}`
          }).catch((e) => console.error('[portal] Kreiswechsel-Mail:', e))
        }

        keinCache(res)
        res.status(201).json(ergebnis)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------ Fuehrungszeugnis ------ */

  app.post('/portal/fz', body(), async (req: Request, res: Response) => {
    try {
      const scope = await requirePortal(req)
      const eingabe = pruefeFzEingabe(req.body)
      await assertPerson(scope, eingabe.personID)

      const { fzID, warnung } = await addFz(eingabe, scope.personID)

      await audit(
        scope.portalUserID,
        'fz.add',
        `person:${eingabe.personID}`,
        req
      )
      keinCache(res)
      res.status(201).json({
        fzID,
        farbe: ampel(eingabe.fzVon, null),
        gueltigBis: dateObj(gueltigBis(eingabe.fzVon)),
        warnung
      })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })
}
