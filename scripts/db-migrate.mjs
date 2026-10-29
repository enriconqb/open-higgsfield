import fs from "node:fs";
import path from "node:path";

import {
  appliedMigrations,
  listMigrationFiles,
  migrationsDir,
  openPool,
} from "./_db.mjs";

/** Re-running an index or column change is expected to fail with a duplicate or
    missing name; the schema is already in the wanted shape, so those errors are
    warnings, not a failed migration. Anything else still aborts the run. */
const TOLERATED = new Set([
  "ER_DUP_KEYNAME",
  "ER_DUP_FIELDNAME",
  "ER_CANT_DROP_FIELD_OR_KEY",
  "ER_FK_DUP_NAME",
]);

function isTolerated(error) {
  return typeof error?.code === "string" && TOLERATED.has(error.code);
}

async function applyStatement(conn, statement) {
  try {
    await conn.query(statement);
  } catch (error) {
    if (isTolerated(error)) {
      console.log(`  skipped (already applied): ${error.code}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const pool = await openPool({ multipleStatements: true });
  const conn = await pool.getConnection();
  try {
    const applied = new Set((await appliedMigrations(conn)).map((row) => row.name));
    const files = listMigrationFiles();
    const pending = files.filter((name) => !applied.has(name));

    if (pending.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    for (const name of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
      console.log(`Migrating: ${name}`);
      // MySQL DDL is not transactional: one statement per try so a tolerated
      // failure cannot mask a real error in a later statement of the same file.
      const statements = sql
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !part.split("\n").every((line) => line.trim().startsWith("--")));
      for (const statement of statements) {
        await applyStatement(conn, statement);
      }
      await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
      console.log(`  Ran ${name}`);
    }
    console.log(`Done. Applied ${pending.length} migration(s).`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
