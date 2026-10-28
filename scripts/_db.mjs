import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

export const migrationsDir = path.join(root, "database", "migrations");

export function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is missing. Add it to .env (MySQL Laragon connection string).");
  }
  return url;
}

export async function openPool(options = {}) {
  const url = requireDatabaseUrl();
  if (options.multipleStatements) {
    const parsed = new URL(url);
    parsed.searchParams.set("multipleStatements", "true");
    return mysql.createPool(parsed.toString());
  }
  return mysql.createPool(url);
}

export async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export function listMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export async function appliedMigrations(conn) {
  await ensureMigrationsTable(conn);
  const [rows] = await conn.query("SELECT name, applied_at FROM schema_migrations ORDER BY name");
  return rows;
}
