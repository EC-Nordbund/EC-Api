import { Request } from 'express'
import { createPool, Pool } from 'promise-mysql'

let pool: Pool | null = null

export async function query(sql: string, uid = -1) {
  if (!pool) {
    pool = await createPool({
      host: process.env.DB_HOST || '',
      database: process.env.DB_DB || '',
      user: process.env.DB_USERNAME || '',
      password: process.env.DB_PASSWORT || '',
      connectionLimit: 18,
    })
  }
  console.log(`${uid}: '${sql}'`)

  const connection = await pool.getConnection()
  const result = await connection.query(sql)

  connection.release()

  return result
}

export async function getMySQL(to = 10) {
  if (!pool) {
    pool = await createPool({
      host: process.env.DB_HOST || '',
      database: process.env.DB_DB || '',
      user: process.env.DB_USERNAME || '',
      password: process.env.DB_PASSWORT || '',
      connectionLimit: 18,
    })
  }

  const connection = await pool.getConnection()

  const timer = setTimeout(() => {
    connection.release()
  }, to * 1000)

  return connection
}

type NoPromise<T> = T extends Promise<infer U> ? U : T

const connections = new WeakMap<
  Request,
  NoPromise<ReturnType<typeof getMySQL>>
>()

export async function createSQLContext(req: Request) {
  const con = await getMySQL()

  connections.set(req, con)

  return con
}

export function getSQLContext(req: Request) {
  return connections.get(req)!
}
