"use server";

import { replyDraftSchema, ticketStatusSchema } from "@cargo/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changeTicketStatus(ticketId: string, formData: FormData) {
  await requireAuthenticatedUser();
  const status = ticketStatusSchema.safeParse(formData.get("status"));
  if (!status.success) throw new Error("Invalid ticket status");
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_ticket_status", {
    target_ticket_id: ticketId,
    target_status: status.data,
    change_reason: String(formData.get("reason") ?? "") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function queueReply(ticketId: string, formData: FormData) {
  await requireAuthenticatedUser();
  const cc = String(formData.get("cc") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const reply = replyDraftSchema.safeParse({
    bodyText: formData.get("bodyText"),
    cc,
  });
  if (!reply.success)
    throw new Error("Enter a reply and use valid comma-separated CC addresses");

  const supabase = await createClient();
  const { error } = await supabase.rpc("queue_ticket_reply", {
    target_ticket_id: ticketId,
    reply_body: reply.data.bodyText,
    reply_cc: reply.data.cc,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}
