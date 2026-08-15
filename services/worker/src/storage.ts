import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { RawEmailStore } from "./types.js";

export class SupabaseRawEmailStore implements RawEmailStore {
  readonly #client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    if (!url || !serviceRoleKey || serviceRoleKey.includes("YOUR_")) {
      throw new Error(
        "Supabase URL and service-role key are required for raw email storage",
      );
    }
    this.#client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async put(
    organizationId: string,
    providerMessageId: string,
    raw: Buffer,
  ): Promise<string> {
    const safeMessageId = encodeURIComponent(providerMessageId);
    const path = `${organizationId}/local_mailpit/${safeMessageId}.eml`;
    const { error } = await this.#client.storage
      .from("cargo-email-raw")
      .upload(path, raw, {
        contentType: "message/rfc822",
        upsert: true,
      });
    if (error) throw new Error(`Raw email upload failed: ${error.message}`);
    return path;
  }
}
