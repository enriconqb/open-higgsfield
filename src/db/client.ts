import mysql, {
  type Pool,
  type QueryValues,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  pool = mysql.createPool(url);
  return pool;
}

export async function queryRows<T extends RowDataPacket>(
  sql: string,
  params: QueryValues = [],
): Promise<T[]> {
  const [rows] = await getPool().query<T[]>(sql, params);
  return rows;
}

export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: QueryValues = [],
): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: QueryValues = []): Promise<ResultSetHeader> {
  const [result] = await getPool().query<ResultSetHeader>(sql, params);
  return result;
}

/** Let a one-shot script exit instead of waiting on the pool's idle sockets. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
