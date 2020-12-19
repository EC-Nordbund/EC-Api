import { Request, Response } from "express";
import { checkToken } from "./users/jwt";


export async function checkAuth(req: Request, res: Response) {
  const authToken = req.headers.authorization

  if (!authToken) {
    throw new Error("Keine Authentifizierung übermittelt!");
  }

  try {
    await checkToken(authToken)
  } catch (ex) {
    console.error(ex)
    throw new Error("Keine valide Authentifizierung übermittelt!");
  }
}
