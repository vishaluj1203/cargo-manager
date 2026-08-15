import { resolve } from "node:path";

import postgres from "postgres";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));

let databaseUrl = process.env.DIRECT_DATABASE_URL;
const password = process.env.DB_PASSWORD;
for (const placeholder of [
  "[YOUR-PASSWORD]",
  "YOUR_PASSWORD",
  "YOUR-PASSWORD",
]) {
  if (databaseUrl?.includes(placeholder) && password) {
    databaseUrl = databaseUrl.replace(
      placeholder,
      encodeURIComponent(password),
    );
  }
}
if (!databaseUrl || databaseUrl.includes("YOUR"))
  throw new Error("DIRECT_DATABASE_URL is not configured");

const expectedTables = [
  "ai_runs",
  "audit_events",
  "contacts",
  "email_threads",
  "emails",
  "inbound_events",
  "inbox_connections",
  "inbox_credentials",
  "mailbox_cursors",
  "organization_members",
  "organizations",
  "outbox_jobs",
  "profiles",
  "ticket_emails",
  "ticket_status_history",
  "tickets",
];

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any(${expectedTables})
    order by table_name
  `;
  const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public' and relname = any(${expectedTables})
  `;
  const functions = await sql<{ proname: string }[]>`
    select proname from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname = any(${[
        "create_workspace",
        "create_workspace_v2",
        "change_ticket_status",
        "queue_ticket_reply",
        "connect_gmail_inbox",
        "disconnect_gmail_inbox",
      ]})
    order by proname
  `;
  const policies = await sql<{ count: number }[]>`
    select count(*)::integer as count from pg_policies where schemaname in ('public', 'storage')
  `;
  const buckets = await sql<{ id: string }[]>`
    select id from storage.buckets where id = 'cargo-email-raw'
  `;
  const migrations = await sql<{ version: string }[]>`
    select version from supabase_migrations.schema_migrations order by version
  `;

  const missingTables = expectedTables.filter(
    (expected) => !tables.some((table) => table.table_name === expected),
  );
  const missingRls = rls
    .filter((table) => !table.relrowsecurity)
    .map((table) => table.relname);
  const expectedFunctions = [
    "change_ticket_status",
    "connect_gmail_inbox",
    "create_workspace",
    "create_workspace_v2",
    "disconnect_gmail_inbox",
    "queue_ticket_reply",
  ];
  const missingFunctions = expectedFunctions.filter(
    (expected) => !functions.some((fn) => fn.proname === expected),
  );

  const result = {
    tables: `${tables.length}/${expectedTables.length}`,
    rlsEnabled: `${rls.length - missingRls.length}/${expectedTables.length}`,
    policies: policies[0]?.count ?? 0,
    functions: functions.map((fn) => fn.proname),
    rawEmailBucket: buckets.length === 1,
    migrations: migrations.map((migration) => migration.version),
    missingTables,
    missingRls,
    missingFunctions,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    missingTables.length ||
    missingRls.length ||
    missingFunctions.length ||
    buckets.length !== 1
  ) {
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
