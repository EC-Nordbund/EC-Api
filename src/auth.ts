import { Request } from 'express'
import { ecError } from './helpers/error'
import { checkToken } from './helpers/jwt'
import { payload } from './types/payload'

/**
 * Testet ob ein Request mit valider Authentifizierung durchgeführt wurde.
 * @author Sebastian
 * @param req Request Objet
 */
export async function checkAuth(req: Request<any>): Promise<payload> {
  const authToken = req.headers.authorization

  if (!authToken) {
    throw new ecError('Keine Authentifizierung übermittelt!', 401)
  }

  try {
    return await checkToken(authToken)
  } catch (ex) {
    throw new ecError('Keine valide Authentifizierung übermittelt!', 401)
  }
}
