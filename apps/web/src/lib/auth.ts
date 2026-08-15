import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  };
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}

export async function getCurrentWorkspace() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "organization_id, role, organizations(id, name, slug, company_type, timezone, modes)",
    )
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Unable to load workspace: ${error.message}`);
  return data;
}

export async function requireCurrentWorkspace() {
  await requireAuthenticatedUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  return workspace;
}
