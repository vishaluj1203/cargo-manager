import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));

if (process.env.ALLOW_PRODUCTION_EMAIL_SMOKE !== "1") {
  throw new Error("Set ALLOW_PRODUCTION_EMAIL_SMOKE=1 to send synthetic mail");
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

const [{ sqlClient }, { decryptSecret }] = await Promise.all([
  import("@cargo/db"),
  import("@cargo/security"),
]);

type InboxCredential = {
  address: string;
  encryptedRefreshToken: string;
};

const rows = await sqlClient<InboxCredential[]>`
  select lower(inbox.address) as address,
         credentials.encrypted_refresh_token as "encryptedRefreshToken"
  from public.inbox_connections inbox
  join public.inbox_credentials credentials
    on credentials.inbox_connection_id = inbox.id
  where inbox.provider = 'gmail' and inbox.status = 'connected'
  order by inbox.created_at
  limit 1
`;
const inbox = rows[0];
if (!inbox) throw new Error("No connected Gmail inbox was found");

const refreshToken = decryptSecret(
  inbox.encryptedRefreshToken,
  process.env.INBOX_TOKEN_ENCRYPTION_KEY ?? "",
);
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
if (!tokenResponse.ok) {
  throw new Error(`Google token exchange failed (${tokenResponse.status})`);
}
const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
if (!tokenPayload.access_token)
  throw new Error("Google access token is missing");

const marker = `${Date.now()}-${randomUUID().slice(0, 8)}`;

async function sendSynthetic(subject: string, body: string, suffix: string) {
  const mime = [
    `From: KAN-6 Synthetic Customer <${inbox.address}>`,
    `To: Cargo Desk <${inbox.address}>`,
    `Subject: ${subject}`,
    `Message-ID: <kan6-${suffix}-${marker}@skyvalence.com>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  const raw = Buffer.from(mime).toString("base64url");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gmail send failed (${response.status})`);
  }
}

try {
  await sendSynthetic(
    `[Cargo Demo] KAN-6 RFQ ${marker}`,
    `Hello Cargo Desk,

Please quote your best ocean freight rate for one 40HC container from Felixstowe (GBFXT) to Jebel Ali (AEJEA). Cargo is non-hazardous machinery, 18,500 kg, ready 28 August 2026. Please include transit time, free days, validity and all surcharges.

Regards,
KAN-6 Synthetic Customer`,
    "quote",
  );
  await sendSynthetic(
    `[Cargo Demo] KAN-6 automated notice ${marker}`,
    `Automated notification: our office opening hours have changed. This is an informational system message. No freight quote, rate or shipment proposal is requested. No reply is required.`,
    "non-enquiry",
  );
  console.log(JSON.stringify({ marker, messagesSent: 2 }));
} finally {
  await sqlClient.end();
}
