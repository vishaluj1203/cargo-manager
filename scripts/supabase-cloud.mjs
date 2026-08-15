import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
} catch {
  console.error(".env.local is required");
  process.exit(1);
}

const operation = process.argv[2];
if (operation !== "push" && operation !== "dry-run") {
  console.error("Usage: node scripts/supabase-cloud.mjs <push|dry-run>");
  process.exit(1);
}

let databaseUrl = process.env.DIRECT_DATABASE_URL;
if (!databaseUrl) {
  console.error("DIRECT_DATABASE_URL is not configured");
  process.exit(1);
}

const databasePassword = process.env.DB_PASSWORD;
for (const placeholder of [
  "[YOUR-PASSWORD]",
  "YOUR_PASSWORD",
  "YOUR-PASSWORD",
]) {
  if (databaseUrl.includes(placeholder) && databasePassword) {
    databaseUrl = databaseUrl.replace(
      placeholder,
      encodeURIComponent(databasePassword),
    );
  }
}

if (
  databaseUrl.includes("YOUR_") ||
  databaseUrl.includes("YOUR-") ||
  databaseUrl.includes("PLACEHOLDER")
) {
  console.error("DIRECT_DATABASE_URL still contains a placeholder");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error("DIRECT_DATABASE_URL is not a valid URL");
  process.exit(1);
}

if (
  !parsed.protocol.startsWith("postgres") ||
  !parsed.hostname.includes("supabase")
) {
  console.error(
    "DIRECT_DATABASE_URL must target the hosted Supabase PostgreSQL project",
  );
  process.exit(1);
}

const executable = resolve(
  import.meta.dirname,
  "../node_modules/.bin/supabase",
);
const args = ["db", "push", "--db-url", databaseUrl];
if (operation === "dry-run") args.push("--dry-run");

const result = spawnSync(executable, args, {
  cwd: resolve(import.meta.dirname, ".."),
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
