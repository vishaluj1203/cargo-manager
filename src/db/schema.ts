import { pgEnum, pgTable, text, timestamp, uuid, jsonb, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

export const ticketStatus = pgEnum("ticket_status", ["open", "in_progress", "waiting_on_customer", "resolved", "closed"]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const deliveryStatus = pgEnum("delivery_status", ["queued", "sent", "failed"]);

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(), email: text("email").notNull(), name: text("name"), company: text("company"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (t) => ({ emailIdx: uniqueIndex("contacts_email_idx").on(t.email) }));

export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(), number: text("number").notNull(), subject: text("subject").notNull(), summary: text("summary"), category: text("category"), status: ticketStatus("status").default("open").notNull(), priority: ticketPriority("priority").default("normal").notNull(), contactId: uuid("contact_id").references(() => contacts.id), assignee: text("assignee"), tags: jsonb("tags").$type<string[]>().default([]).notNull(), aiExtraction: jsonb("ai_extraction").$type<Record<string, unknown>>(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull()
}, (t) => ({ numberIdx: uniqueIndex("tickets_number_idx").on(t.number), statusIdx: index("tickets_status_idx").on(t.status), activityIdx: index("tickets_activity_idx").on(t.lastActivityAt) }));

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(), ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(), direction: messageDirection("direction").notNull(), fromEmail: text("from_email").notNull(), toEmail: text("to_email").notNull(), subject: text("subject").notNull(), bodyText: text("body_text").notNull(), bodyHtml: text("body_html"), providerMessageId: text("provider_message_id"), inReplyTo: text("in_reply_to"), delivery: deliveryStatus("delivery").default("queued").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (t) => ({ providerIdx: uniqueIndex("messages_provider_id_idx").on(t.providerMessageId), ticketIdx: index("messages_ticket_idx").on(t.ticketId, t.createdAt) }));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(), ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(), actor: text("actor").notNull(), eventType: text("event_type").notNull(), data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (t) => ({ ticketIdx: index("audit_ticket_idx").on(t.ticketId, t.createdAt) }));

export const inboundEvents = pgTable("inbound_events", {
  id: uuid("id").defaultRandom().primaryKey(), providerMessageId: text("provider_message_id").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), processed: boolean("processed").default(false).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (t) => ({ providerIdx: uniqueIndex("inbound_provider_id_idx").on(t.providerMessageId) }));
