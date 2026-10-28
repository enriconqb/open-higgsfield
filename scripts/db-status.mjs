import { appliedMigrations, listMigrationFiles, openPool } from "./_db.mjs";

async function main() {
  const pool = await openPool();
  try {
    const appliedRows = await appliedMigrations(pool);
    const applied = new Map(appliedRows.map((row) => [row.name, row.applied_at]));
    const files = listMigrationFiles();

    if (files.length === 0) {
      console.log("No migration files in database/migrations.");
      return;
    }

    console.log("Migration status");
    console.log("----------------");
    let pending = 0;
    for (const name of files) {
      const at = applied.get(name);
      if (at) {
        const when = at instanceof Date ? at.toISOString() : String(at);
        console.log(`  [ran]     ${name}  (${when})`);
      } else {
        pending += 1;
        console.log(`  [pending] ${name}`);
      }
    }
    console.log("----------------");
    console.log(`${files.length - pending} ran, ${pending} pending`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
