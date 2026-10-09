import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "database", "migrations");
const manifestPath = path.join(migrationsDir, "README.md");

const entries = (await readdir(migrationsDir))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const manifest = await readFile(manifestPath, "utf8");
const errors = [];

entries.forEach((name, index) => {
  const expectedPrefix = String(index + 1).padStart(3, "0");
  if (!name.startsWith(`${expectedPrefix}_`)) {
    errors.push(`Expected migration ${expectedPrefix}, found ${name}`);
  }
  if (!manifest.includes(`\`${name}\``)) {
    errors.push(`Migration ${name} is missing from database/migrations/README.md`);
  }
});

if (entries.length === 0) errors.push("No ordered SQL migrations were found");

if (errors.length > 0) {
  console.error("Migration integrity check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Migration integrity check passed (${entries.length} ordered migrations).`);
}
