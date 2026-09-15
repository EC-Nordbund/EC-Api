import { Express, NextFunction, Request, Response } from 'express'
import type { PortalScope } from '../portal/scope'
import { json } from 'body-parser'
import { audit } from '../portal/audit'
import { badRequest, portalErrorHandler } from '../portal/error'
import { requireMaterial, requireMaterialwart } from '../material/auth'
import {
  BELEGUNG_STANDARD_TAGE,
  heutePlus,
  zeitraumAusQuery
} from '../material/config'
import {
  fotoEntfernen,
  fotoSetzen,
  istSichtbar,
  katalog,
  katalogAlle,
  kategorieAendern,
  kategorieAnlegen,
  kategorieLoeschen,
  ladeFoto,
  ladeKategorien,
  ladeMaterial,
  materialAendern,
  materialAnlegen,
  materialArchivieren,
  stammdaten,
  vorschauen
} from '../material/katalog'
import {
  antraegeVerwaltung,
  antragAnlegen,
  antragBearbeiten,
  antragFuer,
  eigeneAntraege,
  ladeAntrag,
  packliste,
  pruefeAntragEingabe,
  pruefeFilter,
  storno
} from '../material/antrag'
import { belegung, konflikteFuerAntrag } from '../material/verfuegbarkeit'
import {
  sendeAllesZurueck,
  sendeAntragEingegangen,
  sendeAntragEntschieden,
  sendeAntragStorniert
} from '../material/mail'
import { erinnerungenVerschicken } from '../material/erinnerung'
import {
  pruefeVorlageEingabe,
  vorlageAnlegen,
  vorlageErsetzen,
  vorlageLoeschen,
  vorlagenFuer,
  vorlagenVerwaltung
} from '../material/vorlage'

/**
 * REST-Routen der Materialverwaltung (/portal/material/*).
 *
 * Gleiche Konventionen wie api/portal.ts: eigener Body-Parser je schreibender
 * Route, requirePortal als erste Zeile, JSON-Fehler ueber portalErrorHandler,
 * Audit nur mit IDs. Zwei Rechtestufen: requireMaterial (jeder Portal-
 * Nutzer, Sichtbarkeit nach Bereich) und requireMaterialwart.
 *
 * Mails gehen NACH der Antwort-relevanten Arbeit raus und werfen nicht: ein
 * SMTP-Ausfall darf keinen Antrag kippen (Muster Kreiswechsel-Mail).
 */

const body = () => json({ limit: '32kb' })
/**
 * Foto: 2 MB + 150 kB, base64 (+33 %), plus JSON-Rahmen.
 *
 * Erst anmelden, dann puffern (wie docx() im Schutzkonzept): sonst koennte
 * jeder Unangemeldete pro Request 4 MB in den Speicher druecken. Der
 * Materialwart-Scope landet in res.locals, die Route greift ihn dort ab.
 */
function fotoBody() {
  const parser = json({ limit: '4mb' })
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.scope = await requireMaterialwart(req)
    } catch (err) {
      portalErrorHandler(err, res)
      return
    }
    parser(req, res, next)
  }
}

function keinCache(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
}

function id(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10)
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest('INVALID_INPUT', 'Ungültige ID.')
  }
  return n
}

const mailFehler = (was: string) => (e: unknown) =>
  console.error(`[material] Mail (${was}) fehlgeschlagen:`, e)

