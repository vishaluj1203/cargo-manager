import { randomUUID } from "node:crypto";
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
  { createClient },
  { default: nodemailer },
  { createCargoExtractorFromEnv },
  { createEmailProviderFromEnv },
  { sqlClient },
  { PostgresWorkerRepository },
  { CargoWorkerRuntime },
  { SupabaseRawEmailStore },
] = await Promise.all([
  import("@supabase/supabase-js"),
  import("nodemailer"),
  import("@cargo/ai"),
  import("@cargo/email"),
  import("@cargo/db"),
  import("../src/repository.js"),
  import("../src/runtime.js"),
  import("../src/storage.js"),
]);

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_API_KEY",
] as const;
for (const key of requiredEnvironment) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!publishableKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required",
  );
}

const marker = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const demoUserEmail = `cargo-e2e-${marker}@skyvalence.com`;
const demoPassword = `${randomUUID()}Aa1!`;
const inboxAddress = `cargo-e2e-${marker}@skyvalence.local`;
const customerAddress = `maya-${marker}@northstar.example`;
const inboundMessageId = `<cargo-e2e-${marker}@northstar.example>`;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const provider = createEmailProviderFromEnv();
const repository = new PostgresWorkerRepository();
const runtime = new CargoWorkerRuntime(
  repository,
  () => provider,
  createCargoExtractorFromEnv(),
  new SupabaseRawEmailStore(supabaseUrl, serviceRoleKey),
  `e2e-${marker}`,
);

let userId: string | null = null;
let organizationId: string | null = null;
let rawObjectPath: string | null = null;

async function waitForMail(recipient: string, messageIdFragment?: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const messages = await provider.listMessages(250);
    const found = messages.find(
      (message) =>
        message.recipients.includes(recipient.toLowerCase()) &&
        (!messageIdFragment ||
          message.rfcMessageId?.includes(messageIdFragment)),
    );
    if (found) return found;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for Mailpit recipient ${recipient}`);
}

try {
  const { data: createdUser, error: createUserError } =
    await admin.auth.admin.createUser({
      email: demoUserEmail,
      password: demoPassword,
      email_confirm: true,
      user_metadata: { full_name: "Cargo E2E Operator" },
    });
  if (createUserError) throw createUserError;
  userId = createdUser.user.id;

  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: demoUserEmail,
    password: demoPassword,
  });
  if (signInError) throw signInError;

  const { data: createdOrganization, error: onboardingError } =
    await userClient.rpc("create_workspace", {
      workspace_name: "Cargo E2E Workspace",
      workspace_slug: `cargo-e2e-${marker}`,
      workspace_company_type: "freight_forwarder",
      workspace_timezone: "Asia/Kolkata",
      workspace_modes: ["air", "ocean"],
      workspace_inbox_address: inboxAddress,
    });
  if (onboardingError) throw onboardingError;
  organizationId = createdOrganization as string;

  const smtp = nodemailer.createTransport({
    host: process.env.LOCAL_MAIL_SMTP_HOST ?? "127.0.0.1",
    port: Number(process.env.LOCAL_MAIL_SMTP_PORT ?? 1025),
    secure: false,
    ignoreTLS: true,
  });
  await smtp.sendMail({
    from: `Maya Chen <${customerAddress}>`,
    to: `Cargo E2E Desk <${inboxAddress}>`,
    subject: "Urgent status needed for container TCLU1234567",
    messageId: inboundMessageId,
    text: `Hello team,

Please confirm the current location of container TCLU1234567 moving from Singapore to Rotterdam.
The consignee needs delivery by Friday, 21 August 2026. Is it still on schedule?

Thanks,
Maya Chen
North Star Imports`,
  });

  const inboundMail = await waitForMail(inboxAddress, marker);
  rawObjectPath = `${organizationId}/local_mailpit/${encodeURIComponent(inboundMail.providerMessageId)}.eml`;

  const discovered = await runtime.discoverInbound();
  const inboundProcessed = await runtime.processOneInbound();
  const ingestSummary = { discovered, inboundProcessed };
  if (discovered !== 1 || !inboundProcessed) {
    throw new Error(
      `Unexpected ingestion summary: ${JSON.stringify(ingestSummary)}`,
    );
  }

  const { data: tickets, error: ticketError } = await userClient
    .from("tickets")
    .select(
      "id, number, category, priority, summary, shipment_references, origin, destination, deadline, ai_confidence",
    )
    .eq("organization_id", organizationId);
  if (ticketError) throw ticketError;
  const ticket = tickets?.[0];
  if (!ticket) throw new Error("No ticket was created from the inbound email");

  const references = ticket.shipment_references as Array<{ value?: string }>;
  if (!references.some((reference) => reference.value === "TCLU1234567")) {
    throw new Error("Created ticket is missing container TCLU1234567");
  }

  const { error: queueError } = await userClient.rpc("queue_ticket_reply", {
    target_ticket_id: ticket.id,
    reply_body:
      "Hi Maya,\n\nWe are checking the live container milestone and will update you shortly.\n\nRegards,\nCargo Desk",
    reply_cc: [],
  });
  if (queueError) throw queueError;

  const replySent = await runtime.deliverOneReply();
  const replySummary = { repliesSent: replySent ? 1 : 0 };
  if (!replySent) {
    throw new Error(
      `Unexpected reply summary: ${JSON.stringify(replySummary)}`,
    );
  }

  const outboundMail = await waitForMail(customerAddress);
  const outbound = await provider.fetchAndParse(outboundMail.providerMessageId);
  if (outbound.email.inReplyTo !== inboundMessageId) {
    throw new Error(
      `Reply threading mismatch: ${outbound.email.inReplyTo ?? "missing"}`,
    );
  }

  const { data: rawEmail, error: rawEmailError } = await admin.storage
    .from("cargo-email-raw")
    .download(rawObjectPath);
  if (rawEmailError) throw rawEmailError;
  if (rawEmail.size === 0) throw new Error("Stored raw MIME is empty");

  console.log(
    JSON.stringify(
      {
        onboarding: {
          organizationCreated: true,
          connectedInbox: inboxAddress,
        },
        inbound: ingestSummary,
        ticket: {
          number: ticket.number,
          category: ticket.category,
          priority: ticket.priority,
          summary: ticket.summary,
          shipmentReferences: ticket.shipment_references,
          origin: ticket.origin,
          destination: ticket.destination,
          deadline: ticket.deadline,
          aiConfidence: ticket.ai_confidence,
        },
        reply: {
          ...replySummary,
          recipient: customerAddress,
          inReplyTo: outbound.email.inReplyTo,
        },
        rawMimeStored: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (rawObjectPath) {
    await admin.storage.from("cargo-email-raw").remove([rawObjectPath]);
  }
  if (organizationId) {
    await sqlClient`
      delete from public.organizations where id = ${organizationId}
    `;
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
  await repository.close();
}
