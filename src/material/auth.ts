import { Request } from 'express'
import { forbidden } from '../portal/error'
import { requirePortal, type PortalScope } from '../portal/scope'
import { requireMaterialSchema, type Bereich } from './config'

/**
 * Wer sieht was in der Materialverwaltung.
 *
 * Zwei Bereiche: `allgemein` fuer jeden Portal-Nutzer, `referenten` (Drucker,
 * Stifte ...) fuer Freizeitleitung und Hauptleitung -- also alle mit einer
 * Veranstaltung im vollen Umfang -- sowie Materialwarte und Superuser.
 * Ortsverantwortliche und Kuechenleitung sehen nur den allgemeinen Bereich.
 */
export function siehtReferenten(scope: PortalScope): boolean {
  return (
    scope.superuser ||
    scope.materialVerwalter ||
    scope.veranstaltungen.some((v) => v.umfang === 'voll')
  )
}

export function sichtbareBereiche(scope: PortalScope): Bereich[] {
  return siehtReferenten(scope) ? ['allgemein', 'referenten'] : ['allgemein']
}

/** Portal-Anmeldung plus Schema -- fuer alle Material-Routen. */
export async function requireMaterial(req: Request): Promise<PortalScope> {
  const scope = await requirePortal(req)
  await requireMaterialSchema()
  return scope
}

/** Zusaetzlich die Rolle Materialwart (Superuser haben sie implizit). */
export async function requireMaterialwart(req: Request): Promise<PortalScope> {
  const scope = await requireMaterial(req)
  if (!scope.materialVerwalter) {
    throw forbidden('Das Material verwaltet die/der Materialwart/in.')
  }
  return scope
}
