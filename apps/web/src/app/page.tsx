import { redirect } from "next/navigation";

import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/auth";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace();
  redirect(workspace ? "/tickets" : "/onboarding");
}
