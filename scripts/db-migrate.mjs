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

/** Split a migration file into statements on `;`, but only where a semicolon is
    real SQL. A naive `split(";")` breaks on a semicolon inside a comment or a
    quoted string: it cuts mid-comment and sends the remaining prose to the
    server, which answers "You have an error in your SQL syntax ... near '<the
    words after the semicolon>'". Line 3 of 005_api_jobs.sql did exactly that.
    So walk the text and skip over comments, strings and identifiers. */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment (also covers MySQL's # form)
    if ((ch === "-" && next === "-") || ch === "#") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // 'string' | "string" | `identifier` — honour \ escapes and doubled quotes
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "\\" && quote !== "`") {
          j += 2;
          continue;
        }
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2; // escaped quote inside the literal
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    if (ch === ";") {
      statements.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  statements.push(current);
  return statements
    .map((part) => stripLeadingComments(part))
    .filter((part) => part !== "");
}

/** Drop the comment/blank preamble from a fragment and return the real SQL.
    Returns "" when the fragment held no statement at all. Sending the preamble
    along is what makes a fragment that *starts mid-comment* dangerous, so the
    server only ever receives the statement itself. */
function stripLeadingComments(fragment) {
  let rest = fragment;
  for (;;) {
    const before = rest;
    rest = rest.replace(/^\s+/, "");
    if (rest.startsWith("--") || rest.startsWith("#")) {
      const nl = rest.indexOf("\n");
      rest = nl === -1 ? "" : rest.slice(nl + 1);
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      rest = end === -1 ? "" : rest.slice(end + 2);
    }
    if (rest === before) break;
  }
  return rest.trim();
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
      const statements = splitStatements(sql);
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
