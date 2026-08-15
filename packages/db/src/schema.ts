import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const companyTypeEnum = pgEnum("company_type", [
  "freight_forwarder",
  "broker",
  "operator",
  "other",
]);
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "manager",
  "operator",
  "viewer",
]);
export const inboxProviderEnum = pgEnum("inbox_provider", [
  "local_mailpit",
  "gmail",
  "microsoft",
]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "pending",
  "connected",
  "degraded",
  "disconnected",
]);
export const inboundStatusEnum = pgEnum("inbound_status", [
  "pending",
  "processing",
  "processed",
  "failed",
  "dead_letter",
]);
export const emailDirectionEnum = pgEnum("email_direction", [
  "inbound",
  "outbound",
]);
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "received",
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "bounced",
]);
export const ticketStatusEnum = pgEnum("ticket_status", [
  "new",
  "needs_verification",
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "booking",
  "documentation",
  "shipment_status",
  "delay_exception",
  "customs_hold",
  "pickup_delivery",
  "billing",
  "damage_claim",
  "other",
]);
export const aiRunStatusEnum = pgEnum("ai_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "sent",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  ...timestamps,
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    companyType: companyTypeEnum("company_type").notNull(),
    timezone: text("timezone").notNull(),
    modes: text("modes").array().default(sql.raw("ARRAY[]::text[]")).notNull(),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").default("operator").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_members_user_idx").on(table.userId),
  ],
);

export const inboxConnections = pgTable(
  "inbox_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: inboxProviderEnum("provider").notNull(),
    address: text("address").notNull(),
    status: connectionStatusEnum("status").default("pending").notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("inbox_connections_org_address_idx").on(
      table.organizationId,
      table.address,
    ),
    index("inbox_connections_status_idx").on(table.status),
  ],
);

export const mailboxCursors = pgTable("mailbox_cursors", {
  inboxConnectionId: uuid("inbox_connection_id")
    .primaryKey()
    .references(() => inboxConnections.id, { onDelete: "cascade" }),
  cursor: text("cursor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const inboxCredentials = pgTable("inbox_credentials", {
  inboxConnectionId: uuid("inbox_connection_id")
    .primaryKey()
    .references(() => inboxConnections.id, { onDelete: "cascade" }),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  grantedScopes: text("granted_scopes")
    .array()
    .default(sql.raw("ARRAY[]::text[]"))
    .notNull(),
  tokenVersion: integer("token_version").default(1).notNull(),
  ...timestamps,
});

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inboxConnectionId: uuid("inbox_connection_id")
      .notNull()
      .references(() => inboxConnections.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: inboundStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("inbound_events_provider_idx").on(
      table.organizationId,
      table.inboxConnectionId,
      table.providerEventId,
    ),
    index("inbound_events_queue_idx").on(table.status, table.availableAt),
  ],
);

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerThreadId: text("provider_thread_id"),
    normalizedSubject: text("normalized_subject").notNull(),
    summary: text("summary"),
    ...timestamps,
  },
  (table) => [
    index("email_threads_org_idx").on(table.organizationId, table.updatedAt),
    uniqueIndex("email_threads_provider_idx").on(
      table.organizationId,
      table.providerThreadId,
    ),
  ],
);

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    inboundEventId: uuid("inbound_event_id").references(
      () => inboundEvents.id,
      {
        onDelete: "set null",
      },
    ),
    direction: emailDirectionEnum("direction").notNull(),
    provider: inboxProviderEnum("provider").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    rfcMessageId: text("rfc_message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    references: text("references")
      .array()
      .default(sql.raw("ARRAY[]::text[]"))
      .notNull(),
    fromName: text("from_name"),
    fromAddress: text("from_address").notNull(),
    toRecipients: jsonb("to_recipients")
      .$type<Array<{ name: string | null; address: string }>>()
      .default([])
      .notNull(),
    ccRecipients: jsonb("cc_recipients")
      .$type<Array<{ name: string | null; address: string }>>()
      .default([])
      .notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    rawObjectPath: text("raw_object_path"),
    deliveryStatus: deliveryStatusEnum("delivery_status").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("emails_provider_message_idx").on(
      table.organizationId,
      table.provider,
      table.providerMessageId,
    ),
    uniqueIndex("emails_rfc_message_idx").on(
      table.organizationId,
      table.rfcMessageId,
    ),
    index("emails_thread_idx").on(table.threadId, table.createdAt),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    company: text("company"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contacts_org_email_idx").on(table.organizationId, table.email),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number")
      .default(
        sql.raw("'CAR-' || lpad(nextval('ticket_number_seq')::text, 6, '0')"),
      )
      .notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "restrict" }),
    subject: text("subject").notNull(),
    summary: text("summary").notNull(),
    category: ticketCategoryEnum("category").notNull(),
    priority: ticketPriorityEnum("priority").default("normal").notNull(),
    status: ticketStatusEnum("status").default("new").notNull(),
    requestedAction: text("requested_action").notNull(),
    origin: text("origin"),
    destination: text("destination"),
    deadline: timestamp("deadline", { withTimezone: true }),
    shipmentReferences: jsonb("shipment_references")
      .$type<Array<{ type: string; value: string; evidence: string }>>()
      .default([])
      .notNull(),
    missingInformation: text("missing_information")
      .array()
      .default(sql.raw("ARRAY[]::text[]"))
      .notNull(),
    aiConfidence: real("ai_confidence"),
    assigneeUserId: uuid("assignee_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tickets_number_idx").on(table.number),
    uniqueIndex("tickets_thread_idx").on(table.organizationId, table.threadId),
    index("tickets_queue_idx").on(
      table.organizationId,
      table.status,
      table.lastActivityAt,
    ),
    index("tickets_priority_idx").on(table.organizationId, table.priority),
  ],
);

export const ticketEmails = pgTable(
  "ticket_emails",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    emailId: uuid("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.ticketId, table.emailId] })],
);

export const ticketStatusHistory = pgTable(
  "ticket_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    fromStatus: ticketStatusEnum("from_status"),
    toStatus: ticketStatusEnum("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ticket_status_history_ticket_idx").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    emailId: uuid("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    status: aiRunStatusEnum("status").default("pending").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    extraction: jsonb("extraction").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ai_runs_email_idx").on(table.emailId, table.createdAt)],
);

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    emailId: uuid("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: outboxStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    inboxConnectionId: uuid("inbox_connection_id").references(
      () => inboxConnections.id,
      { onDelete: "restrict" },
    ),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("outbox_jobs_idempotency_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("outbox_jobs_queue_idx").on(table.status, table.availableAt),
    index("outbox_jobs_inbox_idx").on(table.inboxConnectionId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_org_idx").on(table.organizationId, table.createdAt),
    index("audit_events_ticket_idx").on(table.ticketId, table.createdAt),
  ],
);
