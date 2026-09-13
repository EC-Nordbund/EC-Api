import { Express, NextFunction, Request, Response } from 'express'
import { json, raw } from 'body-parser'
import expressRateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { checkAuth } from '../auth'
import { errorHandler } from '../helpers/error'
import { queryP } from '../helpers/mysql'
import { clientIp } from '../portal/audit'
import {
  PortalFehler,
  badRequest,
  forbidden,
  portalErrorHandler
} from '../portal/error'
import { requirePortal, type PortalScope } from '../portal/scope'
import {
  assertSkKreis,
  erzeugeUebergabe,
  fordereCodeAn,
  loginMitCode,
  loginMitUebergabe,
  normalisiereEmail,
  requireSk
} from '../schutzkonzept/auth'
import { skAudit } from '../schutzkonzept/audit'
import {
  DOCM_MIME,
  DOCX_MIME,
  MAX_VORLAGE_BYTES,
  requireSchutzkonzeptAktiv,
  requireSchutzkonzeptSchema
} from '../schutzkonzept/config'
import {
  anstehendeErinnerungen,
  erinnerungenVerschicken
} from '../schutzkonzept/erinnerung'
import {
  aendereVorlage,
  ersetzeVorlage,
  ladeVersion,
  ladeVorlageDatei,
  ladeVorlageHoch,
  listeVersionen,
  loescheVorlage,
  neueVersion,
  speichereVersion,
  testPdf,
  veroeffentlicheVersion,
  verwirfVersion
} from '../schutzkonzept/formular'
import {
  alleKreise,
  kreisUebersicht,
  ladePdf,
  ladeStand,
  oeffneDraft,
  speichereBereich,
  veroeffentlicheDraft,
  verwirfDraft,
  vorschauPdf
} from '../schutzkonzept/stand'

/**
 * REST-Routen des Schutzkonzepts. Drei Kreise von Aufrufern:
 *
 *  /schutzkonzept/*          Ausfuell-System der EC-Kreise (Login per Code)
 *  /portal/schutzkonzept/*   Schutzkonzept-Verwalter im Portal (Portal-Token)
 *  /v6/eckreis/:id/schutzkonzept-email   Pflege der E-Mails in der Verwaltung
 *
 * Aufbau wie api/portal.ts: Routen direkt an `app`, eigener JSON-Parser mit
 * Groessenlimit pro Route, JSON-Fehler mit stabilem `code`.
 */

/**
 * Formulardaten koennen gross werden (lange Freitexte, Raumtabellen) -- mehr
 * als die 32 kB der uebrigen Portal-Routen, aber weit unter dem, was ein
 * Missbrauch braeuchte.
 */
const body = () => json({ limit: '2mb' })

/**
 * Vorlagen-Upload (roher DOCX-Body). Drei Dinge, die body-parser allein
 * nicht leistet:
 *  - erst anmelden, dann puffern: sonst nimmt die API von jedem anonymen
 *    Aufruf bis zu 20 MB entgegen, bevor sie 401 sagt. Der Verwalter-Scope
 *    steht danach in res.locals.verwalter;
 *  - Content-Type kleingeschrieben vergleichen (siehe DOCM_MIME): type-is
 *    schreibt nur den Typ der Anfrage klein, nicht die erwartete Liste;
 *  - "zu gross" als JSON-Fehler TOO_LARGE statt der HTML-Seite des
 *    Express-Standardhandlers, damit das Portal die Meldung zeigen kann.
 * Die eigentliche Pruefung (ZIP-Signatur, Groesse) macht pruefeDocx in
 * formular.ts; das Typ-Filter hier entscheidet nur, ob ueberhaupt gepuffert
 * wird.
 */
const DOCX_TYPEN = [DOCX_MIME, DOCM_MIME, 'application/octet-stream']
function docx() {
  const parser = raw({
    type: (req) =>
      DOCX_TYPEN.includes(
        String(req.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase()
      ),
    limit: MAX_VORLAGE_BYTES + 1024
  })
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.verwalter = await requireVerwalter(req)
    } catch (err) {
      portalErrorHandler(err, res)
      return
    }
    parser(req, res, (err?: any) => {
      if (!err) {
        next()
      } else if (err.type === 'entity.too.large') {
        portalErrorHandler(
          new PortalFehler(
            'TOO_LARGE',
            `Die Datei ist größer als ${MAX_VORLAGE_BYTES / 1024 / 1024} MB.`,
            413
          ),
          res
        )
      } else if (typeof err.status === 'number' && err.status < 500) {
        // Abgebrochene Uebertragung, falsche Kodierung u. ae.: Fehler des
        // Clients, kein 500 mit Log-Eintrag.
        portalErrorHandler(
          new PortalFehler(
            'INVALID_INPUT',
            'Die Datei konnte nicht gelesen werden.',
            err.status
          ),
          res
        )
      } else {
        portalErrorHandler(err, res)
      }
    })
  }
}

