import mysql from 'mysql2/promise';

export const DB_NAME = process.env.DB_NAME ?? 'sia_event_registration';

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});
