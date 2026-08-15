import { encryptSecret } from "@cargo/security";
import { NextResponse } from "next/server";

import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/auth";
import { googleAuthorizationUrl, googleOAuthConfig } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const [user, membership] = await Promise.all([
    getAuthenticatedUser(),
    getCurrentWorkspace(),
  ]);
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!membership) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  if (!(["owner", "admin"] as string[]).includes(membership.role)) {
    return NextResponse.redirect(
      new URL("/settings/inboxes?error=permission", request.url),
    );
  }

  const state = crypto.randomUUID();
  const { encryptionKey, appUrl } = googleOAuthConfig();
  const envelope = encryptSecret(
    JSON.stringify({
      state,
      organizationId: membership.organization_id,
      userId: user.id,
    }),
    encryptionKey,
  );
  const response = NextResponse.redirect(googleAuthorizationUrl(state));
  response.cookies.set("cargo_google_oauth", envelope, {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/inboxes/google/callback",
    maxAge: 10 * 60,
  });
  return response;
}
