import { createPool, Pool, PoolConnection } from 'promise-mysql'

let pool: Pool | null = null

export async function query<T = any>(sql: string, uid = -1): Promise<T[]> {
  if (!pool) {
    pool = await createPool({
      host: process.env.DB_HOST || '',
      database: process.env.DB_DB || '',
      user: process.env.DB_USERNAME || '',
      password: process.env.DB_PASSWORT || '',
      connectionLimit: 18
    })
  }
  console.log(`${uid}: '${sql}'`)

  const connection = await pool.getConnection()
  const result = await connection.query(sql)

  connection.release()

  return result
}

export async function getMySQL(to = 10): Promise<PoolConnection> {
  if (!pool) {
    pool = await createPool({
      host: process.env.DB_HOST || '',
      database: process.env.DB_DB || '',
      user: process.env.DB_USERNAME || '',
      password: process.env.DB_PASSWORT || '',
      connectionLimit: 18
    })
  }

  const connection = await pool.getConnection()

  setTimeout(() => {
    connection.release()
  }, to * 1000)

  return connection
}
