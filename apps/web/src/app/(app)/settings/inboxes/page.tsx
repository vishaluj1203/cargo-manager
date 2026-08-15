import { CheckCircle2, Mail, PlugZap, ShieldCheck } from "lucide-react";

import { requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { disconnectGmail } from "./actions";

type Inbox = {
  id: string;
  provider: string;
  address: string;
  status: string;
  last_synced_at: string | null;
};

const messages: Record<string, string> = {
  permission: "Only workspace owners and admins can change inbox connections.",
  google_denied: "Google access was cancelled. Nothing was connected.",
  invalid_callback: "The Google connection expired. Please try again.",
  invalid_state:
    "The Google connection could not be verified. Please try again.",
  missing_refresh_token:
    "Google did not issue offline access. Reconnect and approve access.",
  connection_failed:
    "Gmail could not be connected. Check the OAuth configuration and try again.",
};

export default async function InboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const membership = await requireCurrentWorkspace();
  const query = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbox_connections")
    .select("id, provider, address, status, last_synced_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at");
  if (error) throw new Error(error.message);
  const inboxes = (data ?? []) as Inbox[];
  const canManage = ["owner", "admin"].includes(membership.role);

  return (
    <div className="content settings-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings · inboxes</p>
          <h1>Connect your operations inbox</h1>
          <p>
            Cargo Manager reads incoming cargo requests and sends ticket replies
            through the same mailbox.
          </p>
        </div>
      </div>

      {query.connected ? (
        <div className="message message-success">
          Gmail connected for {query.connected}. The worker can now ingest and
          reply.
        </div>
      ) : null}
      {query.error ? (
        <div className="message message-error">
          {messages[query.error] ??
            "The inbox connection could not be completed."}
        </div>
      ) : null}

      <section className="panel settings-panel">
        <div className="settings-intro">
          <span className="settings-icon">
            <Mail size={22} />
          </span>
          <div>
            <h2>Google Workspace / Gmail</h2>
            <p>
              Connect with Google OAuth. Your Google password is never shared;
              the offline token is encrypted before storage.
            </p>
          </div>
          {canManage ? (
            <a
              className="button button-primary"
              href="/api/inboxes/google/start"
            >
              <PlugZap size={16} /> Connect Gmail
            </a>
          ) : null}
        </div>
        <div className="security-note">
          <ShieldCheck size={17} /> Access is limited to reading mail and
          sending replies. Cargo Manager cannot change your mailbox settings.
        </div>
      </section>

      <section className="panel settings-panel">
        <h2>Workspace inboxes</h2>
        <div className="inbox-list">
          {inboxes.map((inbox) => (
            <article className="inbox-row" key={inbox.id}>
              <div>
                <strong>{inbox.address}</strong>
                <span>{inbox.provider.replaceAll("_", " ")}</span>
              </div>
              <span className={`connection-state connection-${inbox.status}`}>
                {inbox.status === "connected" ? (
                  <CheckCircle2 size={15} />
                ) : null}
                {inbox.status}
              </span>
              {canManage &&
              inbox.provider === "gmail" &&
              inbox.status === "connected" ? (
                <form action={disconnectGmail.bind(null, inbox.id)}>
                  <button
                    className="button button-secondary button-small"
                    type="submit"
                  >
                    Disconnect
                  </button>
                </form>
              ) : null}
            </article>
          ))}
          {!inboxes.length ? (
            <div className="empty">No inbox connected yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