/** Code anfordern: pro Adresse und pro IP gebremst (Mail-Bombing). */
const codeLimiterEmail = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '')
      .toLowerCase()
      .slice(0, 120)}`
})
const codeLimiterIp = expressRateLimit({ windowMs: 15 * 60 * 1000, max: 30 })
/** Code einloesen: sechs Ziffern sind schnell durchprobiert -- eng halten. */
const loginLimiter = expressRateLimit({ windowMs: 15 * 60 * 1000, max: 30 })

function keinCache(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
}

/** Fuer die /v6-Routen: positive Ganzzahl oder null (dann 400 als Text). */
function v6Id(v: unknown): number | null {
  const s = String(v ?? '')
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 2147483647 ? n : null
}

function id(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10)
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest('INVALID_INPUT', 'Ungültige ID.')
  }
  return n
}

function sendePdf(
  res: Response,
  pdf: Buffer,
  dateiname: string,
  inline = false
): void {
  keinCache(res)
  res
    .type('application/pdf')
    .set(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(dateiname)}`
    )
    .send(pdf)
}

async function requireVerwalter(req: Request): Promise<PortalScope> {
  const scope = await requirePortal(req)
  await requireSchutzkonzeptSchema()
  if (!scope.schutzkonzeptVerwalter) {
    throw forbidden(
      'Das Schutzkonzept verwaltet die/der Schutzkonzept-Verwalter/in.'
    )
  }
  return scope
}

const portalAkteur = (scope: PortalScope) => `portal:${scope.portalUserID}`

