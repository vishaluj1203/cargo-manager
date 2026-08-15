import { ArrowLeft, Bot, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { changeTicketStatus, queueReply } from "../../actions";

type Ticket = {
  id: string;
  number: string;
  subject: string;
  summary: string;
  requested_action: string;
  category: string;
  priority: string;
  status: string;
  origin: string | null;
  destination: string | null;
  shipment_references: Array<{ type: string; value: string; evidence: string }>;
  missing_information: string[];
  ai_confidence: number | null;
  created_at: string;
};

type Email = {
  id: string;
  direction: "inbound" | "outbound";
  from_name: string | null;
  from_address: string;
  to_recipients: Array<{ name: string | null; address: string }>;
  subject: string;
  body_text: string;
  delivery_status: string;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type AuditEvent = {
  id: string;
  event_type: string;
  actor_type: string;
  created_at: string;
  data: Record<string, unknown>;
};

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireCurrentWorkspace();
  const supabase = await createClient();
  const [ticketResult, emailResult, auditResult] = await Promise.all([
    supabase
      .from("tickets")
      .select("*")
      .eq("id", id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle(),
    supabase
      .from("ticket_emails")
      .select("email:emails(*)")
      .eq("ticket_id", id),
    supabase
      .from("audit_events")
      .select("id, event_type, actor_type, created_at, data")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (ticketResult.error) throw new Error(ticketResult.error.message);
  if (!ticketResult.data) notFound();
  if (emailResult.error) throw new Error(emailResult.error.message);
  if (auditResult.error) throw new Error(auditResult.error.message);

  const ticket = ticketResult.data as Ticket;
  const emails = (emailResult.data ?? [])
    .flatMap((row) => (row.email ? [row.email as unknown as Email] : []))
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  const audit = (auditResult.data ?? []) as AuditEvent[];
  const updateStatus = changeTicketStatus.bind(null, id);
  const sendReply = queueReply.bind(null, id);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <Link
            className="quiet"
            href="/tickets"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: ".35rem",
              marginBottom: ".6rem",
            }}
          >
            <ArrowLeft size={14} /> Back to tickets
          </Link>
          <h1>
            {ticket.number} · {ticket.subject}
          </h1>
          <p>{ticket.summary}</p>
        </div>
        <span className={`badge badge-${ticket.status}`}>
          {ticket.status.replaceAll("_", " ")}
        </span>
      </div>

      <div className="ticket-layout">
        <section className="panel">
          <div className="conversation">
            {emails.map((email) => (
              <article
                className={`email-card email-card-${email.direction}`}
                key={email.id}
              >
                <div className="email-meta">
                  <div>
                    <span className="email-from">
                      {email.from_name || email.from_address}
                    </span>{" "}
                    ·{" "}
                    {email.direction === "inbound"
                      ? "Customer"
                      : "Your cargo desk"}
                  </div>
                  <time>
                    {dateTime.format(
                      new Date(
                        email.received_at || email.sent_at || email.created_at,
                      ),
                    )}
                  </time>
                </div>
                <div className="email-body">{email.body_text}</div>
                {email.direction === "outbound" ? (
                  <div className="quiet" style={{ marginTop: ".8rem" }}>
                    Delivery: {email.delivery_status}
                  </div>
                ) : null}
              </article>
            ))}
            {!emails.length ? (
              <div className="empty">No email is attached to this ticket.</div>
            ) : null}
          </div>
          <form action={sendReply} className="reply-box form-stack">
            <div className="field">
              <label htmlFor="bodyText">Reply to customer</label>
              <textarea
                className="textarea"
                id="bodyText"
                name="bodyText"
                placeholder="Write an operational update…"
                required
              />
            </div>
            <div
              style={{ display: "flex", gap: ".7rem", alignItems: "flex-end" }}
            >
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="cc">CC (optional)</label>
                <input
                  className="input"
                  id="cc"
                  name="cc"
                  placeholder="ops@example.com, agent@example.com"
                />
              </div>
              <button className="button button-primary" type="submit">
                <Send size={15} /> Queue reply
              </button>
            </div>
            <span className="form-hint">
              Reply is saved first, then delivered by the outbox worker with
              retry protection.
            </span>
          </form>
        </section>

        <aside>
          <section className="side-card">
            <h3>Workflow</h3>
            <form action={updateStatus} className="status-form">
              <select
                className="select"
                name="status"
                defaultValue={ticket.status}
              >
                <option value="new">New</option>
                <option value="needs_verification">Needs verification</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_on_customer">Waiting on customer</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              <input
                className="input"
                name="reason"
                placeholder="Reason (optional)"
              />
              <button
                className="button button-secondary button-small"
                type="submit"
              >
                Update status
              </button>
            </form>
          </section>
          <section className="side-card">
            <h3>AI triage</h3>
            <div className="details">
              <div className="detail">
                <span>Confidence</span>
                <strong
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".4rem",
                  }}
                >
                  <Bot size={15} />{" "}
                  {ticket.ai_confidence == null
                    ? "Pending"
                    : `${Math.round(ticket.ai_confidence * 100)}%`}
                </strong>
              </div>
              <div className="detail">
                <span>Requested action</span>
                <strong>{ticket.requested_action}</strong>
              </div>
              <div className="detail">
                <span>Category</span>
                <strong style={{ textTransform: "capitalize" }}>
                  {ticket.category.replaceAll("_", " ")}
                </strong>
              </div>
              <div className="detail">
                <span>Priority</span>
                <strong style={{ textTransform: "capitalize" }}>
                  {ticket.priority}
                </strong>
              </div>
              {ticket.missing_information?.length ? (
                <div className="detail">
                  <span>Missing information</span>
                  <strong>{ticket.missing_information.join(", ")}</strong>
                </div>
              ) : null}
            </div>
          </section>
          <section className="side-card">
            <h3>Shipment</h3>
            <div className="details">
              <div className="detail">
                <span>Route</span>
                <strong>
                  {ticket.origin || "Unknown"} →{" "}
                  {ticket.destination || "Unknown"}
                </strong>
              </div>
              <div className="detail">
                <span>References</span>
                <div className="references">
                  {ticket.shipment_references?.length ? (
                    ticket.shipment_references.map((reference) => (
                      <span
                        className="reference"
                        key={`${reference.type}-${reference.value}`}
                      >
                        {reference.type}: {reference.value}
                      </span>
                    ))
                  ) : (
                    <strong>None extracted</strong>
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="side-card">
            <h3>Audit trail</h3>
            <div className="timeline">
              {audit.map((event) => (
                <div className="timeline-item" key={event.id}>
                  <strong>
                    {event.event_type
                      .replaceAll(".", " · ")
                      .replaceAll("_", " ")}
                  </strong>
                  <time>
                    {dateTime.format(new Date(event.created_at))} ·{" "}
                    {event.actor_type}
                  </time>
                </div>
              ))}
              {!audit.length ? (
                <span className="quiet">No events recorded.</span>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
