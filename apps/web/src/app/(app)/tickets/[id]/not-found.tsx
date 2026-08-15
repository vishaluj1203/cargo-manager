import Link from "next/link";

export default function TicketNotFound() {
  return (
    <div className="content">
      <section className="panel empty">
        <strong>Ticket not found</strong>This ticket does not exist or is
        outside your workspace.
        <div style={{ marginTop: "1rem" }}>
          <Link className="button button-primary" href="/tickets">
            Return to tickets
          </Link>
        </div>
      </section>
    </div>
  );
}
