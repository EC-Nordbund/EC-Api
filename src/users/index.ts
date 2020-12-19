import { getMySQL } from '../schema/mysql';
import { sha3_512 } from 'js-sha3';
import { checkToken, createToken } from './jwt';
import { sql } from "sql-escape-tag";
import { PoolConnection } from 'promise-mysql';

function hash(pwd: string, salt: string): string {
  return sha3_512(salt + pwd)
}

export async function login(username: string, password: string, con?: PoolConnection) {
  if (!con) {
    con = await getMySQL(2)
  }

  const users = await con.query(sql`SELECT * FROM users WHERE ablauf_datum > NOW() AND username = ${username}`)

  if (users.length !== 1) {
    throw new Error("Nutzername und Passwort passen nicht zusammen!");
  }

  if (hash(password, users[0].salt) === users[0].password) {
    await con.query(sql`UPDATE users SET last_login = NOW() WHERE user_id = ${users[0].user_id}`)
    return createToken({
      userID: users[0].user_id,
      username: users[0].username,
      personID: users[0].person_id,
      ablaufDatum: users[0].ablauf_datum,
    })
  } else {
    throw new Error("Nutzername und Passwort passen nicht zusammen!");
  }
}

export async function changePWD(authToken: string, oldPWD: string, newPWD: string): Promise<boolean> {
  try {
    const con = await getMySQL(2)

    // Check is Authorized
    const data = await checkToken(authToken)
    // Altes Passwort überprüfen
    await login(data.username, oldPWD, con)

    // Create Pseudo-Random Salt
    const nSalt = sha3_512(`${Math.random()}${oldPWD}${Math.random()}${new Date().toISOString()}${newPWD}kjsfksjd`)
    // Neuer Hash
    const nHsh = hash(newPWD, nSalt)

    await con.query(sql`UPDATE users SET password = ${nHsh}, salt = ${nSalt} WHERE username = ${data.username}`)

    return true
  } catch (err) {
    throw new Error("Beim ändern des Passworts ist ein Fehler aufgetreten!");
  }
}
