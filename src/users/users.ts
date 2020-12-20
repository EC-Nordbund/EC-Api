import { getMySQL } from '../helpers/mysql'
import { sha3_512 } from 'js-sha3'
import { checkToken, createToken } from '../helpers/jwt'
import { sql } from 'sql-escape-tag'
import { ecError } from '../helpers/error'

/**
 * Erzeugt aus einem Salt und einem Passwort den entsprechenden Hash
 *
 * @todo Benötigt rewrite mit build in Module.
 *
 * @author Sebastian
 * @returns Passwort Hash
 *
 * @param pwd Passwort
 * @param salt Salt
 */
function hash(pwd: string, salt: string): string {
  return sha3_512(salt + pwd)
}

/**
 * Loggt einen Benutzer ein und gibt einen Auth Token zurück
 *
 * @sql Nutz genau eine Connection
 * @throws Nutzername und Passwort passen nicht zusammen!
 * @throws Bei Problemen mit der MYSQL verbindung
 *
 * @author Sebastian
 * @returns AuthToken (als String)
 *
 * @param username Benutzername
 * @param password Passwort
 */
export async function login(
  username: string,
  password: string
  // res?: Response
): Promise<string> {
  const con = await getMySQL(1)

  const users = await con.query(
    sql`SELECT * FROM users WHERE ablauf_datum > NOW() AND username = ${username}`
  )

  if (users.length !== 1) {
    throw new ecError('Nutzername und Passwort passen nicht zusammen!', 401)
  }

  if (hash(password, users[0].salt) !== users[0].password) {
    throw new ecError('Nutzername und Passwort passen nicht zusammen!', 401)
  }

  await con.query(
    sql`UPDATE users SET last_login = NOW() WHERE user_id = ${users[0].user_id}`
  )
  return createToken({
    userID: users[0].user_id,
    username: users[0].username,
    personID: users[0].person_id,
    ablaufDatum: users[0].ablauf_datum
  })
}

/**
 * Ändert das Passwort ab
 *
 * @sql Nutz genau eine Connection
 *
 * @throws Benutzer existiert nicht mehr!
 * @throws Altes Passwort ist nicht korrekt!
 * @throws Bei Problemen mit der MYSQL verbindung
 *
 * @param authToken AuthToken der Anmeldung
 * @param oldPWD altes Passwort
 * @param newPWD neues Passwort
 */
export async function changePWD(
  authToken: string,
  oldPWD: string,
  newPWD: string
): Promise<true> {
  const con = await getMySQL(2)

  // Check is Authorized
  const data = await checkToken(authToken)

  const users = await con.query(
    sql`SELECT * FROM users WHERE ablauf_datum > NOW() AND username = ${data.username}`
  )

  if (users.length !== 1) {
    throw new Error('Benutzer existiert nicht mehr!')
  }

  if (hash(oldPWD, users[0].salt) !== users[0].password) {
    throw new Error('Altes Passwort ist nicht korrekt!')
  }

  // Create Pseudo-Random Salt
  const nSalt = sha3_512(
    `${Math.random()}${oldPWD}${Math.random()}${new Date().toISOString()}${newPWD}kjsfksjd`
  )
  // Neuer Hash
  const nHsh = hash(newPWD, nSalt)

  // Update DB
  await con.query(
    sql`UPDATE users SET password = ${nHsh}, salt = ${nSalt} WHERE username = ${data.username}`
  )

  return true
}
