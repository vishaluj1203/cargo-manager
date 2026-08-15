import { Inbox, Search } from "lucide-react";
import Link from "next/link";

import { requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type TicketRow = {
  id: string;
  number: string;
  subject: string;
  summary: string;
  category: string;
  priority: string;
  status: string;
  last_activity_at: string;
  origin: string | null;
  destination: string | null;
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const membership = await requireCurrentWorkspace();
  const organizationId = membership.organization_id as string;
  const query = await searchParams;
  const supabase = await createClient();
  let request = supabase
    .from("tickets")
    .select(
      "id, number, subject, summary, category, priority, status, last_activity_at, origin, destination",
    )
    .eq("organization_id", organizationId)
    .order("last_activity_at", { ascending: false })
    .limit(200);
  if (query.status && query.status !== "all")
    request = request.eq("status", query.status);
  if (query.q?.trim())
    request = request.or(
      `subject.ilike.%${query.q.trim()}%,summary.ilike.%${query.q.trim()}%,number.ilike.%${query.q.trim()}%`,
    );
  const { data, error } = await request;
  if (error) throw new Error(`Unable to load tickets: ${error.message}`);
  const tickets = (data ?? []) as TicketRow[];

  const counts = {
    active: tickets.filter(
      (ticket) => !["resolved", "closed"].includes(ticket.status),
    ).length,
    urgent: tickets.filter((ticket) => ticket.priority === "urgent").length,
    waiting: tickets.filter((ticket) => ticket.status === "waiting_on_customer")
      .length,
    review: tickets.filter((ticket) => ticket.status === "needs_verification")
      .length,
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Cargo tickets</h1>
          <p>Customer email, triage and replies in one accountable queue.</p>
        </div>
      </div>
      <section className="stats" aria-label="Ticket overview">
        <div className="stat">
          <span>Active</span>
          <strong>{counts.active}</strong>
        </div>
        <div className="stat">
          <span>Urgent</span>
          <strong>{counts.urgent}</strong>
        </div>
        <div className="stat">
          <span>Waiting on customer</span>
          <strong>{counts.waiting}</strong>
        </div>
        <div className="stat">
          <span>Needs AI review</span>
          <strong>{counts.review}</strong>
        </div>
      </section>
      <section className="panel">
        <form className="toolbar">
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: ".8rem",
                top: ".85rem",
                color: "var(--muted)",
              }}
            />
            <input
              className="input"
              name="q"
              defaultValue={query.q}
              placeholder="Search ticket, shipment or subject"
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>
          <select
            className="select"
            name="status"
            defaultValue={query.status ?? "all"}
          >
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="needs_verification">Needs verification</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_on_customer">Waiting on customer</option>
            <option value="resolved">Resolved</option>
          </select>
          <button className="button button-secondary" type="submit">
            Filter
          </button>
        </form>
        {tickets.length ? (
          <div className="table-wrap">
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Route</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link href={`/tickets/${ticket.id}`}>
                        <div className="ticket-subject">
                          {ticket.number} · {ticket.subject}
                        </div>
                        <div className="ticket-summary">{ticket.summary}</div>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>
                      {ticket.origin || "—"} → {ticket.destination || "—"}
                    </td>
                    <td style={{ textTransform: "capitalize" }}>
                      {ticket.category.replaceAll("_", " ")}
                    </td>
                    <td>
                      <span className={`priority priority-${ticket.priority}`}>
                        <span className="priority-dot" />
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="quiet">
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(ticket.last_activity_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Inbox size={30} />
            <strong>No cargo tickets yet</strong>Send a sample email to the
            connected inbox, then run the worker sync.
          </div>
        )}
      </section>
    </div>
  );
}
