"use server";

import { createWorkspaceSchema } from "@cargo/contracts";
import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function slugify(name: string): string {
  const stem = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${stem || "workspace"}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function createWorkspace(formData: FormData) {
  await requireAuthenticatedUser();
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    companyType: formData.get("companyType"),
    timezone: formData.get("timezone"),
    modes: formData.getAll("modes"),
  });
  if (!parsed.success) {
    redirect(
      `/onboarding?error=${encodeURIComponent("Complete all required company details.")}`,
    );
  }

  const supabase = await createClient();
  const inboxAddress =
    process.env.LOCAL_INBOX_ADDRESS ?? "cargo@skyvalence.local";
  const { error } = await supabase.rpc("create_workspace", {
    workspace_name: parsed.data.name,
    workspace_slug: slugify(parsed.data.name),
    workspace_company_type: parsed.data.companyType,
    workspace_timezone: parsed.data.timezone,
    workspace_modes: parsed.data.modes,
    workspace_inbox_address: inboxAddress,
  });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  redirect("/tickets");
}
