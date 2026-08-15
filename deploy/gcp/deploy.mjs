import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env.local"));
} catch {
  // CI can provide all values directly.
}

function required(name) {
  const value = process.env[name];
  if (!value || value.includes("YOUR_")) throw new Error(`${name} is required`);
  return value;
}

function run(args, options = {}) {
  const stdio = options.capture
    ? ["ignore", "pipe", "inherit"]
    : options.input
      ? ["pipe", "inherit", "inherit"]
      : "inherit";
  const result = spawnSync("gcloud", args, {
    cwd: resolve(import.meta.dirname, "../.."),
    env: process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio,
    input: options.input,
  });
  if (result.status !== 0) {
    throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function secretExists(projectId, name) {
  const result = spawnSync(
    "gcloud",
    ["secrets", "describe", name, "--project", projectId],
    { stdio: "ignore", env: process.env },
  );
  return result.status === 0;
}

function syncSecret(projectId, name, value) {
  if (!secretExists(projectId, name)) {
    run([
      "secrets",
      "create",
      name,
      "--replication-policy",
      "automatic",
      "--project",
      projectId,
    ]);
  }
  run(
    [
      "secrets",
      "versions",
      "add",
      name,
      "--data-file=-",
      "--project",
      projectId,
    ],
    {
      input: value,
    },
  );
}

function databaseUrl() {
  let value = required("DATABASE_URL");
  const placeholders = ["[YOUR-PASSWORD]", "YOUR_PASSWORD", "YOUR-PASSWORD"];
  if (placeholders.some((placeholder) => value.includes(placeholder))) {
    const password = encodeURIComponent(required("DB_PASSWORD"));
    for (const placeholder of placeholders)
      value = value.replace(placeholder, password);
  }
  return value;
}

const projectId = process.argv[2] ?? process.env.GCP_PROJECT_ID;
if (!projectId)
  throw new Error("Pass the GCP project ID or set GCP_PROJECT_ID");
const region = process.env.GCP_REGION ?? "europe-west2";
const repository = "cargo-manager";
const webAccount = `cargo-web@${projectId}.iam.gserviceaccount.com`;
const workerAccount = `cargo-worker@${projectId}.iam.gserviceaccount.com`;
const schedulerAccount = `cargo-scheduler@${projectId}.iam.gserviceaccount.com`;
const registry = `${region}-docker.pkg.dev/${projectId}/${repository}`;
const webImage = `${registry}/web:latest`;
const workerImage = `${registry}/worker:latest`;

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const googleClientId = required("GOOGLE_OAUTH_CLIENT_ID");

run(["config", "set", "project", projectId]);
run([
  "services",
  "enable",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudscheduler.googleapis.com",
  "secretmanager.googleapis.com",
  "gmail.googleapis.com",
]);

const repositoryCheck = spawnSync(
  "gcloud",
  [
    "artifacts",
    "repositories",
    "describe",
    repository,
    "--location",
    region,
    "--project",
    projectId,
  ],
  { stdio: "ignore", env: process.env },
);
if (repositoryCheck.status !== 0) {
  run([
    "artifacts",
    "repositories",
    "create",
    repository,
    "--repository-format",
    "docker",
    "--location",
    region,
    "--description",
    "Cargo Manager application images",
    "--project",
    projectId,
  ]);
}

for (const [accountId, displayName] of [
  ["cargo-web", "Cargo Manager web"],
  ["cargo-worker", "Cargo Manager worker"],
  ["cargo-scheduler", "Cargo Manager scheduler"],
]) {
  const exists =
    spawnSync(
      "gcloud",
      [
        "iam",
        "service-accounts",
        "describe",
        `${accountId}@${projectId}.iam.gserviceaccount.com`,
        "--project",
        projectId,
      ],
      { stdio: "ignore", env: process.env },
    ).status === 0;
  if (!exists) {
    run([
      "iam",
      "service-accounts",
      "create",
      accountId,
      "--display-name",
      displayName,
      "--project",
      projectId,
    ]);
  }
}

const secrets = {
  "cargo-database-url": databaseUrl(),
  "cargo-supabase-service-role-key": required("SUPABASE_SERVICE_ROLE_KEY"),
  "cargo-ai-api-key": required("AI_API_KEY"),
  "cargo-google-oauth-client-secret": required("GOOGLE_OAUTH_CLIENT_SECRET"),
  "cargo-inbox-token-encryption-key": required("INBOX_TOKEN_ENCRYPTION_KEY"),
};
for (const [name, value] of Object.entries(secrets))
  syncSecret(projectId, name, value);

for (const name of Object.keys(secrets)) {
  run([
    "secrets",
    "add-iam-policy-binding",
    name,
    "--member",
    `serviceAccount:${workerAccount}`,
    "--role",
    "roles/secretmanager.secretAccessor",
    "--project",
    projectId,
  ]);
}
for (const name of [
  "cargo-google-oauth-client-secret",
  "cargo-inbox-token-encryption-key",
]) {
  run([
    "secrets",
    "add-iam-policy-binding",
    name,
    "--member",
    `serviceAccount:${webAccount}`,
    "--role",
    "roles/secretmanager.secretAccessor",
    "--project",
    projectId,
  ]);
}

run([
  "builds",
  "submit",
  "--config",
  "deploy/gcp/cloudbuild.web.yaml",
  `--substitutions=_IMAGE=${webImage},_NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl},_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${supabaseKey}`,
  "--project",
  projectId,
]);
run([
  "builds",
  "submit",
  "--config",
  "deploy/gcp/cloudbuild.worker.yaml",
  `--substitutions=_IMAGE=${workerImage}`,
  "--project",
  projectId,
]);

run([
  "run",
  "deploy",
  "cargo-manager-web",
  "--image",
  webImage,
  "--region",
  region,
  "--service-account",
  webAccount,
  "--allow-unauthenticated",
  "--min",
  "0",
  "--max",
  "3",
  "--memory",
  "512Mi",
  "--cpu",
  "1",
  "--port",
  "8080",
  "--set-env-vars",
  `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl},NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${supabaseKey},GOOGLE_OAUTH_CLIENT_ID=${googleClientId},ONBOARDING_INBOX_PROVIDER=gmail`,
  "--set-secrets",
  "GOOGLE_OAUTH_CLIENT_SECRET=cargo-google-oauth-client-secret:latest,INBOX_TOKEN_ENCRYPTION_KEY=cargo-inbox-token-encryption-key:latest",
  "--project",
  projectId,
]);
const discoveredWebUrl = run(
  [
    "run",
    "services",
    "describe",
    "cargo-manager-web",
    "--region",
    region,
    "--format",
    "value(status.url)",
    "--project",
    projectId,
  ],
  { capture: true },
);
const appUrl = process.env.APP_URL?.startsWith("https://")
  ? process.env.APP_URL
  : discoveredWebUrl;
run([
  "run",
  "services",
  "update",
  "cargo-manager-web",
  "--region",
  region,
  "--update-env-vars",
  `APP_URL=${appUrl}`,
  "--project",
  projectId,
]);

run([
  "run",
  "deploy",
  "cargo-manager-worker",
  "--image",
  workerImage,
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
  `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl},GOOGLE_OAUTH_CLIENT_ID=${googleClientId},AI_PROVIDER=${process.env.AI_PROVIDER ?? "google"},AI_BASE_URL=${process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"},AI_MODEL=${process.env.AI_MODEL ?? "gemma-4-26b-a4b-it"},GMAIL_INITIAL_QUERY=${process.env.GMAIL_INITIAL_QUERY ?? 'newer_than:7d subject:"[Cargo Demo]"'}`,
  "--set-secrets",
  "DATABASE_URL=cargo-database-url:latest,SUPABASE_SERVICE_ROLE_KEY=cargo-supabase-service-role-key:latest,AI_API_KEY=cargo-ai-api-key:latest,GOOGLE_OAUTH_CLIENT_SECRET=cargo-google-oauth-client-secret:latest,INBOX_TOKEN_ENCRYPTION_KEY=cargo-inbox-token-encryption-key:latest",
  "--project",
  projectId,
]);
const workerUrl = run(
  [
    "run",
    "services",
    "describe",
    "cargo-manager-worker",
    "--region",
    region,
    "--format",
    "value(status.url)",
    "--project",
    projectId,
  ],
  { capture: true },
);
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

const schedulerExists =
  spawnSync(
    "gcloud",
    [
      "scheduler",
      "jobs",
      "describe",
      "cargo-manager-worker-minute",
      "--location",
      region,
      "--project",
      projectId,
    ],
    { stdio: "ignore", env: process.env },
  ).status === 0;
const schedulerArgs = [
  "scheduler",
  "jobs",
  schedulerExists ? "update" : "create",
  "http",
  "cargo-manager-worker-minute",
  "--location",
  region,
  "--schedule",
  "* * * * *",
  "--uri",
  `${workerUrl}/tasks/run`,
  "--http-method",
  "POST",
  "--oidc-service-account-email",
  schedulerAccount,
  "--oidc-token-audience",
  workerUrl,
  "--project",
  projectId,
];
run(schedulerArgs);

console.log(JSON.stringify({ projectId, region, appUrl, workerUrl }, null, 2));
