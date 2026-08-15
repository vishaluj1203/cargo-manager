import { inboundEmailSchema } from "@/lib/email";
import { createTicketFromEmail } from "@/lib/tickets";

export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.INBOUND_WEBHOOK_SECRET}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inboundEmailSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid inbound email", details: parsed.error.flatten() }, { status: 400 });
  try {
    const ticket = await createTicketFromEmail(parsed.data);
    return Response.json({ accepted: true, ticket: { id: ticket.id, number: ticket.number } }, { status: 201 });
  } catch (error) {
    console.error("inbound email processing failed", error);
    return Response.json({ error: "Could not process inbound email" }, { status: 500 });
  }
}