export default (app: Express): void => {
  /* ======================================================================
   * Ausfuell-System der EC-Kreise
   * ==================================================================== */

  app.post(
    '/schutzkonzept/login/code',
    body(),
    codeLimiterIp,
    codeLimiterEmail,
    async (req: Request, res: Response) => {
      try {
        await requireSchutzkonzeptAktiv()
        const email = normalisiereEmail(req.body?.email)
        if (!email) {
          throw badRequest(
            'INVALID_INPUT',
            'Bitte eine gültige E-Mail-Adresse angeben.'
          )
        }
        // Erst antworten, dann arbeiten: fuer hinterlegte Adressen folgen
        // DB-Transaktion und Mail, fuer unbekannte nichts. Abgewartet waere
        // das an der Antwortzeit ablesbar.
        res.status(202).json({ status: 'OK' })
        fordereCodeAn(email, clientIp(req)).catch((err) =>
          console.error('[schutzkonzept] Code-Anforderung fehlgeschlagen:', err)
        )
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/schutzkonzept/login',
    body(),
    loginLimiter,
    async (req: Request, res: Response) => {
      try {
        await requireSchutzkonzeptAktiv()
        const r = await loginMitCode(
          req.body?.email,
          req.body?.code,
          clientIp(req)
        )
        await skAudit(r.email, 'login.ok', '', req)
        keinCache(res)
        res.json({ token: r.token })
      } catch (err) {
        const email = normalisiereEmail(req.body?.email)
        if (email) await skAudit(email, 'login.fail', '', req)
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/schutzkonzept/login/uebergabe',
    body(),
    loginLimiter,
    async (req: Request, res: Response) => {
      try {
        await requireSchutzkonzeptAktiv()
        const r = await loginMitUebergabe(req.body?.token)
        keinCache(res)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get('/schutzkonzept/me', async (req: Request, res: Response) => {
    try {
      const scope = await requireSk(req)
      keinCache(res)
      res.json({ typ: scope.typ, name: scope.name, kreise: scope.kreise })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  app.get('/schutzkonzept/kreis/:id', async (req: Request, res: Response) => {
    try {
      const scope = await requireSk(req)
      const ecKreisID = id(req.params.id)
      assertSkKreis(scope, ecKreisID)
      keinCache(res)
      res.json(await kreisUebersicht(ecKreisID))
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  app.get(
    '/schutzkonzept/kreis/:id/stand/:standId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        keinCache(res)
        res.json(await ladeStand(ecKreisID, id(req.params.standId)))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /** Draft oeffnen (anlegen bzw. auf die neueste Formularversion heben). */
  app.post(
    '/schutzkonzept/kreis/:id/draft',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        const r = await oeffneDraft(ecKreisID, scope.akteur)
        await skAudit(scope.akteur, 'draft.oeffnen', `kreis:${ecKreisID}`, req)
        keinCache(res)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.put(
    '/schutzkonzept/kreis/:id/draft/bereich/:bereichId',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        const r = await speichereBereich(
          ecKreisID,
          String(req.params.bereichId),
          req.body,
          scope.akteur
        )
        await skAudit(
          scope.akteur,
          'draft.speichern',
          `kreis:${ecKreisID}`,
          req
        )
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/schutzkonzept/kreis/:id/draft/vorschau/:vorlageId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        const r = await vorschauPdf(ecKreisID, id(req.params.vorlageId))
        sendePdf(res, r.pdf, r.dateiname)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/schutzkonzept/kreis/:id/draft/publish',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        const r = await veroeffentlicheDraft(
          ecKreisID,
          req.body?.revision,
          scope.akteur
        )
        await skAudit(scope.akteur, 'draft.publish', `stand:${r.standID}`, req)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.delete(
    '/schutzkonzept/kreis/:id/draft',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        await verwirfDraft(ecKreisID, req.body?.revision ?? req.query.revision)
        await skAudit(
          scope.akteur,
          'draft.verwerfen',
          `kreis:${ecKreisID}`,
          req
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/schutzkonzept/kreis/:id/pdf/:pdfId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireSk(req)
        const ecKreisID = id(req.params.id)
        assertSkKreis(scope, ecKreisID)
        const r = await ladePdf(id(req.params.pdfId), ecKreisID)
        sendePdf(res, r.inhalt, r.dateiname)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ======================================================================
   * Portal: Schutzkonzept-Verwalter
   * ==================================================================== */

  app.get(
    '/portal/schutzkonzept/formular',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        keinCache(res)
        res.json({ versionen: await listeVersionen() })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/schutzkonzept/formular/versionen',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const formularVersionID = await neueVersion(
          scope.portalUserID,
          req.body?.notiz
        )
        await skAudit(
          portalAkteur(scope),
          'formular.neu',
          `version:${formularVersionID}`,
          req
        )
        res.status(201).json({ formularVersionID })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/formular/versionen/:vid',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        keinCache(res)
        res.json(await ladeVersion(id(req.params.vid)))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.put(
    '/portal/schutzkonzept/formular/versionen/:vid',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const vid = id(req.params.vid)
        const r = await speichereVersion(vid, req.body)
        await skAudit(
          portalAkteur(scope),
          'formular.speichern',
          `version:${vid}`,
          req
        )
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/schutzkonzept/formular/versionen/:vid/publish',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const vid = id(req.params.vid)
        await veroeffentlicheVersion(
          vid,
          req.body?.revision,
          scope.portalUserID
        )
        await skAudit(
          portalAkteur(scope),
          'formular.publish',
          `version:${vid}`,
          req
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.delete(
    '/portal/schutzkonzept/formular/versionen/:vid',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const vid = id(req.params.vid)
        await verwirfVersion(vid, req.query.revision)
        await skAudit(
          portalAkteur(scope),
          'formular.verwerfen',
          `version:${vid}`,
          req
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Upload als roher Body statt multipart: kommt ohne neue Abhaengigkeit aus.
   * Dateiname und Bezeichnung reisen URI-kodiert in Headern.
   */
  app.post(
    '/portal/schutzkonzept/formular/versionen/:vid/vorlagen',
    docx(),
    async (req: Request, res: Response) => {
      try {
        const scope: PortalScope = res.locals.verwalter // aus docx()
        const vid = id(req.params.vid)
        const vorlageID = await ladeVorlageHoch(
          vid,
          req.body,
          req.headers['x-dateiname'],
          req.headers['x-bezeichnung']
        )
        await skAudit(
          portalAkteur(scope),
          'vorlage.neu',
          `vorlage:${vorlageID}`,
          req
        )
        res.status(201).json({ vorlageID })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.put(
    '/portal/schutzkonzept/formular/versionen/:vid/vorlagen/:vorlageId',
    docx(),
    async (req: Request, res: Response) => {
      try {
        const scope: PortalScope = res.locals.verwalter // aus docx()
        const vorlageID = id(req.params.vorlageId)
        await ersetzeVorlage(
          id(req.params.vid),
          vorlageID,
          req.body,
          req.headers['x-dateiname']
        )
        await skAudit(
          portalAkteur(scope),
          'vorlage.ersetzen',
          `vorlage:${vorlageID}`,
          req
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.patch(
    '/portal/schutzkonzept/formular/versionen/:vid/vorlagen/:vorlageId',
    body(),
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        await aendereVorlage(
          id(req.params.vid),
          id(req.params.vorlageId),
          req.body
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.delete(
    '/portal/schutzkonzept/formular/versionen/:vid/vorlagen/:vorlageId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const vorlageID = id(req.params.vorlageId)
        await loescheVorlage(id(req.params.vid), vorlageID)
        await skAudit(
          portalAkteur(scope),
          'vorlage.loeschen',
          `vorlage:${vorlageID}`,
          req
        )
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/formular/vorlagen/:vorlageId',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        const v = await ladeVorlageDatei(id(req.params.vorlageId))
        keinCache(res)
        res
          .type(/\.docm$/i.test(v.dateiname) ? DOCM_MIME : DOCX_MIME)
          .set(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(v.dateiname)}`
          )
          .send(v.inhalt)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/schutzkonzept/formular/versionen/:vid/vorlagen/:vorlageId/testpdf',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        const r = await testPdf(id(req.params.vid), id(req.params.vorlageId))
        sendePdf(res, r.pdf, r.dateiname)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/kreise',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        keinCache(res)
        res.json(await alleKreise())
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/kreise/:id',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        const ecKreisID = id(req.params.id)
        const emails = await queryP<{ email: string }>(
          'SELECT email FROM skKreisEmail WHERE ecKreisID = ? ORDER BY email',
          [ecKreisID]
        )
        keinCache(res)
        res.json({
          ...(await kreisUebersicht(ecKreisID)),
          emails: emails.map((e) => e.email),
          // Anstehende Termine und Erinnerungs-Protokoll gleich mit, damit
          // das Kreisdetail keinen zweiten Request braucht.
          erinnerungen: await anstehendeErinnerungen(ecKreisID)
        })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /** Anstehende Termine + Erinnerungs-Protokoll eines Kreises (Verwalter). */
  app.get(
    '/portal/schutzkonzept/kreise/:id/erinnerungen',
    async (req: Request, res: Response) => {
      try {
        await requireVerwalter(req)
        const ecKreisID = id(req.params.id)
        keinCache(res)
        // { heute, stand: {standID, versionNr} | null, termine: [...], protokoll: [...] }
        res.json(await anstehendeErinnerungen(ecKreisID))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/kreise/:id/stand/:standId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const ecKreisID = id(req.params.id)
        const r = await ladeStand(ecKreisID, id(req.params.standId))
        await skAudit(
          portalAkteur(scope),
          'stand.ansehen',
          `stand:${r.stand.standID}`,
          req
        )
        keinCache(res)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/schutzkonzept/pdf/:pdfId',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const pdfID = id(req.params.pdfId)
        const r = await ladePdf(pdfID, null)
        await skAudit(portalAkteur(scope), 'pdf.ansehen', `pdf:${pdfID}`, req)
        sendePdf(res, r.inhalt, r.dateiname)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /** Einmal-Link: als Verwalter im Ausfuell-System dieses Kreises arbeiten. */
  app.post(
    '/portal/schutzkonzept/kreise/:id/zugang',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const ecKreisID = id(req.params.id)
        const k = await queryP('SELECT 1 FROM ecKreis WHERE ecKreisID = ?', [
          ecKreisID
        ])
        if (k.length !== 1)
          throw badRequest('INVALID_INPUT', 'EC-Kreis nicht gefunden.')
        const r = await erzeugeUebergabe(
          scope.portalUserID,
          ecKreisID,
          clientIp(req)
        )
        await skAudit(
          portalAkteur(scope),
          'uebergabe',
          `kreis:${ecKreisID}`,
          req
        )
        keinCache(res)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Erinnerungslauf sofort ausfuehren (Verwalter; Test/Dev). Der Lauf ist
   * idempotent (Protokoll skErinnerung), im Dev also gefahrlos mehrfach
   * aufrufbar; Mails landen in Mailpit. `heute` (JJJJ-MM-TT) ist nur fuer
   * Tests gedacht: damit laesst sich ein kuenftiger Tag durchspielen. Was
   * dabei verschickt wird, steht danach fuer dieses Datum im Protokoll und
   * geht am echten Tag nicht noch einmal raus -- in Prod also nur mit
   * Bedacht.
   */
  app.post(
    '/portal/schutzkonzept/erinnerungen/lauf',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireVerwalter(req)
        const heute =
          typeof req.body?.heute === 'string' && req.body.heute
            ? req.body.heute
            : undefined
        if (heute !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(heute)) {
          throw badRequest('INVALID_INPUT', 'heute muss JJJJ-MM-TT sein.')
        }
        const r = await erinnerungenVerschicken(heute)
        await skAudit(
          portalAkteur(scope),
          'erinnerung.lauf',
          `${r.heute}:${r.mails}`,
          req
        )
        keinCache(res)
        // { heute, kreise, termine, faellig, neu, mails, fehler }
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ======================================================================
   * Verwaltung: Schutzkonzept-E-Mails eines EC-Kreises
   * (unter /v6: Verwaltungs-Token, text/plain-Fehler wie in portal-account.ts)
   * ==================================================================== */

  app.get(
    '/v6/eckreis/:id/schutzkonzept-email',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        await requireSchutzkonzeptSchema()
        const ecKreisID = v6Id(req.params.id)
        if (!ecKreisID) {
          res.status(400).end('Ungültige ID')
          return
        }
        const emails = await queryP(
          `SELECT skKreisEmailID, email, DATE_FORMAT(erstellt, '%Y-%m-%dT%H:%i:%sZ') AS erstellt
           FROM skKreisEmail WHERE ecKreisID = ? ORDER BY email`,
          [ecKreisID]
        )
        res.json({ emails })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.post(
    '/v6/eckreis/:id/schutzkonzept-email',
    async (req: Request, res: Response) => {
      try {
        const payload = await checkAuth(req)
        await requireSchutzkonzeptSchema()
        const ecKreisID = v6Id(req.params.id)
        if (!ecKreisID) {
          res.status(400).end('Ungültige ID')
          return
        }
        const email = normalisiereEmail(req.body?.email)
        if (!email) {
          res.status(400).end('Keine gültige E-Mail-Adresse.')
          return
        }
        const k = await queryP('SELECT 1 FROM ecKreis WHERE ecKreisID = ?', [
          ecKreisID
        ])
        if (k.length !== 1) {
          res.status(404).end('EC-Kreis nicht gefunden')
          return
        }
        const r: any = await queryP(
          'INSERT IGNORE INTO skKreisEmail (ecKreisID, email, erstellt_von) VALUES (?,?,?)',
          [ecKreisID, email, payload.userID ?? 0]
        )
        if (!r || r.affectedRows === 0) {
          res
            .status(409)
            .end('Diese E-Mail-Adresse ist bei diesem Kreis schon eingetragen.')
          return
        }
        res.status(201).json({ skKreisEmailID: r.insertId })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )

  app.delete(
    '/v6/eckreis/:id/schutzkonzept-email/:emailId',
    async (req: Request, res: Response) => {
      try {
        await checkAuth(req)
        await requireSchutzkonzeptSchema()
        const ecKreisID = v6Id(req.params.id)
        const emailID = v6Id(req.params.emailId)
        if (!ecKreisID || !emailID) {
          res.status(400).end('Ungültige ID')
          return
        }
        const r: any = await queryP(
          'DELETE FROM skKreisEmail WHERE skKreisEmailID = ? AND ecKreisID = ?',
          [emailID, ecKreisID]
        )
        if (!r || r.affectedRows === 0) {
          res.status(404).end('Nicht gefunden')
          return
        }
        res.json({ status: 'OK' })
      } catch (err) {
        errorHandler(err, res)
      }
    }
  )
}
