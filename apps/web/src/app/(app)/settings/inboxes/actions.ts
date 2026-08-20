"use server";

import { enquiryDetectionPolicySchema } from "@cargo/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

export async function requestInboxScan(inboxId: string, formData: FormData) {
  await requireCurrentWorkspace();
  const scope = String(formData.get("scope") ?? "");
  if (scope !== "recent_demo" && scope !== "all_demo") {
    throw new Error("Choose a valid inbox scan scope");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_inbox_scan", {
    target_inbox_id: inboxId,
    requested_scope: scope,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
  redirect("/settings/inboxes?scan=queued");
}

export async function updateEnquiryPolicy(inboxId: string, formData: FormData) {
  await requireCurrentWorkspace();
  const minimumConfidencePercent = Number(
    formData.get("minimumConfidencePercent"),
  );
  const policy = enquiryDetectionPolicySchema.safeParse({
    minimumConfidence: minimumConfidencePercent / 100,
    acceptExistingQuoteFollowUps:
      formData.get("acceptExistingQuoteFollowUps") === "on",
    uncertainAction: formData.get("uncertainAction"),
  });
  if (!policy.success) throw new Error("Choose a valid enquiry policy");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_inbox_enquiry_policy", {
    target_inbox_id: inboxId,
    minimum_confidence: policy.data.minimumConfidence,
    accept_existing_quote_follow_ups: policy.data.acceptExistingQuoteFollowUps,
    uncertain_action: policy.data.uncertainAction,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
  redirect("/settings/inboxes?policy=saved");
}
