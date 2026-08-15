import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, messages, tickets, auditEvents } from "@/db/schema";
import { InboundEmail, normalizeSubject, ticketNumber } from "./email";
import { parseCargoEmail } from "./ai-parser";

export async function createTicketFromEmail(email: InboundEmail) {
  const [duplicate] = await db.select({ ticket: tickets }).from(messages).innerJoin(tickets, eq(messages.ticketId, tickets.id)).where(eq(messages.providerMessageId, email.messageId));
  if (duplicate) return duplicate.ticket;
  const extraction = await parseCargoEmail(email);
  return db.transaction(async (tx) => {
    if (email.inReplyTo) {
      const [parent] = await tx.select({ ticketId: messages.ticketId }).from(messages).where(eq(messages.providerMessageId, email.inReplyTo));
      if (parent) {
        const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, parent.ticketId));
        if (!ticket) throw new Error("Parent ticket not found");
        await tx.insert(messages).values({ ticketId: ticket.id, direction: "inbound", fromEmail: email.from, toEmail: String(email.to), subject: email.subject, bodyText: email.text, bodyHtml: email.html, providerMessageId: email.messageId, inReplyTo: email.inReplyTo, delivery: "sent", receivedAt: email.receivedAt });
        await tx.update(tickets).set({ status: "in_progress", lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
        await tx.insert(auditEvents).values({ ticketId: ticket.id, actor: "system", eventType: "message.received", data: { source: "email", messageId: email.messageId, matchedBy: "in_reply_to" } });
        return ticket;
      }
    }
    const [contact] = await tx.insert(contacts).values({ email: email.from, name: extraction.customerName, company: extraction.company }).onConflictDoUpdate({ target: contacts.email, set: { name: extraction.customerName, company: extraction.company, updatedAt: new Date() } }).returning();
    const [{ value }] = await tx.select({ value: count(tickets.id) }).from(tickets);
    const [ticket] = await tx.insert(tickets).values({ number: ticketNumber(Number(value) + 1), subject: normalizeSubject(email.subject), summary: extraction.summary, category: extraction.category, priority: extraction.priority, contactId: contact.id, aiExtraction: extraction }).returning();
    await tx.insert(messages).values({ ticketId: ticket.id, direction: "inbound", fromEmail: email.from, toEmail: String(email.to), subject: email.subject, bodyText: email.text, bodyHtml: email.html, providerMessageId: email.messageId, inReplyTo: email.inReplyTo, delivery: "sent", receivedAt: email.receivedAt });
    await tx.insert(auditEvents).values({ ticketId: ticket.id, actor: "system", eventType: "ticket.created", data: { source: "email", messageId: email.messageId } });
    return ticket;
  });
}

export async function listTickets() { return db.select().from(tickets).orderBy(desc(tickets.lastActivityAt)).limit(100); }
export async function getTicket(id: string) { const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)); return ticket; }
