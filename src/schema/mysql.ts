import { createPool } from 'promise-mysql';

const pool = createPool({
  host: process.env.DB_HOST as string,
  database: process.env.DB_DB as string,
  user: process.env.DB_USERNAME as string,
  password: process.env.DB_PASSWORT as string,
  connectionLimit: 18
})

export async function query(sql: string, uid: number = -1) {
  console.log(`${uid}: '${sql}'`)

  const connection = await pool.getConnection()
  const result = await connection.query(sql)

  connection.release()

  return result
}
