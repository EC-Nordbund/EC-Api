"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promise_mysql_1 = require("promise-mysql");
const pool = promise_mysql_1.createPool({
    host: process.env.DB_HOST,
    database: process.env.DB_DB,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORT,
    connectionLimit: 18
});
async function query(sql, uid = -1) {
    console.log(`${uid}: '${sql}'`);
    const connection = await pool.getConnection();
    const result = await connection.query(sql);
    connection.release();
    return result;
}
exports.query = query;
