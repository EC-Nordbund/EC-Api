import { createPool, Pool, PoolConnection } from 'promise-mysql'

let pool: Pool | null = null

/**
 * Erzeugt Pool sofern nicht vorhanden.
 *
 * @author Sebastian
 */
async function ensurePool() {
  if (!pool) {
    pool = await createPool({
      host: process.env.DB_HOST || '',
      database: process.env.DB_DB || '',
      user: process.env.DB_USERNAME || '',
      password: process.env.DB_PASSWORT || '',
      connectionLimit: 18
    })
  }
}

/**
 * Führt eine SQL Abfrage aus und released dann die Connection
 *
 * @author Sebastian
 * @param sql SQL Query
 * @param uid UserID (wird niregendwo umgesetzt)
 *
 * @returns Array von irgendwas (kann als generic Argument angegeben werden)
 */
export async function query<T = any>(sql: string, uid = -1): Promise<T[]> {
  await ensurePool()
  console.log(`${uid}: '${sql}'`)

  const connection = await pool!.getConnection()
  const result = await connection.query(sql)

  connection.release()

  return result
}

/**
 * Gibt eine Connection aus. Und relased sie automatisch.
 *
 * @author Sebastian
 * @param to TimeOut zeit (default 10s)
 */
export async function getMySQL(to = 10): Promise<PoolConnection> {
  await ensurePool()

  const connection = await pool!.getConnection()

  setTimeout(() => {
    connection.release()
  }, to * 1000)

  return connection
}
