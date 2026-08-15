"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function disconnectGmail(inboxId: string) {
  await requireCurrentWorkspace();
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_gmail_inbox", {
    target_inbox_id: inboxId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}
