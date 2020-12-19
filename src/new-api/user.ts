import { Express } from "express";
import { changePWD, login } from "../users";
import { versions } from "../nichtErlaubteVersionen";
import { checkAuth } from "../auth";

export default (app: Express, base: string) => {
  app.post<{}, {}, { username: string, password: string, version: string }>(base + '/login', async (req, res, next) => {
    await checkAuth(req, res)

    if (versions.includes(req.body.version)) {
      throw new Error("Benutze Version der Verwaltung ist veraltet und wird nicht unterstützt!");
    }

    return login(req.body.username, req.body.password)
  })

  app.post<{}, {}, { oldPassword: string, newPassword: string }>(base + '/change-password', async (req, res, next) => {
    await checkAuth(req, res)
    return changePWD(req.headers.authorization!, req.body.oldPassword, req.body.newPassword)
  })
}