export default (app: Express): void => {
  /* ================================================================ Nutzer */

  app.get(
    '/portal/material/stammdaten',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        keinCache(res)
        res.json(await stammdaten(scope))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get('/portal/material', async (req: Request, res: Response) => {
    try {
      const scope = await requireMaterial(req)
      const zeitraum = zeitraumAusQuery(req.query.von, req.query.bis)
      keinCache(res)
      res.json({ zeitraum, material: await katalog(scope, zeitraum) })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  app.get(
    '/portal/material/vorschauen',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        keinCache(res)
        res.json(await vorschauen(scope))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Vorlagen der sichtbaren Bereiche. Positionen ungefiltert -- der Katalog
   * kuerzt und laesst weg, was er gerade nicht sieht (dort steht `frei`).
   * Steht bewusst VOR der :id/foto-Route.
   */
  app.get('/portal/material/vorlagen', async (req: Request, res: Response) => {
    try {
      const scope = await requireMaterial(req)
      keinCache(res)
      res.json({ vorlagen: await vorlagenFuer(scope) })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  /**
   * Das grosse Foto. Sichtbarkeit wird hier ein zweites Mal geprueft (eine
   * ID laesst sich raten); unsichtbar heisst 404, nicht 403.
   * Privat cachebar: der Client haengt ?v=fotoStand an.
   */
  app.get('/portal/material/:id/foto', async (req: Request, res: Response) => {
    try {
      const scope = await requireMaterial(req)
      const materialID = id(req.params.id)
      const m = await ladeMaterial(materialID)
      if (!istSichtbar(scope, m)) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Kein Foto vorhanden.' }
        })
        return
      }
      const foto = await ladeFoto(materialID)
      res
        .setHeader('Cache-Control', 'private, max-age=604800')
        .type(foto.mimetype)
        .send(foto.inhalt)
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  /* ------------------------------------------------------------ Antraege */

  app.post(
    '/portal/material/antrag',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        const eingabe = await pruefeAntragEingabe(req.body, scope)
        const materialAntragID = await antragAnlegen(eingabe, scope)

        await audit(
          scope.portalUserID,
          'material.antrag.neu',
          `antrag:${materialAntragID}`,
          req
        )
        keinCache(res)
        res.status(201).json({ materialAntragID })

        const a = await ladeAntrag(materialAntragID)
        const konflikte = await konflikteFuerAntrag(materialAntragID)
        sendeAntragEingegangen(a, konflikte.size).catch(
          mailFehler('neuer Antrag')
        )
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get('/portal/material/antraege', async (req: Request, res: Response) => {
    try {
      const scope = await requireMaterial(req)
      keinCache(res)
      res.json({ antraege: await eigeneAntraege(scope.portalUserID) })
    } catch (err) {
      portalErrorHandler(err, res)
    }
  })

  app.get(
    '/portal/material/antrag/:id',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        const antrag = await antragFuer(scope, id(req.params.id))
        if (!antrag.eigener) {
          await audit(
            scope.portalUserID,
            'material.antrag.lesen',
            `antrag:${antrag.materialAntragID}`,
            req
          )
        }
        keinCache(res)
        res.json(antrag)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/material/antrag/:id/storno',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        const a = await storno(scope, id(req.params.id))
        await audit(
          scope.portalUserID,
          'material.antrag.storno',
          `antrag:${a.materialAntragID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
        sendeAntragStorniert(a).catch(mailFehler('Storno'))
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.patch(
    '/portal/material/antrag/:id/position/:posID',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterial(req)
        const materialAntragID = id(req.params.id)
        const posID = id(req.params.posID)
        const { allesZurueck } = await packliste(
          scope,
          materialAntragID,
          posID,
          {
            eingeladen: req.body?.eingeladen,
            zurueck: req.body?.zurueck
          }
        )
        await audit(
          scope.portalUserID,
          'material.packliste',
          `position:${posID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK', allesZurueck })
        if (allesZurueck) {
          ladeAntrag(materialAntragID)
            .then((a) => sendeAllesZurueck(a, scope.portalUserID))
            .catch(mailFehler('alles zurueck'))
        }
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ========================================================== Materialwart */

  app.get(
    '/portal/material/verwaltung/material',
    async (req: Request, res: Response) => {
      try {
        await requireMaterialwart(req)
        const zeitraum = zeitraumAusQuery(req.query.von, req.query.bis)
        keinCache(res)
        res.json({ zeitraum, material: await katalogAlle(zeitraum) })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/material/verwaltung/material',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialID = await materialAnlegen(
          req.body ?? {},
          scope.portalUserID
        )
        await audit(
          scope.portalUserID,
          'material.neu',
          `material:${materialID}`,
          req
        )
        keinCache(res)
        res.status(201).json({ materialID })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.patch(
    '/portal/material/verwaltung/material/:id',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialID = id(req.params.id)
        await materialAendern(materialID, req.body ?? {}, scope.portalUserID)
        await audit(
          scope.portalUserID,
          'material.aendern',
          `material:${materialID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /** Soft: aktiv = 0. Reaktivieren per PATCH { aktiv: true }. */
  app.delete(
    '/portal/material/verwaltung/material/:id',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialID = id(req.params.id)
        await materialArchivieren(materialID, scope.portalUserID)
        await audit(
          scope.portalUserID,
          'material.archiv',
          `material:${materialID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.put(
    '/portal/material/verwaltung/material/:id/foto',
    fotoBody(),
    async (req: Request, res: Response) => {
      try {
        const scope: PortalScope = res.locals.scope
        const materialID = id(req.params.id)
        await fotoSetzen(materialID, req.body ?? {})
        await audit(
          scope.portalUserID,
          'material.foto',
          `material:${materialID}`,
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
    '/portal/material/verwaltung/material/:id/foto',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialID = id(req.params.id)
        await fotoEntfernen(materialID)
        await audit(
          scope.portalUserID,
          'material.foto.weg',
          `material:${materialID}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ---------------------------------------------------------- Kategorien */

  app.get(
    '/portal/material/verwaltung/kategorie',
    async (req: Request, res: Response) => {
      try {
        await requireMaterialwart(req)
        keinCache(res)
        res.json({ kategorien: await ladeKategorien() })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/material/verwaltung/kategorie',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialKategorieID = await kategorieAnlegen(req.body ?? {})
        await audit(
          scope.portalUserID,
          'material.kategorie.neu',
          `kategorie:${materialKategorieID}`,
          req
        )
        keinCache(res)
        res.status(201).json({ materialKategorieID })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.patch(
    '/portal/material/verwaltung/kategorie/:id',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const kid = id(req.params.id)
        await kategorieAendern(kid, req.body ?? {})
        await audit(
          scope.portalUserID,
          'material.kategorie.aendern',
          `kategorie:${kid}`,
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
    '/portal/material/verwaltung/kategorie/:id',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const kid = id(req.params.id)
        await kategorieLoeschen(kid)
        await audit(
          scope.portalUserID,
          'material.kategorie.weg',
          `kategorie:${kid}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------------ Vorlagen */

  app.get(
    '/portal/material/verwaltung/vorlage',
    async (req: Request, res: Response) => {
      try {
        await requireMaterialwart(req)
        keinCache(res)
        res.json({ vorlagen: await vorlagenVerwaltung() })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.post(
    '/portal/material/verwaltung/vorlage',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const eingabe = await pruefeVorlageEingabe(req.body ?? {})
        const materialVorlageID = await vorlageAnlegen(
          eingabe,
          scope.portalUserID
        )
        await audit(
          scope.portalUserID,
          'material.vorlage.neu',
          `vorlage:${materialVorlageID}`,
          req
        )
        keinCache(res)
        res.status(201).json({ materialVorlageID })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.put(
    '/portal/material/verwaltung/vorlage/:id',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const vid = id(req.params.id)
        const eingabe = await pruefeVorlageEingabe(req.body ?? {})
        await vorlageErsetzen(vid, eingabe, scope.portalUserID)
        await audit(
          scope.portalUserID,
          'material.vorlage.aendern',
          `vorlage:${vid}`,
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
    '/portal/material/verwaltung/vorlage/:id',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const vid = id(req.params.id)
        await vorlageLoeschen(vid)
        await audit(
          scope.portalUserID,
          'material.vorlage.weg',
          `vorlage:${vid}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK' })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /* ------------------------------------------------------------ Antraege */

  app.get(
    '/portal/material/verwaltung/antraege',
    async (req: Request, res: Response) => {
      try {
        await requireMaterialwart(req)
        const filter = pruefeFilter(req.query.status)
        const zeitraum = zeitraumAusQuery(req.query.von, req.query.bis)
        keinCache(res)
        res.json({
          filter,
          zeitraum,
          antraege: await antraegeVerwaltung(filter, zeitraum)
        })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Entscheiden: Status, Antwort, genehmigte Mengen -- alles in einem PATCH.
   * Die Mail an den Antragsteller richtet sich nach dem tatsaechlichen
   * Uebergang (antragBearbeiten liefert das Ereignis).
   */
  app.patch(
    '/portal/material/verwaltung/antrag/:id',
    body(),
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const materialAntragID = id(req.params.id)
        const { vorher, nachher, ereignis } = await antragBearbeiten(
          scope,
          materialAntragID,
          {
            status: req.body?.status,
            antwort: req.body?.antwort,
            positionen: req.body?.positionen
          }
        )
        await audit(
          scope.portalUserID,
          'material.antrag.status',
          `antrag:${materialAntragID}:${nachher.status}`,
          req
        )
        keinCache(res)
        res.json({ status: 'OK', antragStatus: nachher.status, ereignis })

        if (ereignis) {
          const vorherMengen = new Map(
            vorher.positionen.map((p) => [
              p.materialAntragPositionID,
              p.mengeGenehmigt
            ])
          )
          sendeAntragEntschieden(nachher, ereignis, {
            vorher: vorherMengen,
            nichtAbgehakt: vorher.positionen.filter(
              (p) => (p.mengeGenehmigt ?? 0) > 0 && !p.zurueck
            ),
            durchPortalUserID: scope.portalUserID
          }).catch(mailFehler(ereignis))
        }
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  app.get(
    '/portal/material/verwaltung/belegung',
    async (req: Request, res: Response) => {
      try {
        await requireMaterialwart(req)
        const zeitraum = zeitraumAusQuery(req.query.von, req.query.bis) ?? {
          von: heutePlus(0),
          bis: heutePlus(BELEGUNG_STANDARD_TAGE)
        }
        keinCache(res)
        res.json({ zeitraum, material: await belegung(zeitraum) })
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )

  /**
   * Erinnerungslauf sofort ausfuehren (Materialwart; Test/Dev). Idempotent
   * ueber erinnert_am -- was verschickt wurde, geht am naechsten Tag nicht
   * noch einmal raus. In Prod also nur mit Bedacht.
   */
  app.post(
    '/portal/material/verwaltung/erinnerungen/test',
    async (req: Request, res: Response) => {
      try {
        const scope = await requireMaterialwart(req)
        const r = await erinnerungenVerschicken()
        await audit(
          scope.portalUserID,
          'material.erinnerung.lauf',
          `r:${r.rueckgabe}:u:${r.unbearbeitet}`,
          req
        )
        keinCache(res)
        res.json(r)
      } catch (err) {
        portalErrorHandler(err, res)
      }
    }
  )
}
