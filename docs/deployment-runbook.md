# GCP deployment runbook

This runbook deploys the Next.js product and the scheduled Gmail worker to `sky-valance-cargo-manager`. Supabase remains the hosted database, authentication and raw-email storage provider.

Cloud Run uses London (`europe-west2`). The current Supabase project is in AWS Ireland (`eu-west-1`); use synthetic demo data until the customer confirms EU hosting is acceptable, or migrate to a new Supabase London project for strict UK residency.

## Current gate

Application containers, migrations and provisioning automation are ready. Deployment cannot complete until billing and Google OAuth are configured by the project owner.

## 1. One-time owner setup

### Enable GCP billing

Open Google Cloud Billing and attach a billing account to `sky-valance-cargo-manager`. Cloud Run requires billing even when usage remains inside its free allowance. Create a small monthly budget with email alerts; a budget alerts but does not automatically cap all spending.

### Configure Google Auth Platform

In project `sky-valance-cargo-manager`:

1. Enable the Gmail API.
2. Open **Google Auth Platform** and configure Branding with Skyvalence support/contact details.
3. Select External audience in Testing mode for the demo.
4. Add `info@skyvalence.com` and the actual Gmail/Workspace account used for the demo as test users.
5. Add only these data-access scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
6. Create an OAuth client of type **Web application**.
7. Initially add `http://localhost:3000/api/inboxes/google/callback` as an authorized redirect URI.
8. After the first Cloud Run deploy reports its URL, add `<cloud-run-url>/api/inboxes/google/callback` and run deployment again with `APP_URL=<cloud-run-url>`.

The application requests offline access and stores only an encrypted refresh token. Keep the OAuth client secret out of chat, source control and screenshots.

### Complete `.env.local`

Add:

```dotenv
GCP_PROJECT_ID=sky-valance-cargo-manager
GCP_REGION=europe-west2
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
INBOX_TOKEN_ENCRYPTION_KEY=
```

Generate the encryption key once:

```bash
openssl rand -base64 32
```

Store the key in a password manager. Losing it makes existing Gmail refresh tokens unrecoverable; rotating it requires reconnecting or re-encrypting every inbox.

## 2. Pre-deployment verification

```bash
pnpm db:push:dry-run
pnpm --filter @cargo/db verify:cloud
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm e2e:smoke
```

The database must report 16/16 tables with RLS and migrations 0000–0005.

## 3. Deploy

The deployer reads ignored `.env.local`, creates three least-privilege service accounts, enables APIs, synchronizes five secrets into Secret Manager, builds both containers, deploys the web and private worker services, and creates an OIDC-authenticated one-minute Cloud Scheduler trigger.

```bash
node deploy/gcp/deploy.mjs sky-valance-cargo-manager
```

The command prints `appUrl` and `workerUrl`. The worker is not public. Only its scheduler service account receives `roles/run.invoker`.

For a custom URL, set `APP_URL=https://app.skyvalence.com`, configure DNS/routing, add the exact OAuth callback URL, and rerun the deployer.

## 4. Supabase Auth URLs

In Supabase **Authentication → URL Configuration**:

- Set Site URL to the final application URL.
- Add `http://localhost:3000/auth/confirm` for local testing.
- Add `<application-url>/auth/confirm` for deployment.

## 5. Production smoke test

1. Open the application URL and create or sign into the demo account.
2. Complete company onboarding.
3. Open **Settings → Inboxes**, connect the Workspace mailbox and approve both Gmail scopes.
4. Send a synthetic cargo email from a different mailbox to the connected address.
5. Wait up to two scheduler cycles and verify one ticket, AI fields, raw MIME and audit records.
6. Reply from the ticket and verify the response reaches the sender in the original Gmail thread.
7. Run the worker endpoint again through Scheduler and verify no duplicate ticket or email appears.

Use synthetic content until the AI provider account is approved for real customer data.

## 6. Rollback

- Web/worker code: route traffic to the prior Cloud Run revision.
- Scheduler: pause `cargo-manager-worker-minute` before investigating repeated failures.
- Gmail access: disconnect the inbox in the application and revoke Skyvalence access in the Google account.
- Database: do not roll back an applied shared migration destructively; deploy a forward corrective migration.
- Secrets: add a new Secret Manager version and deploy a new revision. Revoke the exposed old credential at its provider.
