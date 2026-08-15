import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, messages, tickets, auditEvents } from "@/db/schema";
import { InboundEmail, normalizeSubject, ticketNumber } from "./email";

export async function createTicketFromEmail(email: InboundEmail) {
  return db.transaction(async (tx) => {
    const [contact] = await tx.insert(contacts).values({ email: email.from }).onConflictDoUpdate({ target: contacts.email, set: { updatedAt: new Date() } }).returning();
    const [{ value }] = await tx.select({ value: count(tickets.id) }).from(tickets);
    const [ticket] = await tx.insert(tickets).values({ number: ticketNumber(Number(value) + 1), subject: normalizeSubject(email.subject), contactId: contact.id }).returning();
    await tx.insert(messages).values({ ticketId: ticket.id, direction: "inbound", fromEmail: email.from, toEmail: String(email.to), subject: email.subject, bodyText: email.text, bodyHtml: email.html, providerMessageId: email.messageId, inReplyTo: email.inReplyTo, delivery: "sent", receivedAt: email.receivedAt });
    await tx.insert(auditEvents).values({ ticketId: ticket.id, actor: "system", eventType: "ticket.created", data: { source: "email", messageId: email.messageId } });
    return ticket;
  });
}

export async function listTickets() { return db.select().from(tickets).orderBy(desc(tickets.lastActivityAt)).limit(100); }
export async function getTicket(id: string) { const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)); return ticket; }
