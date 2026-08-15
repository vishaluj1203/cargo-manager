import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env.local"));
} catch {
  // CI can provide configuration directly.
}

function required(name, fallback) {
  const value = process.env[name]?.trim() || fallback?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(args) {
  const result = spawnSync("gcloud", args, {
    cwd: resolve(import.meta.dirname, "../.."),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const projectId = process.argv[2] ?? required("GCP_PROJECT_ID");
const region = process.env.GCP_REGION ?? "europe-west2";
const image = `${region}-docker.pkg.dev/${projectId}/cargo-manager/web:latest`;
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

run([
  "builds",
  "submit",
  "--config",
  "deploy/gcp/cloudbuild.web.yaml",
  "--substitutions",
  `_IMAGE=${image},_NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl},_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${supabaseKey}`,
  "--project",
  projectId,
]);
run([
  "run",
  "deploy",
  "cargo-manager-web",
  "--image",
  image,
  "--region",
  region,
  "--project",
  projectId,
]);
