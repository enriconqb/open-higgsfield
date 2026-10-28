/**
 * Runs all seed steps (currently: superadmin from SUPERADMIN_* env).
 * Usage: pnpm db:seed
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", script)], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  console.log("Seeding database…");
  await run("db-seed-admin.mjs");
  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
