import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, contacts, messages, tickets } from "@/db/schema";

const replySchema = z.object({ bodyText: z.string().min(1), bodyHtml: z.string().optional(), actor: z.string().min(1), fromEmail: z.string().email() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = replySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid reply", details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const [ticket] = await db.select({ id: tickets.id, subject: tickets.subject, contactEmail: contacts.email }).from(tickets).innerJoin(contacts, eq(tickets.contactId, contacts.id)).where(eq(tickets.id, id));
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const [message] = await db.insert(messages).values({ ticketId: id, direction: "outbound", fromEmail: parsed.data.fromEmail, toEmail: ticket.contactEmail, subject: `Re: ${ticket.subject}`, bodyText: parsed.data.bodyText, bodyHtml: parsed.data.bodyHtml, delivery: "queued" }).returning();
  await db.update(tickets).set({ status: "waiting_on_customer", lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(tickets.id, id));
  await db.insert(auditEvents).values({ ticketId: id, actor: parsed.data.actor, eventType: "message.queued", data: { messageId: message.id } });
  return Response.json({ queued: true, messageId: message.id, recipient: ticket.contactEmail }, { status: 201 });
}
