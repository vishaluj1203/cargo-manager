import { z } from "zod";

export const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("YOUR_"))
    throw new Error(`${name} is not configured`);
  return value;
}

export function googleOAuthConfig() {
  const appUrl = new URL(required("APP_URL"));
  return {
    clientId: required("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    encryptionKey: required("INBOX_TOKEN_ENCRYPTION_KEY"),
    appUrl: appUrl.origin,
    redirectUri: `${appUrl.origin}/api/inboxes/google/callback`,
  };
}

export function googleAuthorizationUrl(state: string): string {
  const config = googleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: gmailScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export async function exchangeGoogleCode(code: string) {
  const config = googleOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  return tokenSchema.parse(await response.json());
}

const profileSchema = z.object({ emailAddress: z.string().email() });

export async function fetchGmailProfile(accessToken: string): Promise<string> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Gmail profile lookup failed (${response.status})`);
  }
  return profileSchema.parse(await response.json()).emailAddress.toLowerCase();
}
