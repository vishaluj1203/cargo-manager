"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabasePublicConfig } from "./env";

export function createClient() {
  const { url, key } = supabasePublicConfig();
  return createBrowserClient(url, key);
}
