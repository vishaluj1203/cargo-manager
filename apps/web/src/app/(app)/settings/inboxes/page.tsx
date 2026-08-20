import {
  defaultEnquiryDetectionPolicy,
  enquiryDetectionPolicySchema,
} from "@cargo/contracts";
import {
  CheckCircle2,
  History,
  Mail,
  PlugZap,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  disconnectGmail,
  requestInboxScan,
  updateEnquiryPolicy,
} from "./actions";

type Inbox = {
  id: string;
  provider: string;
  address: string;
  status: string;
  last_synced_at: string | null;
  config: Record<string, unknown>;
};

type InboxScan = {
  id: string;
  inbox_connection_id: string;
  scope: "recent_demo" | "all_demo";
  status: "pending" | "processing" | "retrying" | "completed" | "failed";
  discovered_count: number;
  created_at: string;
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
  searchParams: Promise<{
    connected?: string;
    error?: string;
    scan?: string;
    policy?: string;
  }>;
}) {
  const membership = await requireCurrentWorkspace();
  const query = await searchParams;
  const supabase = await createClient();
  const [inboxResult, scanResult] = await Promise.all([
    supabase
      .from("inbox_connections")
      .select("id, provider, address, status, last_synced_at, config")
      .eq("organization_id", membership.organization_id)
      .order("created_at"),
    supabase
      .from("inbox_scan_requests")
      .select(
        "id, inbox_connection_id, scope, status, discovered_count, created_at",
      )
      .eq("organization_id", membership.organization_id)
      .order("created_at", { ascending: false }),
  ]);
  if (inboxResult.error) throw new Error(inboxResult.error.message);
  if (scanResult.error) throw new Error(scanResult.error.message);
  const inboxes = (inboxResult.data ?? []) as Inbox[];
  const latestScanByInbox = new Map<string, InboxScan>();
  for (const scan of (scanResult.data ?? []) as InboxScan[]) {
    if (!latestScanByInbox.has(scan.inbox_connection_id)) {
      latestScanByInbox.set(scan.inbox_connection_id, scan);
    }
  }
  const canManage = ["owner", "admin"].includes(membership.role);
  const canScan = membership.role !== "viewer";
  const hasConnectedGmail = inboxes.some(
    (inbox) => inbox.provider === "gmail" && inbox.status === "connected",
  );

  return (
    <div className="content settings-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings · inboxes</p>
          <h1>Connect your operations inbox</h1>
          <p>
            New cargo emails are detected automatically. Existing mailbox
            history is read only when a workspace user requests a scan.
          </p>
        </div>
      </div>

      {query.connected ? (
        <div className="message message-success">
          Gmail connected for {query.connected}. The worker can now ingest and
          reply without importing existing mailbox history.
        </div>
      ) : null}
      {query.scan === "queued" ? (
        <div className="message message-success">
          Inbox scan requested. Progress will appear below; submitting again
          while it runs will not create a duplicate request.
        </div>
      ) : null}
      {query.policy === "saved" ? (
        <div className="message message-success">
          Enquiry detection policy saved. New messages will use it on the next
          worker run.
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
          {canManage && !hasConnectedGmail ? (
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
          sending replies. Existing mail is scanned only after an explicit
          request; automatic discovery starts from the connection baseline.
        </div>
      </section>

      <section className="panel settings-panel">
        <h2>Workspace inboxes</h2>
        <div className="inbox-list">
          {inboxes.map((inbox) => {
            const latestScan = latestScanByInbox.get(inbox.id);
            const configuredPolicy = enquiryDetectionPolicySchema.safeParse(
              inbox.config?.enquiryDetection,
            );
            const policy = configuredPolicy.success
              ? configuredPolicy.data
              : defaultEnquiryDetectionPolicy;
            return (
              <article className="inbox-card" key={inbox.id}>
                <header className="inbox-card-header">
                  <div className="inbox-title">
                    <span className="inbox-avatar">
                      <Mail size={19} />
                    </span>
                    <div>
                      <strong>{inbox.address}</strong>
                      <span>{inbox.provider.replaceAll("_", " ")}</span>
                    </div>
                  </div>
                  <div className="inbox-header-actions">
                    <span
                      className={`connection-state connection-${inbox.status}`}
                    >
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
                          className="button button-quiet button-small"
                          type="submit"
                        >
                          Disconnect
                        </button>
                      </form>
                    ) : null}
                  </div>
                </header>

                <div className="inbox-auto-status">
                  <span className="inbox-detail-icon">
                    <RefreshCw size={17} />
                  </span>
                  <div>
                    <strong>New emails scan automatically</strong>
                    <p>
                      Cargo Manager checks for messages arriving after this
                      inbox was connected.
                    </p>
                  </div>
                  <span className="inbox-baseline">
                    {inbox.last_synced_at
                      ? `Active since ${new Date(inbox.last_synced_at).toLocaleString("en-GB")}`
                      : "Starts after connection"}
                  </span>
                </div>

                <div className="inbox-policy-panel">
                  <div className="inbox-policy-copy">
                    <span className="inbox-detail-icon">
                      <SlidersHorizontal size={17} />
                    </span>
                    <div>
                      <h3>Quote enquiry detection</h3>
                      <p>
                        AI creates tickets only for freight quotation enquiries.
                        Confident non-enquiries are retained privately and
                        ignored without creating ticket noise.
                      </p>
                    </div>
                  </div>
                  {canManage ? (
                    <form
                      action={updateEnquiryPolicy.bind(null, inbox.id)}
                      className="inbox-policy-form"
                    >
                      <label htmlFor={`confidence-${inbox.id}`}>
                        Minimum confidence
                      </label>
                      <div className="inbox-policy-controls">
                        <input
                          className="input"
                          defaultValue={Math.round(
                            policy.minimumConfidence * 100,
                          )}
                          id={`confidence-${inbox.id}`}
                          max="99"
                          min="50"
                          name="minimumConfidencePercent"
                          required
                          type="number"
                        />
                        <span>%</span>
                        <select
                          className="select"
                          defaultValue={policy.uncertainAction}
                          name="uncertainAction"
                        >
                          <option value="review">Review uncertain mail</option>
                          <option value="ignore">Ignore uncertain mail</option>
                        </select>
                      </div>
                      <label className="inbox-policy-check">
                        <input
                          defaultChecked={policy.acceptExistingQuoteFollowUps}
                          name="acceptExistingQuoteFollowUps"
                          type="checkbox"
                        />
                        Accept existing quote follow-ups
                      </label>
                      <button
                        className="button button-secondary button-small"
                        type="submit"
                      >
                        Save policy
                      </button>
                    </form>
                  ) : (
                    <span className="quiet">
                      {Math.round(policy.minimumConfidence * 100)}% minimum ·
                      uncertain mail{" "}
                      {policy.uncertainAction === "review"
                        ? "sent to review"
                        : "ignored"}
                    </span>
                  )}
                </div>

                {canScan && inbox.status === "connected" ? (
                  <div className="inbox-history-panel">
                    <div className="inbox-history-copy">
                      <span className="inbox-detail-icon">
                        <History size={17} />
                      </span>
                      <div>
                        <h3>Scan existing emails</h3>
                        <p>
                          History is never imported automatically. Choose a
                          range, then start the scan when you are ready.
                        </p>
                        {latestScan ? (
                          <span className="inbox-scan-result">
                            Last request:{" "}
                            {latestScan.status.replaceAll("_", " ")}
                            {latestScan.status === "completed"
                              ? ` · ${latestScan.discovered_count} new message${latestScan.discovered_count === 1 ? "" : "s"} queued`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <form
                      action={requestInboxScan.bind(null, inbox.id)}
                      className="inbox-scan-form"
                    >
                      <label htmlFor={`scan-scope-${inbox.id}`}>
                        Messages to include
                      </label>
                      <div className="inbox-scan-controls">
                        <select
                          className="select"
                          defaultValue="recent_demo"
                          id={`scan-scope-${inbox.id}`}
                          name="scope"
                        >
                          <option value="recent_demo">
                            Last 7 days · [Cargo Demo]
                          </option>
                          <option value="all_demo">
                            All existing · [Cargo Demo]
                          </option>
                        </select>
                        <button className="button button-primary" type="submit">
                          <ScanSearch size={16} /> Start scan
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </article>
            );
          })}
          {!inboxes.length ? (
            <div className="empty">No inbox connected yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
