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
  { createCargoExtractorFromEnv, createEnquiryClassifierFromEnv },
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
const outsiderUserEmail = `cargo-e2e-outsider-${marker}@skyvalence.com`;
const outsiderPassword = `${randomUUID()}Bb2!`;
const inboxAddress = `cargo-e2e-${marker}@skyvalence.local`;
const outsiderInboxAddress = `cargo-e2e-outsider-${marker}@skyvalence.local`;
const customerAddress = `maya-${marker}@northstar.example`;
const inboundMessageId = `<cargo-e2e-${marker}@northstar.example>`;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const outsiderClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const provider = createEmailProviderFromEnv();

let userId: string | null = null;
let outsiderUserId: string | null = null;
let organizationId: string | null = null;
let outsiderOrganizationId: string | null = null;
let rawObjectPath: string | null = null;
let ignoredRawObjectPath: string | null = null;
let failedRawObjectPath: string | null = null;
let repository: InstanceType<typeof PostgresWorkerRepository> | null = null;

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
    await userClient.rpc("create_workspace_v2", {
      workspace_name: "Cargo E2E Workspace",
      workspace_slug: `cargo-e2e-${marker}`,
      workspace_company_type: "freight_forwarder",
      workspace_timezone: "Asia/Kolkata",
      workspace_modes: ["air", "ocean"],
      workspace_inbox_provider: "local_mailpit",
      workspace_inbox_address: inboxAddress,
    });
  if (onboardingError) throw onboardingError;
  organizationId = createdOrganization as string;

  const { data: createdOutsider, error: createOutsiderError } =
    await admin.auth.admin.createUser({
      email: outsiderUserEmail,
      password: outsiderPassword,
      email_confirm: true,
      user_metadata: { full_name: "Cargo E2E Outsider" },
    });
  if (createOutsiderError) throw createOutsiderError;
  outsiderUserId = createdOutsider.user.id;

  const { error: outsiderSignInError } =
    await outsiderClient.auth.signInWithPassword({
      email: outsiderUserEmail,
      password: outsiderPassword,
    });
  if (outsiderSignInError) throw outsiderSignInError;

  const { data: createdOutsiderOrganization, error: outsiderOnboardingError } =
    await outsiderClient.rpc("create_workspace_v2", {
      workspace_name: "Cargo E2E Outsider Workspace",
      workspace_slug: `cargo-e2e-outsider-${marker}`,
      workspace_company_type: "broker",
      workspace_timezone: "Europe/London",
      workspace_modes: ["ocean"],
      workspace_inbox_provider: "local_mailpit",
      workspace_inbox_address: outsiderInboxAddress,
    });
  if (outsiderOnboardingError) throw outsiderOnboardingError;
  outsiderOrganizationId = createdOutsiderOrganization as string;

  const { data: inboxRows, error: inboxLookupError } = await userClient
    .from("inbox_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("address", inboxAddress);
  if (inboxLookupError) throw inboxLookupError;
  const inboxId = inboxRows?.[0]?.id;
  if (!inboxId) throw new Error("Onboarding did not create the test inbox");

  repository = new PostgresWorkerRepository(organizationId);
  const runtime = new CargoWorkerRuntime(
    repository,
    () => provider,
    createCargoExtractorFromEnv(),
    createEnquiryClassifierFromEnv(),
    new SupabaseRawEmailStore(supabaseUrl, serviceRoleKey),
    `e2e-${marker}`,
  );

  const smtp = nodemailer.createTransport({
    host: process.env.LOCAL_MAIL_SMTP_HOST ?? "127.0.0.1",
    port: Number(process.env.LOCAL_MAIL_SMTP_PORT ?? 1025),
    secure: false,
    ignoreTLS: true,
  });
  await smtp.sendMail({
    from: `Maya Chen <${customerAddress}>`,
    to: `Cargo E2E Desk <${inboxAddress}>`,
    subject: "[Cargo Demo] Ocean freight quotation SIN to RTM",
    messageId: inboundMessageId,
    text: `Hello team,

Please quote your best ocean freight rate for container TCLU1234567 moving from Singapore to Rotterdam.
The consignee needs delivery by Friday, 21 August 2026. Please include transit time, validity and applicable surcharges.

Thanks,
Maya Chen
North Star Imports`,
  });

  const inboundMail = await waitForMail(inboxAddress, marker);
  rawObjectPath = `${organizationId}/local_mailpit/${encodeURIComponent(inboundMail.providerMessageId)}.eml`;

  const { error: scanRequestError } = await userClient.rpc(
    "request_inbox_scan",
    {
      target_inbox_id: inboxId,
      requested_scope: "recent_demo",
    },
  );
  if (scanRequestError) throw scanRequestError;
  const scanResult = await runtime.processRequestedScans();
  const discovered = scanResult.discovered;
  const inboundProcessed = await runtime.processOneInbound();
  const ingestSummary = {
    scanRequested: true,
    scansProcessed: scanResult.scansProcessed,
    discovered,
    inboundProcessed,
  };
  if (
    scanResult.scansProcessed !== 1 ||
    discovered !== 1 ||
    !inboundProcessed
  ) {
    throw new Error(
      `Unexpected ingestion summary: ${JSON.stringify(ingestSummary)}`,
    );
  }

  const { error: duplicateScanRequestError } = await userClient.rpc(
    "request_inbox_scan",
    {
      target_inbox_id: inboxId,
      requested_scope: "recent_demo",
    },
  );
  if (duplicateScanRequestError) throw duplicateScanRequestError;
  const duplicateScanResult = await runtime.processRequestedScans();
  const duplicateDiscovery = duplicateScanResult.discovered;
  const duplicateProcessing = await runtime.processOneInbound();
  if (duplicateDiscovery !== 0 || duplicateProcessing) {
    throw new Error(
      `Idempotency failed: ${JSON.stringify({ duplicateDiscovery, duplicateProcessing })}`,
    );
  }

  const nonEnquiryMessageId = `<cargo-e2e-non-enquiry-${marker}@northstar.example>`;
  await smtp.sendMail({
    from: `Carrier Notifications <notifications-${marker}@carrier.example>`,
    to: `Cargo E2E Desk <${inboxAddress}>`,
    subject: "[Cargo Demo] Automated vessel schedule update",
    messageId: nonEnquiryMessageId,
    text: "Automated notification: vessel schedule updated. No reply is required.",
  });
  const nonEnquiryMail = await waitForMail(
    inboxAddress,
    `non-enquiry-${marker}`,
  );
  ignoredRawObjectPath = `${organizationId}/local_mailpit/${encodeURIComponent(nonEnquiryMail.providerMessageId)}.eml`;
  const { error: nonEnquiryScanError } = await userClient.rpc(
    "request_inbox_scan",
    {
      target_inbox_id: inboxId,
      requested_scope: "recent_demo",
    },
  );
  if (nonEnquiryScanError) throw nonEnquiryScanError;
  const nonEnquiryScan = await runtime.processRequestedScans();
  const nonEnquiryOutcome = await runtime.processOneInbound();
  if (nonEnquiryScan.discovered !== 1 || nonEnquiryOutcome !== "ignored") {
    throw new Error(
      `Non-enquiry routing failed: ${JSON.stringify({ nonEnquiryScan, nonEnquiryOutcome })}`,
    );
  }
  const [ignoredEvents, ignoredClassifications] = await Promise.all([
    sqlClient<
      Array<{ status: string; rawObjectPath: string | null }>
    >`select status, raw_object_path as "rawObjectPath"
      from public.inbound_events
      where organization_id = ${organizationId}
        and provider_event_id = ${nonEnquiryMail.providerMessageId}`,
    sqlClient<Array<{ decision: string }>>`
      select classification ->> 'decision' as decision
      from public.email_classification_runs run
      join public.inbound_events event on event.id = run.inbound_event_id
      where event.organization_id = ${organizationId}
        and event.provider_event_id = ${nonEnquiryMail.providerMessageId}
    `,
  ]);
  if (
    ignoredEvents[0]?.status !== "ignored" ||
    ignoredEvents[0]?.rawObjectPath !== ignoredRawObjectPath ||
    ignoredClassifications[0]?.decision !== "non_enquiry"
  ) {
    throw new Error("Ignored email classification provenance is incomplete");
  }

  const { data: outsiderScans, error: outsiderScanError } = await outsiderClient
    .from("inbox_scan_requests")
    .select("id")
    .eq("inbox_connection_id", inboxId);
  if (outsiderScanError) throw outsiderScanError;
  if (outsiderScans?.length) {
    throw new Error("Tenant isolation failed: outsider read inbox scans");
  }

  const { data: tickets, error: ticketError } = await userClient
    .from("tickets")
    .select(
      "id, number, category, priority, status, summary, requested_action, shipment_references, origin, destination, deadline, ai_confidence",
    )
    .eq("organization_id", organizationId);
  if (ticketError) throw ticketError;
  const ticket = tickets?.[0];
  if (!ticket) throw new Error("No ticket was created from the inbound email");

  const references = ticket.shipment_references as Array<{ value?: string }>;
  if (!references.some((reference) => reference.value === "TCLU1234567")) {
    throw new Error("Created ticket is missing container TCLU1234567");
  }

  const { data: aiRuns, error: aiRunError } = await userClient
    .from("ai_runs")
    .select("status, provider, model, prompt_version, schema_version")
    .eq("organization_id", organizationId);
  if (aiRunError) throw aiRunError;
  const aiRun = aiRuns?.[0];
  if (!aiRun || aiRun.status !== "succeeded" || aiRun.provider === "fake") {
    throw new Error(`Real AI provenance is missing: ${JSON.stringify(aiRun)}`);
  }
  const { data: classificationRuns, error: classificationRunError } =
    await userClient
      .from("email_classification_runs")
      .select(
        "status, provider, model, prompt_version, schema_version, classification",
      )
      .eq("organization_id", organizationId);
  if (classificationRunError) throw classificationRunError;
  const quoteClassification = classificationRuns?.find(
    (run) =>
      (run.classification as { decision?: string })?.decision ===
      "new_quote_enquiry",
  );
  if (
    !quoteClassification ||
    quoteClassification.status !== "succeeded" ||
    quoteClassification.provider === "fake"
  ) {
    throw new Error("Real enquiry-classification provenance is missing");
  }

  const { data: outsiderTickets, error: outsiderTicketError } =
    await outsiderClient.from("tickets").select("id").eq("id", ticket.id);
  if (outsiderTicketError) throw outsiderTicketError;
  if (outsiderTickets?.length) {
    throw new Error("Tenant isolation failed: outsider read the ticket");
  }
  const { error: outsiderMutationError } = await outsiderClient.rpc(
    "change_ticket_status",
    {
      target_ticket_id: ticket.id,
      target_status: "closed",
      change_reason: "unauthorized acceptance probe",
    },
  );
  if (!outsiderMutationError) {
    throw new Error("Tenant isolation failed: outsider changed ticket status");
  }

  const { error: statusError } = await userClient.rpc("change_ticket_status", {
    target_ticket_id: ticket.id,
    target_status: "in_progress",
    change_reason: "Acceptance operator started investigation",
  });
  if (statusError) throw statusError;

  const { error: queueError } = await userClient.rpc("queue_ticket_reply", {
    target_ticket_id: ticket.id,
    reply_body:
      "Hi Maya,\n\nWe are preparing the freight quotation and will update you shortly.\n\nRegards,\nCargo Desk",
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
  if (!outbound.email.references.includes(inboundMessageId)) {
    throw new Error(
      "Reply References header is missing the inbound Message-ID",
    );
  }

  const { data: rawEmail, error: rawEmailError } = await userClient.storage
    .from("cargo-email-raw")
    .download(rawObjectPath);
  if (rawEmailError) throw rawEmailError;
  if (rawEmail.size === 0) throw new Error("Stored raw MIME is empty");

  const { data: outsiderRawEmail, error: outsiderRawEmailError } =
    await outsiderClient.storage
      .from("cargo-email-raw")
      .download(rawObjectPath);
  if (!outsiderRawEmailError || outsiderRawEmail) {
    throw new Error("Tenant isolation failed: outsider downloaded raw MIME");
  }

  const [historyResult, auditResult, outboxResult, emailResult] =
    await Promise.all([
      userClient
        .from("ticket_status_history")
        .select("to_status, reason")
        .eq("ticket_id", ticket.id)
        .order("created_at"),
      userClient
        .from("audit_events")
        .select("event_type")
        .eq("ticket_id", ticket.id)
        .order("created_at"),
      userClient
        .from("outbox_jobs")
        .select("status, attempts")
        .eq("ticket_id", ticket.id),
      userClient
        .from("emails")
        .select("direction, delivery_status")
        .eq("organization_id", organizationId),
    ]);
  for (const result of [
    historyResult,
    auditResult,
    outboxResult,
    emailResult,
  ]) {
    if (result.error) throw result.error;
  }
  const statuses = (historyResult.data ?? []).map((row) => row.to_status);
  for (const expected of ["new", "in_progress", "waiting_on_customer"]) {
    if (!statuses.includes(expected)) {
      throw new Error(`Ticket history is missing status ${expected}`);
    }
  }
  const auditTypes = (auditResult.data ?? []).map((row) => row.event_type);
  for (const expected of [
    "email.ingested",
    "ticket.status_changed",
    "ticket.reply_queued",
    "email.sent",
  ]) {
    if (!auditTypes.includes(expected)) {
      throw new Error(`Audit trail is missing ${expected}`);
    }
  }
  const { data: workspaceAudit, error: workspaceAuditError } = await userClient
    .from("audit_events")
    .select("event_type")
    .eq("organization_id", organizationId)
    .eq("event_type", "workspace.created");
  if (workspaceAuditError) throw workspaceAuditError;
  if (workspaceAudit?.length !== 1) {
    throw new Error("Onboarding audit trail is missing workspace.created");
  }
  const { data: scanAudits, error: scanAuditError } = await userClient
    .from("audit_events")
    .select("event_type")
    .eq("organization_id", organizationId)
    .in("event_type", ["inbox.scan_requested", "inbox.scan_completed"]);
  if (scanAuditError) throw scanAuditError;
  const scanAuditTypes = (scanAudits ?? []).map((row) => row.event_type);
  for (const expected of ["inbox.scan_requested", "inbox.scan_completed"]) {
    if (!scanAuditTypes.includes(expected)) {
      throw new Error(`Inbox scan audit trail is missing ${expected}`);
    }
  }
  if (
    outboxResult.data?.length !== 1 ||
    outboxResult.data[0]?.status !== "sent"
  ) {
    throw new Error(
      `Outbox delivery was not completed: ${JSON.stringify(outboxResult.data)}`,
    );
  }
  if (
    emailResult.data?.length !== 2 ||
    !emailResult.data.some(
      (email) =>
        email.direction === "outbound" && email.delivery_status === "sent",
    )
  ) {
    throw new Error(
      `Expected exactly one inbound and one sent outbound email: ${JSON.stringify(emailResult.data)}`,
    );
  }

  const failedInboundMessageId = `<cargo-e2e-ai-failure-${marker}@northstar.example>`;
  await smtp.sendMail({
    from: `Maya Chen <${customerAddress}>`,
    to: `Cargo E2E Desk <${inboxAddress}>`,
    subject: "[Cargo Demo] Quote request AI failure acceptance probe",
    messageId: failedInboundMessageId,
    text: "Please quote ocean freight from Singapore to Rotterdam. Synthetic acceptance probe for an unavailable extraction provider.",
  });
  const failedInboundMail = await waitForMail(
    inboxAddress,
    `ai-failure-${marker}`,
  );
  failedRawObjectPath = `${organizationId}/local_mailpit/${encodeURIComponent(failedInboundMail.providerMessageId)}.eml`;
  const { error: failureScanRequestError } = await userClient.rpc(
    "request_inbox_scan",
    {
      target_inbox_id: inboxId,
      requested_scope: "recent_demo",
    },
  );
  if (failureScanRequestError) throw failureScanRequestError;
  const failureScanResult = await runtime.processRequestedScans();
  const failureDiscovery = failureScanResult.discovered;
  if (failureDiscovery !== 1) {
    throw new Error(`Expected one AI failure probe, found ${failureDiscovery}`);
  }

  const expectedAiFailure = "Synthetic AI outage acceptance probe";
  const acceptingTestClassifier = {
    async classify() {
      return {
        classification: {
          decision: "new_quote_enquiry" as const,
          reason: "Synthetic extraction-failure test quote.",
          evidence: ["Please quote"],
          confidence: 0.99,
        },
        provider: "acceptance-fixture",
        model: "deterministic-test-only",
        promptVersion: "test-only",
        schemaVersion: "test-only",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  const failingAiRuntime = new CargoWorkerRuntime(
    repository,
    () => provider,
    {
      async extract() {
        throw new Error(expectedAiFailure);
      },
    },
    acceptingTestClassifier,
    new SupabaseRawEmailStore(supabaseUrl, serviceRoleKey),
    `e2e-ai-failure-${marker}`,
  );
  const inboundRetryStates: Array<{ attempts: number; status: string }> = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await sqlClient`
      update public.inbound_events
      set available_at = now()
      where organization_id = ${organizationId}
        and provider_event_id = ${failedInboundMail.providerMessageId}
    `;
    try {
      await failingAiRuntime.processOneInbound();
      throw new Error(
        `AI failure probe unexpectedly passed on attempt ${attempt}`,
      );
    } catch (cause) {
      if (!(cause instanceof Error) || cause.message !== expectedAiFailure) {
        throw cause;
      }
    }
    const failureRows = await sqlClient<
      Array<{ attempts: number; status: string; lastError: string | null }>
    >`
      select attempts, status, last_error as "lastError"
      from public.inbound_events
      where organization_id = ${organizationId}
        and provider_event_id = ${failedInboundMail.providerMessageId}
    `;
    const failureRow = failureRows[0];
    if (!failureRow || failureRow.attempts !== attempt) {
      throw new Error(
        `Inbound retry attempt ${attempt} was not recorded: ${JSON.stringify(failureRow)}`,
      );
    }
    if (failureRow.lastError !== expectedAiFailure) {
      throw new Error("Inbound retry did not retain the safe AI error");
    }
    inboundRetryStates.push({
      attempts: failureRow.attempts,
      status: failureRow.status,
    });
  }
  if (
    inboundRetryStates.at(-1)?.status !== "dead_letter" ||
    (await failingAiRuntime.processOneInbound())
  ) {
    throw new Error(
      `AI failure did not become terminal: ${JSON.stringify(inboundRetryStates)}`,
    );
  }

  const { data: failedOutboxId, error: failedQueueError } =
    await userClient.rpc("queue_ticket_reply", {
      target_ticket_id: ticket.id,
      reply_body: "Synthetic SMTP failure acceptance probe.",
      reply_cc: [],
    });
  if (failedQueueError) throw failedQueueError;
  const expectedSmtpFailure = "Synthetic SMTP outage acceptance probe";
  const failingSmtpRuntime = new CargoWorkerRuntime(
    repository,
    () => ({
      listMessages: (limit, options) => provider.listMessages(limit, options),
      fetchAndParse: (providerMessageId) =>
        provider.fetchAndParse(providerMessageId),
      async sendReply() {
        throw new Error(expectedSmtpFailure);
      },
    }),
    createCargoExtractorFromEnv(),
    createEnquiryClassifierFromEnv(),
    new SupabaseRawEmailStore(supabaseUrl, serviceRoleKey),
    `e2e-smtp-failure-${marker}`,
  );
  const outboxRetryStates: Array<{ attempts: number; status: string }> = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await sqlClient`
      update public.outbox_jobs
      set available_at = now()
      where id = ${failedOutboxId as string}
    `;
    try {
      await failingSmtpRuntime.deliverOneReply();
      throw new Error(
        `SMTP failure probe unexpectedly passed on attempt ${attempt}`,
      );
    } catch (cause) {
      if (!(cause instanceof Error) || cause.message !== expectedSmtpFailure) {
        throw cause;
      }
    }
    const failureRows = await sqlClient<
      Array<{
        attempts: number;
        status: string;
        lastError: string | null;
      }>
    >`
      select attempts, status, last_error as "lastError"
      from public.outbox_jobs
      where id = ${failedOutboxId as string}
    `;
    const failureRow = failureRows[0];
    if (!failureRow || failureRow.attempts !== attempt) {
      throw new Error(`Outbox retry attempt ${attempt} was not recorded`);
    }
    if (failureRow.lastError !== expectedSmtpFailure) {
      throw new Error("Outbox retry did not retain the safe SMTP error");
    }
    outboxRetryStates.push({
      attempts: failureRow.attempts,
      status: failureRow.status,
    });
  }
  if (
    outboxRetryStates.at(-1)?.status !== "failed" ||
    (await failingSmtpRuntime.deliverOneReply())
  ) {
    throw new Error(
      `SMTP failure did not become terminal: ${JSON.stringify(outboxRetryStates)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        onboarding: {
          organizationCreated: true,
          connectedInbox: inboxAddress,
          secondTenantCreated: true,
          tenantIsolationVerified: true,
        },
        inbound: {
          ...ingestSummary,
          duplicateDiscovery,
          duplicateProcessing,
          nonEnquiryIgnored: true,
        },
        ai: { extraction: aiRun, classification: quoteClassification },
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
        rawMimeTenantPrivate: true,
        ticketStatusHistory: statuses,
        auditTrail: ["workspace.created", ...scanAuditTypes, ...auditTypes],
        failureHandling: {
          aiInboundRetries: inboundRetryStates,
          aiInboundTerminalStatus: "dead_letter",
          smtpOutboxRetries: outboxRetryStates,
          smtpOutboxTerminal: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (rawObjectPath) {
    await admin.storage.from("cargo-email-raw").remove([rawObjectPath]);
  }
  if (ignoredRawObjectPath) {
    await admin.storage.from("cargo-email-raw").remove([ignoredRawObjectPath]);
  }
  if (failedRawObjectPath) {
    await admin.storage.from("cargo-email-raw").remove([failedRawObjectPath]);
  }
  if (organizationId) {
    await sqlClient`
      delete from public.organizations where id = ${organizationId}
    `;
  }
  if (outsiderOrganizationId) {
    await sqlClient`
      delete from public.organizations where id = ${outsiderOrganizationId}
    `;
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (outsiderUserId) await admin.auth.admin.deleteUser(outsiderUserId);
  if (repository) await repository.close();
  else await sqlClient.end();
}
