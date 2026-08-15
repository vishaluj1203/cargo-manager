"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

function redirectWithMessage(
  kind: "error" | "message",
  message: string,
): never {
  redirect(`/login?${kind}=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success)
    redirectWithMessage("error", "Enter a valid email and password.");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirectWithMessage("error", error.message);
  redirect("/");
}

export async function signUp(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success)
    redirectWithMessage(
      "error",
      "Use a valid email and at least 8 characters.",
    );

  const fullName = String(formData.get("fullName") ?? "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      data: { full_name: fullName || null },
      emailRedirectTo: `${process.env.APP_URL ?? "http://localhost:3000"}/auth/confirm`,
    },
  });
  if (error) redirectWithMessage("error", error.message);
  if (!data.session) {
    redirectWithMessage(
      "message",
      "Check your inbox to confirm your account, then sign in.",
    );
  }
  redirect("/onboarding");
}
