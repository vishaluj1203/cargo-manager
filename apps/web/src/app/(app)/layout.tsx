import {
  Anchor,
  BarChart3,
  Inbox,
  LifeBuoy,
  LogOut,
  Settings2,
  TicketCheck,
} from "lucide-react";
import Link from "next/link";

import { requireAuthenticatedUser, requireCurrentWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";

export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, membership, supabase] = await Promise.all([
    requireAuthenticatedUser(),
    requireCurrentWorkspace(),
    createClient(),
  ]);
  const organization = membership.organizations as unknown as {
    name: string;
    company_type: string;
  };
  const { data: connectedInbox } = await supabase
    .from("inbox_connections")
    .select("address, provider")
    .eq("organization_id", membership.organization_id)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/tickets">
          <span className="brand-mark">
            <Anchor size={18} />
          </span>
          <span>Cargo Manager</span>
        </Link>
        <div className="workspace-chip">
          <strong>{organization.name}</strong>
          <span>{organization.company_type.replaceAll("_", " ")}</span>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          <Link href="/tickets" data-active="true">
            <TicketCheck size={17} />
            <span>Tickets</span>
          </Link>
          <Link href="/tickets">
            <Inbox size={17} />
            <span>Inbox</span>
          </Link>
          <Link href="/tickets">
            <BarChart3 size={17} />
            <span>Operations</span>
          </Link>
          <Link href="/settings/inboxes">
            <Settings2 size={17} />
            <span>Settings</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <nav className="nav">
            <Link href="/tickets">
              <LifeBuoy size={17} />
              <span>Help & feedback</span>
            </Link>
          </nav>
          <div className="user-row">{user.email}</div>
          <form action={signOut}>
            <button className="logout" type="submit">
              <LogOut
                size={15}
                style={{ verticalAlign: "middle", marginRight: ".55rem" }}
              />{" "}
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="topbar-title">Operations desk</span>
          <span className="live-indicator">
            <span
              className={connectedInbox ? "live-dot" : "live-dot live-dot-off"}
            />
            {connectedInbox
              ? `${connectedInbox.address} connected`
              : "Inbox connection required"}
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
