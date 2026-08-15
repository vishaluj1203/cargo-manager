import { decryptSecret, encryptSecret } from "@cargo/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  exchangeGoogleCode,
  fetchGmailProfile,
  gmailScopes,
  googleOAuthConfig,
} from "@/lib/google-oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const stateSchema = z.object({
  state: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
});

function finish(request: NextRequest, query: string) {
  const response = NextResponse.redirect(
    new URL(`/settings/inboxes?${query}`, request.url),
  );
  response.cookies.delete("cargo_google_oauth");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const envelope = request.cookies.get("cargo_google_oauth")?.value;
  if (oauthError) return finish(request, "error=google_denied");
  if (!code || !returnedState || !envelope) {
    return finish(request, "error=invalid_callback");
  }

  try {
    const config = googleOAuthConfig();
    const state = stateSchema.parse(
      JSON.parse(decryptSecret(envelope, config.encryptionKey)),
    );
    const user = await getAuthenticatedUser();
    if (!user || user.id !== state.userId || state.state !== returnedState) {
      return finish(request, "error=invalid_state");
    }

    const supabase = await createClient();
    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", state.organizationId)
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (membershipError || !membership) {
      return finish(request, "error=permission");
    }

    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      return finish(request, "error=missing_refresh_token");
    }
    const address = await fetchGmailProfile(tokens.access_token);
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [
      ...gmailScopes,
    ];
    const encryptedRefreshToken = encryptSecret(
      tokens.refresh_token,
      config.encryptionKey,
    );
    const { error } = await supabase.rpc("connect_gmail_inbox", {
      target_organization_id: state.organizationId,
      inbox_address: address,
      encrypted_refresh_token: encryptedRefreshToken,
      granted_scopes: scopes,
    });
    if (error) throw new Error(error.message);
    return finish(request, `connected=${encodeURIComponent(address)}`);
  } catch (cause) {
    console.error("Gmail OAuth callback failed", cause);
    return finish(request, "error=connection_failed");
  }
}
