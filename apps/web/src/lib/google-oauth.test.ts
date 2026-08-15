import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeGoogleCode,
  fetchGmailProfile,
  googleAuthorizationUrl,
} from "./google-oauth";

describe("Google OAuth", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://cargo.example.com";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.INBOX_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests only Gmail read/send access with offline consent", () => {
    const url = new URL(googleAuthorizationUrl("state-123"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://cargo.example.com/api/inboxes/google/callback",
    );
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });

  it("exchanges the callback code and resolves the connected mailbox", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: "Info@Skyvalence.com" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(exchangeGoogleCode("callback-code")).resolves.toMatchObject({
      refresh_token: "refresh-token",
    });
    await expect(fetchGmailProfile("access-token")).resolves.toBe(
      "info@skyvalence.com",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
