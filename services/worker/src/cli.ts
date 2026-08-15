import { resolve } from "node:path";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));

for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const) {
  const value = process.env[key];
  const password = process.env.DB_PASSWORD;
  if (!value || !password) continue;
  process.env[key] = value.replace(
    "[YOUR-PASSWORD]",
    encodeURIComponent(password),
  );
}

const [
  { createCargoExtractorFromEnv },
  { createEmailProviderFromEnv },
  { PostgresWorkerRepository },
  { CargoWorkerRuntime },
  { SupabaseRawEmailStore },
] = await Promise.all([
  import("@cargo/ai"),
  import("@cargo/email"),
  import("./repository.js"),
  import("./runtime.js"),
  import("./storage.js"),
]);

const repository = new PostgresWorkerRepository();
const localEmail = createEmailProviderFromEnv();
const extractor = createCargoExtractorFromEnv();
const rawStore = new SupabaseRawEmailStore(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
);
const runtime = new CargoWorkerRuntime(
  repository,
  (provider) => {
    if (provider !== "local_mailpit") {
      throw new Error(
        `${provider} provider is not enabled in the local demo worker`,
      );
    }
    return localEmail;
  },
  extractor,
  rawStore,
);

const mode = process.argv[2] ?? "once";
if (mode === "once") {
  console.log(JSON.stringify(await runtime.runOnce(), null, 2));
  await repository.close();
} else if (mode === "run") {
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  while (!stopping) {
    const summary = await runtime.runOnce();
    if (Object.values(summary).some((count) => count > 0))
      console.log(JSON.stringify(summary));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  await repository.close();
} else {
  await repository.close();
  throw new Error(`Unknown worker mode: ${mode}`);
}
