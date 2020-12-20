import { Request } from 'express'
import { ecError } from './helpers/error'
import { checkToken } from './helpers/jwt'

export async function checkAuth(req: Request): Promise<void> {
  const authToken = req.headers.authorization

  if (!authToken) {
    throw new ecError('Keine Authentifizierung übermittelt!', 401)
  }

  try {
    await checkToken(authToken)
  } catch (ex) {
    throw new ecError('Keine valide Authentifizierung übermittelt!', 401)
  }
}
