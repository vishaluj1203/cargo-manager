import { resolve } from "node:path";

import type { EmailProvider } from "@cargo/email";

import type { ConnectedInbox } from "./types.js";

function loadLocalEnvironment() {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));
  } catch {
    // Hosted environments inject configuration directly.
  }

  for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const) {
    const value = process.env[key];
    const password = process.env.DB_PASSWORD;
    if (!value || !password) continue;
    process.env[key] = value.replace(
      "[YOUR-PASSWORD]",
      encodeURIComponent(password),
    );
  }
}

export async function createWorkerRuntime() {
  loadLocalEnvironment();
  const [
    { createCargoExtractorFromEnv, createEnquiryClassifierFromEnv },
    { createEmailProviderFromEnv, GmailEmailProvider },
    { decryptSecret },
    { PostgresWorkerRepository },
    { CargoWorkerRuntime },
    { SupabaseRawEmailStore },
  ] = await Promise.all([
    import("@cargo/ai"),
    import("@cargo/email"),
    import("@cargo/security"),
    import("./repository.js"),
    import("./runtime.js"),
    import("./storage.js"),
  ]);

  const repository = new PostgresWorkerRepository();
  const localEmail = createEmailProviderFromEnv();
  const gmailProviders = new Map<string, EmailProvider>();
  const extractor = createCargoExtractorFromEnv();
  const classifier = createEnquiryClassifierFromEnv();
  const rawStore = new SupabaseRawEmailStore(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );

  const providerFor = (
    connection: Pick<
      ConnectedInbox,
      "provider" | "address" | "encryptedRefreshToken" | "grantedScopes"
    >,
  ): EmailProvider => {
    if (connection.provider === "local_mailpit") return localEmail;
    if (connection.provider !== "gmail") {
      throw new Error(`${connection.provider} inboxes are not supported yet`);
    }
    if (!connection.encryptedRefreshToken) {
      throw new Error(
        `Gmail inbox ${connection.address} has no OAuth credential`,
      );
    }

    const encryptionKey = process.env.INBOX_TOKEN_ENCRYPTION_KEY ?? "";
    const refreshToken = decryptSecret(
      connection.encryptedRefreshToken,
      encryptionKey,
    );
    const cacheKey = `${connection.address}:${connection.encryptedRefreshToken}`;
    const cached = gmailProviders.get(cacheKey);
    if (cached) return cached;

    const provider = new GmailEmailProvider({
      address: connection.address,
      refreshToken,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      query: process.env.GMAIL_INITIAL_QUERY,
    });
    gmailProviders.set(cacheKey, provider);
    return provider;
  };

  return {
    repository,
    runtime: new CargoWorkerRuntime(
      repository,
      providerFor,
      extractor,
      classifier,
      rawStore,
    ),
  };
}
