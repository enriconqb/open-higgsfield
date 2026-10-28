import fs from "node:fs";
import path from "node:path";

import {
  appliedMigrations,
  listMigrationFiles,
  migrationsDir,
  openPool,
} from "./_db.mjs";

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
      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
        await conn.commit();
        console.log(`  Ran ${name}`);
      } catch (error) {
        await conn.rollback();
        throw error;
      }
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
