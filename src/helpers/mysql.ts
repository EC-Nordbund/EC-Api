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
 * Wie query(), aber mit Prepared Statement und OHNE SQL-Logging.
 *
 * Zwei Gründe für die zweite Funktion statt eines Umbaus von query():
 *
 * 1. `query()` loggt jedes Statement inklusive eingesetzter Werte auf stdout.
 *    Für die Portal-Abfragen wären das Namen, Geburtsdaten, Mailadressen und
 *    Telefonnummern im Container-Log — das hat weder Retention noch
 *    Zugriffsschutz. Portal-Code nutzt deshalb ausschließlich queryP() bzw.
 *    withConnection().
 * 2. Werte gehören als `?`-Parameter übergeben, nicht per sql-escape-tag in
 *    den String interpoliert (Muster aus api/sync.ts).
 *
 * @author Sebastian
 */
export async function queryP<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensurePool()

  const connection = await pool!.getConnection()
  try {
    return await connection.query(sql, params)
  } finally {
    connection.release()
  }
}

/**
 * Führt fn mit einer dedizierten Connection in einer Transaktion aus.
 * Commit bei Erfolg, Rollback bei jedem Fehler, Release garantiert.
 *
 * Bewusst NICHT getMySQL(): dessen 10-Sekunden-Auto-Release würde die
 * Connection mitten in einer laufenden Transaktion freigeben.
 * Queries innerhalb von fn sollen parametrisiert laufen:
 * conn.query('… WHERE x = ?', [wert])
 */
export async function withConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  await ensurePool()
  const connection = await pool!.getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (err) {
    try {
      await connection.rollback()
    } catch (rollbackErr) {
      console.error('Rollback fehlgeschlagen:', rollbackErr)
    }
    throw err
  } finally {
    connection.release()
  }
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
