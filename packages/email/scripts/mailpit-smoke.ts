import nodemailer from "nodemailer";

import { MailpitEmailProvider } from "../src/index.js";

const apiUrl = process.env.LOCAL_MAIL_API_URL ?? "http://127.0.0.1:8025";
const smtpHost = process.env.LOCAL_MAIL_SMTP_HOST ?? "127.0.0.1";
const smtpPort = Number(process.env.LOCAL_MAIL_SMTP_PORT ?? 1025);
const inboxAddress =
  process.env.LOCAL_INBOX_ADDRESS ?? "cargo@skyvalence.local";
const replyFrom =
  process.env.LOCAL_REPLY_FROM ?? `Cargo Manager <${inboxAddress}>`;
const marker = `cargo-smoke-${Date.now()}`;
const customerAddress = `${marker}@northstar.example`;
const customerMessageId = `<${marker}@northstar.example>`;

const smtp = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: false,
  ignoreTLS: true,
});
const provider = new MailpitEmailProvider({ apiUrl, smtpHost, smtpPort });

async function waitForMessage(
  predicate: (rfcMessageId: string | null, recipients: string[]) => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = await provider.listMessages(200);
    const found = messages.find((message) =>
      predicate(message.rfcMessageId, message.recipients),
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for Mailpit message");
}

await smtp.sendMail({
  from: `Maya Chen <${customerAddress}>`,
  to: `Skyvalence Cargo Desk <${inboxAddress}>`,
  subject: "Urgent status needed for container TCLU1234567",
  messageId: customerMessageId,
  text: `Hello team,

Please confirm the current location of container TCLU1234567 moving from Singapore to Rotterdam.
The consignee needs delivery by Friday, 21 August 2026. Is it still on schedule?

Thanks,
Maya Chen
North Star Imports`,
});

const inboundSummary = await waitForMessage(
  (messageId) => messageId?.includes(marker) ?? false,
);
const inbound = await provider.fetchAndParse(inboundSummary.providerMessageId);

if (inbound.email.from.address !== customerAddress) {
  throw new Error(`Unexpected parsed sender: ${inbound.email.from.address}`);
}
if (!inbound.email.text.includes("TCLU1234567")) {
  throw new Error("Parsed email body is missing the shipment reference");
}

const sent = await provider.sendReply({
  from: replyFrom,
  to: customerAddress,
  subject: inbound.email.subject,
  bodyText:
    "Hi Maya,\n\nWe are checking the live container milestone and will update this ticket shortly.\n\nRegards,\nCargo Desk",
  inReplyTo: inbound.email.messageId,
  references: inbound.email.references,
});

const outboundSummary = await waitForMessage(
  (messageId, recipients) =>
    messageId === sent.messageId.replace(/^<|>$/g, "") ||
    recipients.includes(customerAddress),
);
const outbound = await provider.fetchAndParse(
  outboundSummary.providerMessageId,
);

if (outbound.email.inReplyTo !== customerMessageId) {
  throw new Error(
    `Reply threading mismatch: ${outbound.email.inReplyTo ?? "missing"}`,
  );
}

console.log(
  JSON.stringify(
    {
      inbound: {
        providerMessageId: inbound.email.providerMessageId,
        messageId: inbound.email.messageId,
        from: inbound.email.from.address,
        subject: inbound.email.subject,
      },
      outbound: {
        providerMessageId: outbound.email.providerMessageId,
        messageId: outbound.email.messageId,
        to: outbound.email.to.map((recipient) => recipient.address),
        inReplyTo: outbound.email.inReplyTo,
        subject: outbound.email.subject,
      },
    },
    null,
    2,
  ),
);
