import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env.local"));
} catch {
  // CI can inject all configuration directly.
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || value.includes("YOUR_")) throw new Error(`${name} is required`);
  return value;
}

function run(args, options = {}) {
  const result = spawnSync("gcloud", args, {
    cwd: resolve(import.meta.dirname, "../.."),
    env: process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture
      ? ["ignore", "pipe", "inherit"]
      : options.input
        ? ["pipe", "inherit", "inherit"]
        : "inherit",
    input: options.input,
  });
  if (result.status !== 0) {
    throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function secretExists(projectId, name) {
  return (
    spawnSync("gcloud", ["secrets", "describe", name, "--project", projectId], {
      stdio: "ignore",
      env: process.env,
    }).status === 0
  );
}

function assertSchedulerPaused(projectId, region) {
  const state = run(
    [
      "scheduler",
      "jobs",
      "describe",
      "cargo-manager-worker-minute",
      "--location",
      region,
      "--format",
      "value(state)",
      "--project",
      projectId,
    ],
    { capture: true },
  );
  if (state !== "PAUSED") {
    throw new Error(
      `Refusing worker deployment while cargo-manager-worker-minute is ${state || "not paused"}`,
    );
  }
}

const projectId = process.argv[2] ?? required("GCP_PROJECT_ID");
const region = process.env.GCP_REGION ?? "europe-west2";
const workerAccount = `cargo-worker@${projectId}.iam.gserviceaccount.com`;
const schedulerAccount = `cargo-scheduler@${projectId}.iam.gserviceaccount.com`;
const registry = `${region}-docker.pkg.dev/${projectId}/cargo-manager`;
const providedImage = process.env.WORKER_IMAGE?.trim();
const image = providedImage || `${registry}/worker:groq-${Date.now()}`;
const groqSecret = "cargo-groq-api-key";

assertSchedulerPaused(projectId, region);

if (!secretExists(projectId, groqSecret)) {
  run([
    "secrets",
    "create",
    groqSecret,
    "--replication-policy",
    "automatic",
    "--project",
    projectId,
  ]);
}
if (!providedImage) {
  run(
    [
      "secrets",
      "versions",
      "add",
      groqSecret,
      "--data-file=-",
      "--project",
      projectId,
    ],
    { input: required("GROQ_API_KEY") },
  );
}
run([
  "secrets",
  "add-iam-policy-binding",
  groqSecret,
  "--member",
  `serviceAccount:${workerAccount}`,
  "--role",
  "roles/secretmanager.secretAccessor",
  "--project",
  projectId,
]);

for (const name of [
  "cargo-database-url",
  "cargo-supabase-service-role-key",
  "cargo-google-oauth-client-secret",
  "cargo-inbox-token-encryption-key",
]) {
  if (!secretExists(projectId, name)) {
    throw new Error(`Required existing secret ${name} was not found`);
  }
}

if (!providedImage) {
  run([
    "builds",
    "submit",
    "--config",
    "deploy/gcp/cloudbuild.worker.yaml",
    `--substitutions=_IMAGE=${image}`,
    "--project",
    projectId,
  ]);
}

const secretBindings = [
  "DATABASE_URL=cargo-database-url:latest",
  "SUPABASE_SERVICE_ROLE_KEY=cargo-supabase-service-role-key:latest",
  `GROQ_API_KEY=${groqSecret}:latest`,
  "GOOGLE_OAUTH_CLIENT_SECRET=cargo-google-oauth-client-secret:latest",
  "INBOX_TOKEN_ENCRYPTION_KEY=cargo-inbox-token-encryption-key:latest",
];
if (secretExists(projectId, "cargo-ai-api-key")) {
  secretBindings.push("AI_API_KEY=cargo-ai-api-key:latest");
}

run([
  "run",
  "deploy",
  "cargo-manager-worker",
  "--image",
  image,
  "--region",
  region,
  "--service-account",
  workerAccount,
  "--no-allow-unauthenticated",
  "--min",
  "0",
  "--max",
  "1",
  "--concurrency",
  "1",
  "--memory",
  "512Mi",
  "--cpu",
  "1",
  "--timeout",
  "300",
  "--set-env-vars",
  [
    `NEXT_PUBLIC_SUPABASE_URL=${required("NEXT_PUBLIC_SUPABASE_URL")}`,
    `GOOGLE_OAUTH_CLIENT_ID=${required("GOOGLE_OAUTH_CLIENT_ID")}`,
    "AI_PROVIDER=groq",
    `GROQ_BASE_URL=${process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1"}`,
    `GROQ_MODEL=${process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"}`,
    `AI_BASE_URL=${process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"}`,
    `AI_MODEL=${process.env.AI_MODEL ?? "gemma-4-26b-a4b-it"}`,
    `GMAIL_INITIAL_QUERY=${process.env.GMAIL_INITIAL_QUERY ?? 'newer_than:7d subject:"[Cargo Demo]"'}`,
  ].join(","),
  "--set-secrets",
  secretBindings.join(","),
  "--project",
  projectId,
]);

run([
  "run",
  "services",
  "add-iam-policy-binding",
  "cargo-manager-worker",
  "--region",
  region,
  "--member",
  `serviceAccount:${schedulerAccount}`,
  "--role",
  "roles/run.invoker",
  "--project",
  projectId,
]);

assertSchedulerPaused(projectId, region);

const deployment = JSON.parse(
  run(
    [
      "run",
      "services",
      "describe",
      "cargo-manager-worker",
      "--region",
      region,
      "--format",
      "json(status.url,status.latestReadyRevisionName)",
      "--project",
      projectId,
    ],
    { capture: true },
  ),
);

console.log(
  JSON.stringify(
    {
      projectId,
      region,
      image,
      workerUrl: deployment.status?.url,
      revision: deployment.status?.latestReadyRevisionName,
      scheduler: "PAUSED",
    },
    null,
    2,
  ),
);
